# Voice and tool workflow latency benchmark

Status: scope approved by the user's “Sure. Proceed.” Text and voice are both included. Implementation proceeds in this chat without skills or subagents as requested. Paid-call ceiling, Calendar data/mutation target permission, and deployment/restart permission remain unspecified.

## Objective

Measure the existing system, without optimizing or changing its capabilities, to identify where conversational delay occurs and which supported tool workflows take longest. Report observed results, not inferred provider performance.

## Scope and acceptance criteria

1. Inventory tools from the actual registered schemas and eligibility gates. Initially identified Calendar tools: `calendar_list_events`, `calendar_get_event`, `calendar_create_event`, `calendar_list_calendars`, and `calendar_check_availability`. Detect uncovered tools rather than silently omitting them.
2. Provide repeatable, bounded prompt scenarios for every supported tool, plus a no-tool baseline. Example: “Show my upcoming events over the next seven days.” Resolve dates/time zones explicitly; seed known event identifiers for detail lookup. Include the existing authorization/confirmation exchange for event creation. Record expected versus observed tool calls and task outcomes: refusals, missing configuration, wrong tools, and failures are not successful tool benchmarks.
3. Preserve current mode boundaries: current runtime excludes Calendar tools from live voice. Benchmark supported tool workflows through text and real voice through its existing no-tool path; report voice-tool cases as unsupported. Do not enable Calendar tools in voice as part of this work.
4. Correlate each scenario, repetition, turn, model round/attempt, tool call, and speech response. Use monotonic elapsed measurements within each process. Capture ordered spans so sequential execution, overlapping work, retries, and uninstrumented gaps remain visible without double-counting overlapping stages.
5. Measure where available: connection/setup; input audio duration and speech-end-to-final-transcript delay; queue/admission; persistence and context preparation; each model request to first stream event, first tool output, and first user-facing text; model generation duration and provider-reported output tokens; each tool and underlying external request; text buffering before synthesis; TTS submission to first audio; transport and browser playback; durable finalization. Report missing evidence as unavailable, never zero. Provider-internal queueing versus model prefill cannot be separated without provider evidence; application-observed TTFT includes network/provider delay. Stream chunks are not tokens.
6. Distinguish user-perceived speech-end-to-first-audible-reply from full response playback completion and durable turn completion. A server-only run cannot claim measured browser/device latency. Use consented synthetic audio with known speech-end markers for repeatable speech cases; never retain microphone recordings by default.
7. Export bounded per-run machine-readable evidence and a readable summary ranking slow workflows and dominant measured stages. Include sample counts, per-run values, median/p95 where meaningful, failures/timeouts, warm-up policy, environment, revision, configuration/model identifiers without secrets, and measurement limitations. Separate live evidence from deterministic fixtures; fixture timing does not establish provider speed. Unknown token counts mean unavailable tokens/second. State the throughput denominator explicitly.
8. Reuse current instrumentation and test infrastructure; minimize dependencies, avoid new public diagnostics endpoints, and keep benchmarking opt-in with negligible work when disabled. Exclude credentials, private calendar payloads, and model reasoning from artifacts.
9. Add deterministic checks for timing attribution, overlapping spans, missing stages, scenario/tool coverage, incorrect tool selection, failure/timeout reporting, and artifact redaction. Run relevant package build/lint/test checks and report skipped service-dependent tests separately. Unified review remains skipped under repository instructions.

## Live execution safety and proposed defaults

- Run deterministic fixtures first, then only explicitly authorized live checks.
- Initial live sample: one warm-up and three measured repetitions per eligible read-only/baseline scenario, concurrency one, bounded per-case timeout, no automatic retries beyond existing application policy. Mutation scenarios deliberately use one measured sample and no warm-up to avoid duplicate events and self-induced conflicts. This is diagnostic sampling, not a statistically stable p95 study.
- Obtain an explicit dollar ceiling before paid OpenRouter/Deepgram calls. Respect provider billing uncertainty; a local cap is not a billing guarantee.
- Obtain approval for a disposable Calendar test target before any live event creation. Do not create, alter, or delete ordinary user events. Do not add unsupported cleanup/delete capabilities; describe any manual cleanup required.
- Obtain approval before sending existing Calendar data to providers. Prefer a disposable account/calendar and synthetic events.
- Do not expose secrets, alter stored settings/flags, provision services, restart an existing backend, or connect a second executor to its database without authorization.

## Proposed execution units

1. Research actual runtime paths and reusable timing hooks; establish tool coverage and precise metric definitions.
2. Implement minimal correlated instrumentation and deterministic regression tests.
3. Implement scenario runner, safe live-execution gates, exports, and documented commands, using the instrumentation contract.
4. Verify the integrated benchmark, run authorized cases, and produce an evidence-backed bottleneck report. If prerequisites are missing, clearly mark live measurements blocked rather than fabricate results.

## Approval required

Scope approval is recorded above. Live execution still requires the spending ceiling and explicit Calendar data/disposable-target mutation permission. No paid calls, event mutations, stored-setting changes, backend restart, or second database executor are authorized by these artifacts alone.
