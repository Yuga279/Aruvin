# Real WebSocket voice baseline — 5 November 2026

## Outcome

**Headless real-provider baseline recorded: 8/8 completed, including one excluded warm-up and seven measured turns.** Speech-end to first received PCM: **p50 7.801 s, exploratory p95 17.696 s**. Startup: **p50 1.480 s, exploratory p95 2.217 s**. Reported model cost plus estimated speech cost: **US$0.091509**, including warm-up. No paid retries were observed.

This supersedes the [initial offline-only checkpoint](websocket-baseline-2026-11-05.md). The user's follow-up explicitly authorized configured keys, up to **US$1 estimated total, eight submissions, 15 minutes active testing**. The finite run is now exhausted; leftover dollars do not authorize more submissions. Unified review: **skipped**, not passed. No WebRTC work, Calendar tools/mutations, external provisioning, deployment, dependency install, or commit by this benchmark agent.

**Not audible-device evidence:** actual microphone capture, audible browser onset, interruption-to-playback-stop, jitter/loss testing, multi-turn history/reconnect stress, and dictation/text regression acceptance remain unmeasured. Their absence does not invalidate these real-provider WebSocket receipt/startup measurements. The complete [WebRTC verification goal](../live-voice-webrtc/goal.md#verification-goals) remains only partially covered.

## Results

All values below are milliseconds. Percentiles use the existing `report.ts` nearest-rank calculation over the seven successful non-warm-up samples. With seven samples, p95 is simply the maximum: **exploratory, not a stable tail/capacity estimate**.

| Metric | p50 ms | p95 ms | Boundary |
| --- | ---: | ---: | --- |
| Speech end → first received PCM | 7800.788 | 17696.421 | Client monotonic replay marker to binary PCM receipt; not audible playback. |
| Connection startup | 1479.505 | 2216.661 | HTTP session creation through WebSocket `session.ready`, including provider setup; excludes microphone permission/audio-device readiness. |
| Speech end → thinking notification | 1838.660 | 1839.663 | Includes endpointing, server notification, and delivery; not isolated STT compute. |
| Server STT end-of-turn → first synthesized PCM | 5967.157 | 15857.324 | Correlated server `clockMs`, same `clockOriginMs`; not client receipt and no cross-process subtraction. |
| Speech end → simulated playback end | 24043.905 | 33761.372 | Existing CLI ranking metric; **not** first-audio latency. |
| Client start → durable completion confirmation | 32444.122 | 45331.116 | Includes setup/input/playback and terminal/delivery-settled log evidence. |
| Speech end → actual audible reply | N/A | N/A | No browser/device observation. |
| Interruption → playback stopped | N/A | N/A | Not exercised; all eight submissions used for completed baseline turns. |

### Every submission (chronological)

| Index | Included? | Outcome | Startup ms | Speech end → thinking ms | Speech end → first PCM ms | Speech end → simulated end ms | Client start → durable ms |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 0 | Warm-up, excluded | success | 1969.195 | 1800.375 | 11156.390 | 26512.022 | 35631.049 |
| 1 | Measured | success | 1415.752 | 1839.371 | 4041.060 | 20325.402 | 30109.417 |
| 2 | Measured | success | 2067.898 | 1832.684 | 7800.788 | 24043.905 | 32041.470 |
| 3 | Measured | success | 1396.801 | 1838.660 | 4582.224 | 21349.005 | 27045.098 |
| 4 | Measured | success | 2216.661 | 1838.255 | 17696.421 | 33761.372 | 45331.116 |
| 5 | Measured | success | 952.500 | 1839.663 | 3802.879 | 23885.783 | 34174.412 |
| 6 | Measured | success | 2053.401 | 1838.841 | 8803.127 | 26430.286 | 32444.122 |
| 7 | Measured | success | 1479.505 | 1828.357 | 13376.226 | 29390.662 | 38029.929 |

Unrounded values, pseudonymized session/turn/attempt/dispatch correlations, model-round timing/counts, cleanup durations, and ordered projected server timelines are in the [raw results](../../backend/benchmark-results/ws-live-2026-11-05/runs/9ab4762c-c960-406f-adcf-84d91f265d56/results.json). Every turn had correlated completed terminal and delivery-settled evidence; no failed/unverified turns were excluded.

### Observed server spans

| Span (existing instrumentation) | p50 ms | Exploratory p95 ms |
| --- | ---: | ---: |
| STT connection | 1405.274 | 2200.661 |
| TTS connection (parallel with STT) | 1473.148 | 2158.547 |
| STT end-of-turn → response prepared | 3143.963 | 12551.626 |
| Model dispatch → first meaningful output | 1502.376 | 2358.637 |
| First model output → first TTS submission | 188.258 | 192.769 |
| First TTS submission → first synthesized PCM | 483.052 | 513.060 |

Spans overlap and their percentiles must not be added. The slowest sample's response-preparation span was 12.552 s; this demonstrates substantial server-path variability, not proof that the audio transport alone caused the delay. These observations do not separate all database/ownership waits, provider queueing, prefill, network transit, or application backpressure. They do not establish that WebRTC will improve end-to-end latency.

## Environment, configuration, and comparable inputs

- Windows 11 Pro 64-bit `10.0.26200`; Node `v24.18.0`, npm `12.0.1`; existing installed dependencies. Client and Aurvin backend on this Windows host via loopback HTTP/WebSocket; real configured remote database and US speech endpoints, OpenRouter default routing. No network impairment applied; physical network/egress location and external provider hardware were not independently characterized.
- Context captured `2026-11-05T08:43:10.367Z`; index preparation preceded paid work. CLI ended `08:54:39.947Z`. Actual guarded paid-active window **285.373 s (4 min 45.373 s)**, including cleanup, under 15 minutes.
- Stored configuration revision **3**, read only from the configured application database; encrypted credentials stayed in process memory. The existing `AppService` decrypted them itself. No source application data/settings were changed. All generated conversation/checkpoint/accounting writes used one fresh isolated database recorded in `context.json`. The original database had no executor opened by this task.
- Actual requested/reported model: **`anthropic/claude-haiku-5.5`**; provider reported **`Claude Platform on AWS`**. Data collection `deny`, transforms disabled, tools absent; no model override. `maxContextTokens=60000`, `maxOutputTokens=6000`, `maxInputTokens=8192`, `maxInputChars=32000`, message count 80, margin 1024, retry attempts ≤2, first-output timeout 30000 ms, idle timeout 20000 ms, total server run timeout 180000 ms. Client deadline was 90000 ms per submission; concurrency one. Existing SDK model retries are zero; the server's separate rejection retry policy remains bounded at two dispatches.
- Deepgram **`flux-general-en`** STT (version not reported) and **`flux-haley-en`** TTS (reported version **`2026-08-12.0`**), region US. EOT threshold **0.8**, timeout **5000 ms**, zero keyterms. Input PCM16 little-endian, mono, 16 kHz, locale `en-US`; output PCM16, mono, 24 kHz. Existing voice limits: live 1200000 ms, connect 10000 ms, input queue 1000 ms, output queue 2000 ms, finalization 2000 ms, reconnect 10000 ms, idle warning/exit 60000/30000 ms; identity concurrency 1/global 4. Full nonsecret limits/quotas are preserved in context.
- Each sample opened a **new voice session, provider socket pair, and fresh conversation**, not repeated history in one conversation. Sample 0 is application-first-session/cold warm-up; provider/model cache coldness is unknown. Samples 1–7 are subsequent process-warm sessions, not proof of fully warm providers. No browser audio context exists in this run.
- Reused [synthetic PCM](../../backend/benchmark-results/ws-baseline-2026-11-05/audio/baseline.pcm) and [manifest](../../backend/benchmark-results/ws-baseline-2026-11-05/audio/baseline.json): 183518 bytes, SHA-256 `933c59e38179c0a16df1b26aa1567a8a76ee823c0c0ceaf820feef382412c3a1`. Same nonprivate no-tool scenario from the existing runner, generated offline with Windows speech, not a microphone. No transcripts or reply contents were exported.
- Speech-end marker **3734.9375 ms**, last nonzero waveform sample, not human-perceived phonetic end. Two seconds trailing silence. **80 ms / 2560-byte** input frames, real-time pacing, zero-padded final frame; every sample transmitted **5760 ms**, aggregate **46080 ms**. Marker is positioned on the client's replay clock; frame-granularity lookahead/scheduling is part of this methodology. Simulated playback acknowledges received samples at 24 kHz on a 40 ms progress loop; it is not browser/hardware playback.

### Source/build identity and concurrent checkout activity

At server preparation, HEAD was `a3188adb4b2cd5668e7fd8cb05938ff481612094` with the user's existing runtime optimization edits plus this task's small build/benchmark changes. Another session advanced HEAD to **`a78f23ad9b9d8398d5ed7f857a89faa6cd05de4a`** (`Improve live voice responsiveness`) before the CLI began. The benchmark agent made no commit.

The aggregate source/input hash captured before preparation and recomputed after all live turns was **identical**: `e916bc586fafc4c2950791fb7cc1c46589623545b63dc11394631320ff4b0432`. Its complete file list and algorithm (`SHA256(sorted path + NUL + bytes + NUL)`) are in context, including untracked benchmark sources, backend/frontend source, benchmark tests, manifests/lockfiles and product knowledge; no `.env` or credentials. CLI runner/declared server revision is `a78f23a…`, dirty=true. **Use revision plus hash, never revision alone.**

Post-run audit of compiled JS: SHA-256 `4574aa2847ce323eb0250b8bdf64fb9bb4448218dc17a5acdfc32870396fd64a`; latest compiled write `08:43:06.428Z`, before context capture, with no observed rebuild during paid measurement. The compiled hash was collected after the run, not an independently sealed pre-run build. [Provenance audit](../../backend/benchmark-results/ws-live-2026-11-05/provenance-audit.json) retains the changing HEAD labels without rewriting the original metadata.

## Spending controls and reconciliation

Provider prices were checked before paid calls against [OpenRouter's live model catalogue](https://openrouter.ai/api/v1/models) and [Deepgram public pricing](https://deepgram.com/pricing), observed 5 November 2026. Actual stored speech-rate fields and daily spend cap were null; they were **not silently filled or changed**. Public rates were used only by the benchmark's reservation/reconciliation. No free-credit/promotional discounts assumed.

- OpenRouter base prompt **$0.0000001/token**, completion **$0.0000005/token**; cache read **$0.00000001**, write **$0.000000125**, one-hour write **$0.0000002**. Catalogue higher-context prompt/completion tiers were reserved conservatively at **$0.0000005 / $0.0000025** per token, even though the guarded context cannot reach their 100000-token threshold. The low-context cache rates fit within the conservative prompt reservation; high-context cache tiers are inapplicable. Catalogue and pricing snapshot retained in context.
- Deepgram Flux STT English **$0.0077/minute** of processed audio; Flux TTS **$0.045/1000 input characters**. No optional add-ons sent.
- Injected **benchmark-only** egress guard, using existing application fetch/socket ports, admitted ≤16 capped model dispatches, ≤60000 context tokens/request, ≤6000 output tokens/request; ≤60000 ms STT input across all sockets; ≤4000 UTF-8 bytes across all TTS `Speak` commands (conservative character bound); ≤32 provider sockets; ≤900000 ms paid-active lifetime. Invalid hosts/routes, changed model/caps, tools/enabled plugins, and over-limit text/audio are rejected **before forwarding**; expiry aborts HTTP and terminates sockets. These are extra test-safety ceilings, not transport or ordinary application changes. Guard was never tripped.
- Reserved maximum: `1.10 × [16 × (60000 × 0.0000005 + 6000 × 0.0000025) + 4000/1000 × 0.045 + 1 × 0.0077] = $0.99847`.
- Observed: **8 model requests**, **1871 UTF-8 TTS bytes**, **46080 ms STT audio**, **16 provider sockets**, **0 active sockets after shutdown**, no guard denial. No second live backend executor against the same database.
- Eight model accounting records are **known**, provider-reported aggregate **$0.001400305**. Provider-reported TTS billable characters total **1871**, estimated **$0.084195**; submitted STT audio estimates **$0.0059136** at the public rate. Total reported-model + estimated-speech **$0.091508905**. Speech is an estimate, not invoice reconciliation; provider billing/credits/taxes may differ. Guard bounds estimated API spend, not a guaranteed invoice cap.
- All eight TTS response records were completed. STT/TTS socket-level accounting records are terminal `cancelled` after the headless client's session end/DELETE/disconnect; this is distinct from the **completed application turns**, not hidden as a successful socket `closed` status. No account/settings changes or destructive database cleanup occurred. Generated isolated databases, including two zero-paid startup attempts, remain available for audit; their names are in each context artifact. No user database was dropped or modified for cleanup.

## Necessary changes and actual checks

1. Reproduced the original three compiler errors. Minimal type-only fixes: import `VoiceDeliveryRecord` from `contracts/voice.ts` in `durable-chat-runtime.ts`/`finalization.ts`; admit the already-used `generation-start` value in `OwnedPhaseName`. No runtime flow was rewritten. These changes are now included in the concurrent owner's `a78f23a` commit, not a commit by this agent.
2. Added optional `voiceOnly` to the existing benchmark config and filtered existing CLI scenarios accordingly, avoiding four unwanted text submissions and every Calendar scenario. Defaults unchanged. Reused existing `runVoice`, log correlation, durable completion checks, analysis, reporting and nearest-rank summary functions; no competing latency framework.
3. Added `live-budget.ts`, its offline regression tests, and operator driver `live-baseline.ts`. Driver uses the existing full Nest application module and assembly overrides, read-only stored config, a fresh database, guarded egress, and the existing CLI. No provider or transport adapters changed for this measurement.
4. Two initial isolated startups stopped at readiness with **zero model requests/provider sockets**. Scoped diagnostic replay showed index creation failure under a short timeout; preparing the isolated indexes with a 60-second driver deadline succeeded. Final run pre-created only its own indexes, then used unchanged configured **15000 ms** runtime persistence timeout. No paid submission consumed during preparation failures. [First](../../backend/benchmark-results/ws-live-2026-11-05-preflight1/budget.json) and [second](../../backend/benchmark-results/ws-live-2026-11-05-preflight2/budget.json) zero-use evidence retained.

| Check / invocation (from `backend/`) | Actual result |
| --- | --- |
| `npm run build` | Initial 3 errors reproduced; **passed after type-only fixes and driver compilation fixes**, including final pre-live build. |
| `npm test -- test/benchmark/live-budget.spec.ts` | Red: missing limits failed; green: **10 passed**, no paid calls. |
| `npm test -- test/benchmark/runner.spec.ts -t "accepts an explicit voice-only"` | Red: strict schema rejected new flag; green included below. |
| `npm run test:benchmark` | **91 passed, 7 files**. |
| `npm test -- test/runtime/voice-output.spec.ts test/performance/voice-critical-path.spec.ts` | **10 passed, 2 files** before live execution. |
| `npm test -- test/benchmark test/runtime/voice-output.spec.ts test/performance/voice-critical-path.spec.ts test/voice/providers` | **152 passed, 14 files**, post-run; no skipped tests in this selection. |
| `npm run lint` / `npm run lint -- --quiet` | Exit 0; existing warnings plus 3 new unbound-method warnings in the guard test fixture. Quiet error-only pass produced no errors. |
| `node dist/benchmark/live-baseline.js` (without approval flag) | Refused with `APPROVAL_FLAG_REQUIRED`, before env/database/provider work. |
| `node dist/benchmark/live-baseline.js --live` | Final **exit 0**, eight real-provider successes; uses `node dist/benchmark/cli.js <generated-nonsecret-config> --live`. |
| Export safety check | Compared 11 generated text artifacts against configured decrypted/legacy secrets, master key, and connection string **inside the private process**; no match, no values printed. |
| Final consistency checks | 43 existing local Markdown links resolved; asserted 8 successes/7 measured, every terminal/delivery-settled pair, guard ceilings, known model accounting, stable source hash, zero remaining provider sockets; `git diff --check` passed. [Machine-readable assertions](../../backend/benchmark-results/ws-live-2026-11-05/final-verification.json). |

No full backend/frontend/e2e suite, browser regression suite, topology certification, or unified review is claimed. Initial no-network inventory remains separately available in the earlier checkpoint; it is not mixed into these latency percentiles.

## Artifacts and repeat procedure

Generated outputs are intentionally ignored by Git; retain/copy this directory privately for the after comparison:

- [Live raw JSON](../../backend/benchmark-results/ws-live-2026-11-05/runs/9ab4762c-c960-406f-adcf-84d91f265d56/results.json) / [existing CLI report](../../backend/benchmark-results/ws-live-2026-11-05/runs/9ab4762c-c960-406f-adcf-84d91f265d56/report.md); run ID `9ab4762c-c960-406f-adcf-84d91f265d56`.
- [Correctly separated latency summary](../../backend/benchmark-results/ws-live-2026-11-05/latency-summary.json), [context/settings/provenance](../../backend/benchmark-results/ws-live-2026-11-05/context.json), [post-run provenance audit](../../backend/benchmark-results/ws-live-2026-11-05/provenance-audit.json).
- [Budget evidence](../../backend/benchmark-results/ws-live-2026-11-05/budget.json), [redacted accounting](../../backend/benchmark-results/ws-live-2026-11-05/accounting.json), [export safety check](../../backend/benchmark-results/ws-live-2026-11-05/safety-check.json), [readiness](../../backend/benchmark-results/ws-live-2026-11-05/readiness.json).
- [Projected server JSONL](../../backend/benchmark-results/ws-live-2026-11-05/server.jsonl), [client log](../../backend/benchmark-results/ws-live-2026-11-05/client.log), [exact nonsecret runner config](../../backend/benchmark-results/ws-live-2026-11-05/benchmark.json).

**Do not rerun under the exhausted authorization.** With fresh finite approval, first rebuild and run offline guard tests; verify current rates/settings still fit the pinned envelope. Preserve this directory. The one-shot driver deliberately refuses an existing `benchmark-results/ws-live-2026-11-05` directory: an operator must explicitly choose a new run directory/authorization rather than delete or overwrite these results. Invocation from `backend/` is `node dist/benchmark/live-baseline.js --live`; keys remain in existing `.env`/encrypted stored config, never arguments or JSON. Driver invokes the existing CLI against its own loopback backend and gracefully closes it. Never run a second backend against the same database.

For an apples-to-apples after run, preserve the exact PCM/hash/marker, model/routing/settings, no-tool scenario, fresh-conversation pattern, 1+7 count, warm-up exclusion, limits, context/instruction/product revisions, input/output rates, host/network/database placement and the non-triggered safety guard. Record changed packetization/codecs/media bridge placement rather than pretending WebRTC frames equal the original 80 ms WebSocket frames. Independently measure audible onset/stop and fixed network impairment profiles later under bounded approval; do not rename PCM receipt as audible latency.
