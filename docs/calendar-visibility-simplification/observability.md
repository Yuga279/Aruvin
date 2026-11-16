# Process visibility runbook (P1)

Offline, fixture-derived evidence for diagnostic contract v1. This is not the observed live incident.

## Contract v1

`Telemetry.event('process', fields)` emits one JSON Lines record per observation. `diagnosticVersion` is fixed `1`. A process event without an allowlisted `stage` is dropped.

Implemented stages: `admission`, `context`, `model-dispatch`, `model-response`, `model-decision`, `validation`, `cursor`, `authority`, `cache`, `tool-execution`, `provider-request`, `provider-response`, `correction`, `persistence`, `finalization`, `task-outcome`, `runtime-error`, `terminal`.

Closed enums, hashed correlation IDs (`h:` + 24 hex), allowlisted `field` paths, Calendar codes, and a `summary` built only from projected fields follow `plan1.md` Diagnostic contract v1.

Schema fingerprint is SHA-256 of the static `CALENDAR_TOOLS` / `CALENDAR_TOOLS_V1` catalogue JSON, not arguments. Map:

- `google-calendar.v1` / `google-calendar.v2` from `CALENDAR_DIAGNOSTIC_FINGERPRINTS` in `backend/src/model/calendar-adapter.ts`.

## Where logs go

The existing injected `writeLog` sink. Default AppService writer prints noteworthy lines (turn outcomes, faults, readiness, recovery, shutdown) to stdout when `process.stdout.writableNeedDrain` is false; under backpressure the line is dropped. Set `AURVIN_LOG_LEVEL=debug` to print every process/request/voice trace. There is no application log file, rotation, or queue. Records are not guaranteed durable. Successful persistence writes stay metrics-only and are not process events.

Custom sinks must stay synchronous and bounded. Telemetry never queues sink work. A throwing sink increments `log_failure` and does not change chat.

## Follow one turn

Startup is not authorization for a chat or provider call. Run only against an already configured local environment when the operator permits startup.

```powershell
# Run only against the already configured local environment when its operator permits startup.
# Startup itself is not authorization for a chat/provider call.
$env:AURVIN_LOG_LEVEL = 'debug'
npm run start:dev 2>&1 | Tee-Object -FilePath "$env:LOCALAPPDATA\Temp\opencode\aurvin-process.log"
```

```powershell
$records = Get-Content "$env:LOCALAPPDATA\Temp\opencode\aurvin-process.log" | ForEach-Object {
  try { $_ | ConvertFrom-Json -ErrorAction Stop } catch { }
}
$records | Where-Object { $_.kind -eq 'process' } | Select-Object at, requestId, attemptId, summary
```

```powershell
# Copy one pseudonymous attemptId from the previous display, never a raw token/cursor.
$attempt = Read-Host 'Pseudonymous attemptId'
$records | Where-Object { $_.kind -eq 'process' -and $_.attemptId -eq $attempt } |
  Select-Object at, requestId, dispatchId, decisionId, toolCallId, operationId, summary
```

This optional operator-created file has no application TTL or rotation; shell/host retention applies. Keep it local and remove that specifically named file after diagnosis under operator policy. Do not dump `.env` or payloads. The HTTP submit and stream are two requests: join them by the hashed accepted `attemptId`, not an invented single request ID.

## Interpret outcomes

- `origin=local` and `delivery=not-sent`: stopped before Google/OpenRouter fetch.
- `origin=cache` and `delivery=not-sent`: used a stored snapshot; not a Google request.
- `delivery=attempted`: fetch invoked, not proof of remote receipt.
- `delivery=response-received`: an HTTP response arrived; not proof a write succeeded.
- `chat` is durable application delivery. `task` is Calendar execution. `writeCertainty` is write receipt. A completed fallback is `(chat: completed, task: fallback)`.

## Privacy and bounds

Hard ceiling 4096 UTF-8 bytes per record; `summary` at most 512 characters. At most `min(limits.diagnosticCount, 10)` validation observations per rejected decision. No per-token, per-SSE-frame, or per-argument records. Detail flags cannot enable payload logging. Development and production use the same projection.

Hashed IDs are pseudonymous and linkable, not anonymous. Raw prompts, messages, arguments, tokens, URLs, event text, and stacks are omitted. `task-outcome` is a stage name; secret redaction must not treat the substring `sk-` inside that name as an API key.

## Offline diagnosis

Reproducer: `backend/test/assembly/calendar-observability.spec.ts` through `assembledCalendarApp` with a captured `writeLog`. Command: from `backend`, `npm test -- test/assembly/calendar-observability.spec.ts`.

Observed on fixtures (10 passed):

