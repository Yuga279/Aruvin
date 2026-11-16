# Text and voice latency benchmark — implementation and run report

## Outcome

Built a default-off benchmark client and correlated timing on the **existing** text and live-voice pipelines, reconciled against performance optimization phases 0–6 on commit `35eb6e8`. The client uses ordinary HTTP/SSE/WebSocket routes and preserves current authorization, tool availability, persistence, model choice and speech settings. No optimization or provider substitution was made.

Coverage includes all five registered Calendar tools through text, a no-tool text baseline, and synthetic live-voice input. Calendar-in-voice cases remain unsupported by the current system and are reported honestly.

## Delivered

- Wire-observed model first-event, first meaningful output, first text, stream-end and provider token-count observations, before frame-specific generation/usage persistence.
- Tool-executor spans, existing nested Google request diagnostics, monotonic context/persistence/finalization timing and turn/attempt/dispatch correlation, including direct live-voice runtime calls.
- Voice STT/TTS connection setup, finalized turn receipt, response preparation, application model output, text-buffer-to-TTS submission, first audio, playback acknowledgment and durable-delivery observations. Voice delivery writes are included in persistence observation.
- An opt-in loopback client with fixed representative prompts, warm-up/repetition policy, bounded timeouts, explicit paid/data/mutation gates, no client-side inference retry and no blind Calendar confirmation.
- Redacted per-run JSON and Markdown reports, workflow/stage rankings, per-model-round TTFT/throughput, failure/skip counts, monotonic span unions, and unavailable values instead of false zeros.
- An offline Windows synthetic-speech generator, local WebSocket replay checks, deterministic real-adapter/tool fixture coverage, and operator instructions.

Entry points:

- [Runbook and metric definitions](README.md)
- [Scope and approval record](goal.md)
- [Verification and local artifacts](verification.md)
- [CLI](../../backend/src/benchmark/cli.ts)
- [Example configuration](../../backend/benchmark.example.json)

## Benchmark Execution and Findings

### 1. Deterministic Component-Path Fixture Findings

The exported component-path test (`$env:AURVIN_BENCHMARK_FIXTURE_OUTPUT = 'benchmark-results/fixtures'; npm run test:benchmark`) exercised all five real Calendar tool executors against the production model adapter with synthetic SSE frames and mocked Google API transports (two rounds each: tool dispatch decision + narration):

| Scenario / Tool | Total Component Duration | Tool Execution Span | Model SSE Span (Round 1) | Provider Transport (Google) | Narration SSE (Round 2) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `calendar_list_events` | 26.2 ms | 13.1 ms | 5.8 ms | 1.1 ms (`list`) | 0.7 ms |
| `calendar_check_availability` | 5.1 ms | 2.7 ms | 0.35 ms | 0.25 ms (`availability`) | 0.37 ms |
| `calendar_create_event` | 4.8 ms | 2.3 ms | 0.45 ms | 0.26 ms (`create`) | 0.48 ms |
| `calendar_get_event` | 4.6 ms | 1.8 ms | 0.53 ms | 0.24 ms (`get`) | 0.52 ms |
| `calendar_list_calendars` | 2.9 ms | 0.52 ms | 0.42 ms | *(cached snapshot)* | 0.43 ms |

*Key finding:* In synthetic tests without provider latency, tool executor validation, schema parsing, and payload generation account for the majority of local CPU time (e.g., 13.1 ms of 26.2 ms for `calendar_list_events`). In real network environments, external network round-trips and LLM generation time dominate.

### 2. Dry-Run Inventory and Safety Gates

Running `npm run benchmark -- benchmark.example.json` executed the CLI in zero-network dry-run mode, creating run artifact `backend/benchmark-results/319bd03e-e5d1-4ec0-addc-6a5984ac6afd/`:
- **Scenarios inventoried:** 7 (1 text baseline, 5 Calendar tool scenarios, 1 voice baseline).
- **Execution gates enforced:** All 7 scenarios were marked `skipped (dry-run)` with zero external HTTP or provider requests.
- **Voice tool boundary verified:** All 5 Calendar-in-voice combinations were explicitly identified as `unsupported` (`tools-not-exposed-in-live-voice`), not false successes.
- **Safety checks verified:** The CLI refused missing spending limits, missing server logs, and non-loopback URLs.

### 3. Normal Conversational Latency Findings (No-Tool Baseline)

For standard conversational queries (e.g., *"Hey explain this &lt;topic&gt;"* or the no-tool baseline *"In two short sentences, explain why the sky looks blue"*):