- Local cursor-format rejection, correction 0/2, cache hit, successful list, `task=success`, `chat=completed`, zero Google HTTP, three model dispatches.
- Three invalid cursors: `REPAIR_EXHAUSTED`, `task=fallback`, `chat=completed`, no `task=success`.
- Throwing sink: same durable status, frames, and call counts as a recording sink.
- Google events 400: `provider-request` attempted and `provider-response` 4xx/`CALENDAR_INPUT_REJECTED`, not a cursor stage.
- Forced missing discovery: actual discovery HTTP then local list snapshot (`tool-execution` cache).
- Provider request IDs hashed; event summary/description/location and tokens absent.
- Lost create POST: one POST, `task=uncertain`, `writeCertainty=unknown`, no confirmed write.
- Two production-assembly attempts held at independent model-fetch promises and released in reverse order retain their own hashed attempt/generation IDs and completed outcomes.
- Default stdout drops under backpressure and writes one bounded line otherwise.

## P1 commit-inspection gap closure

| Gap | Evidence added and result |
| --- | --- |
| HTTP submit-to-stream correlation | `npm test -- test/assembly/calendar-flow.spec.ts` (2 passed): real Nest `AppModule` POST and SSE GET have distinct server request IDs; admission belongs to the POST ID and model dispatch/terminal to the stream ID, joined by the same hashed accepted attempt ID. |
| Interleaved concurrent production attempts | The 10-test assembly suite gates two AppService model fetches, completes B before A, and checks generation/attempt correlation without cross-talk. |
| Diagnostic-count maximum/budget boundary | `npm test -- test/model/calendar-validation.spec.ts` (98 passed): a multi-issue candidate verifies limits 0, 3, 10, and 100; emission never exceeds `min(diagnosticCount, 10)`. |
| Ordinary-chat private exception | `npm test -- test/operations/runtime.spec.ts` (7 passed): a private provider exception reaches the durable runtime catch; logs contain only safe interruption facts, with no console print, prompt, exception, or stack. |
| Feedback, answer, and recovery outcomes | `calendar-feedback.spec.ts` (5 passed), `calendar-answer-regressions.spec.ts` (15 passed), and `calendar-recovery.spec.ts` (5 passed) assert correction success/fallback, denied/successful answers, and recovery's unknown task/write certainty with actual terminal status. |

Two missing emissions were corrected: direct authority denial now records `authority/rejected/access-denied`; Calendar recovery now records durable finalization and task/terminal outcomes without repeating inference or writes.

Worker commits in order:

1. `9522cf4` feat(operations): add bounded safe process diagnostics
2. `c476854` feat(calendar): expose precise safe rejection facts
3. `2538fad` feat(operations): trace actual model and calendar delivery
4. `0ba16ec` feat(runtime): distinguish chat delivery and calendar task outcomes
5. `8d12bd3` test(operations): verify assembled calendar process traces
6. `4326a1c` test(operations): close P1 diagnostic evidence gaps

Verification chronology: build, lint, full routine, and e2e checks ran against the completed working tree before `4326a1c`; the assembly observability suite was rerun after that commit (10 passed). Results: `npm run build` passed; `npm run lint` passed with warnings confined to existing `test/voice/**` cases; `npm test -- --no-file-parallelism` 2,033 passed / 10 skipped; `npm run test:e2e` 22 passed / 129 skipped. Focused checks: assembly observability 10 passed, HTTP assembly 2 passed, calendar validation 98 passed, ordinary runtime 7 passed, feedback 5 passed, answer regressions 15 passed, recovery 5 passed. Native database fixture was unconfigured (`AURVIN_TEST_MONGODB_URI` and expected prefix absent), so native checks remain unrun/skipped. No live Google/OpenRouter calls.

Prefer these fixture traces when sharing evidence. No screenshots, dashboards, or frontend panels.

## Evidence gaps

The live incident's actual arguments, failed boundary, selected-model repair behavior, and owned-calendar answer remain **unobserved/unrun**. Source inspection is not incident evidence. `owner` access role is manager access, not proof of data ownership. P1 does not solve that P2 question.

Native MongoDB checks require operator-supplied isolated `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. Absent prerequisites are skipped/unrun, not passed. No Google/OpenRouter live calls were made.

## P2 handoff

P2 may plan against this contract and the assembled tests. Preserve or version the `process` v1 fields. Local rejection stays `not-sent`. Only the actual Google fetch seam emits `attempted`/`response-received`. A true cache hit has zero Calendar HTTP. Correlation, precise reasons, bounded corrections, independent fallback/clarification/uncertain-write, redaction, and throwing-sink isolation must survive simplification. A retained event without its actual stage, a stale provider label, or lost correlation fails AC9.

Shared paths remain P1-owned until orchestrator handoff: telemetry, observed runtime, persistence proxy, diagnostic port, durable runtime, Calendar loop, adapters, `app.service.ts`.

Review is **skipped**, not passed. Live gate remains blocked/unrun.