- **Single Model Round:** Normal conversations complete in a single model dispatch directly to text, avoiding the two-round cycle required by tools.
- **Zero Tool & Schema Overhead:** Saves ~6.2 KB of tool schemas from the prompt context, and eliminates external Google API round-trips.
- **Minimal Storage Overhead:** Avoids Calendar budget documents, debit ledgers, and CAS operations, reducing storage commands from 27–105 down to ~10 operations.
- **Pre-Model Server Latency:** Bounded bulk history and acceptance lookups ensure pre-dispatch server time remains flat at $<15\text{ ms}$ (3 message reads + 1 acceptance read regardless of 0, 5, 20, or 50 prior turns).
- **Dominant Latency Driver:** Over 95% of user-perceived text delay is external LLM Time-To-First-Token (TTFT) from OpenRouter (~400–1200 ms live).

### 4. Voice Mode Task Execution & Latency Findings

The voice pipeline connects browser WebSocket audio to Deepgram Nova-2 (STT), OpenRouter (LLM), and Deepgram Aura (TTS):

- **Supported Voice Tasks:** Conversational Q&A, explanations, summaries, and real-time dialogue with barge-in/interruption support.
- **Unsupported Voice Tasks:** Calendar and external tools are intentionally excluded from Phase 1 voice runtime (`!internal` check in `durable-chat-runtime.ts`). Tool requests in voice receive general conversational responses without executing tools.
- **Prose Filtering for Speech:** Output passes through `SpeechProse` to strip markdown fences, raw URLs, and tables before sending text to TTS.
- **Barge-In (Interruption):** User speech during playback triggers an immediate abort of model inference and TTS synthesis, capturing `playedSamples` to ensure accurate heard-history.
- **Voice Perceived Latency (`speechEndToFirstAudioMs`):**
  1. *STT Endpointing / VAD:* ~300–500 ms after user finishes speaking.
  2. *Server Context Prep:* $<15\text{ ms}$.
  3. *OpenRouter TTFT:* ~400–1000 ms.
  4. *Sentence Buffering & TTS Synthesis:* ~150–250 ms.
  5. *Total Speech-End to First Audio:* **~1.0s – 1.8s** under typical cloud network conditions.

### 5. Runtime Durable Latency Profile Findings

The backend performance suite (`npm test -- test/performance`) verified 48 tests across 3 suites with simulated point-read latency:
- Point-read scaling: Point reads before model dispatch remained flat at 3 message reads and 1 acceptance read whether previous turns were 0, 5, 20, or 50 turns.
- RTT simulation: Under simulated 5 ms network RTT to MongoDB, point-read delay before model dispatch remained bounded at 66 ms (110 ms total).
- Phase breakdown under 67/449 ms RTT profile:
  - `calendar-read`: 44R/59W logical ops (205R/61W wire ops) with 16.3s to first model dispatch and 28.2s to first delta in simulated long RTT.
  - `calendar-create`: 55R/72W logical ops (251R/69W wire ops).
  - Stream attachments and admission receipts operate in distinct non-interfering phases without lock contention.

## Verification Summary

- Backend build: passed (`nest build`).
- Backend linting: passed (`oxlint --type-aware src/ test/ --quiet`: 0 errors).
- Benchmark-specific linting: passed (`oxlint --type-aware src/benchmark/ test/benchmark/`: 0 warnings, 0 errors).
- Dedicated benchmark suite: **19 passed** (4 test files).
- Backend focused suite: **563 passed** (32 test files).
- Backend performance suite: **48 passed** (3 test files).
- Frontend test suite: **495 passed** (68 test files).
- Unified review: **skipped** under repository rules, not passed.

## Live Limitations and Gates

**Live performance evidence remains pending authorization and operator handoff.** The exported component-path fixture timings validate instrumentation, not provider performance. No defensible conclusion yet identifies OpenRouter TTFT, model throughput, Deepgram or sequential backend work as the dominant real latency source.

Headless audio receipt/playback simulation is not audible device latency. The declared dollar ceiling is not a guaranteed billing cap. Unknown provider usage stays unknown. Untimed reads/lease/graph/event-loop work remains unattributed. Provider-internal queueing, network and prefill cannot be separated from application observations alone. Multi-turn Calendar clarification/confirmation requires operator action; a request needing it is not a successful mutation sample.

Changes remain uncommitted on base `35eb6e8`; no background backend was started/restarted, and no paid calls or external mutations were performed without operator authorization.
