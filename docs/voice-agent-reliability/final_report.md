# Voice agent reliability — 3 November 2026

## Outcome

Two reproducible recovery defects fixed in the working tree; the original reported persistence incident is **not yet root-caused**. No promise of failure-free operation or live-service certification.

- Raw WebSocket errors previously called `fail(VOICE_INVALID_STATE)` and permanently ended the voice reservation. They now use the existing disconnect/reconnect path with a fresh connection epoch. Errors discovered while the socket is already closed also use that path rather than destroying reconnect eligibility.
- The agent intentionally sends `response.cancelled` before `audio.start` when interrupted while thinking. The browser previously treated that legitimate event as `VOICE_INVALID_STATE` and disposed the call. It now accepts an unseen pre-audio cancellation with a null audio sequence, retains bounded replay protection, and accepts the next response. Unbound cancellation claiming prior audio remains rejected.
- Runtime diagnostics now retain a fixed allowlisted `failureKind` (`application`, `type`, `validation`, `unexpected`) without messages, stacks, exception names or payloads. A non-database exception can still be wrapped in the public `PERSISTENCE_ERROR` fallback, but operators can now distinguish its category. No public error contract was changed.

## Incident interpretation and remaining evidence

The supplied 12:04:18 runtime error precedes model stream failure and the 12:04:29 voice pause. It is consistent with an upstream runtime failure propagating through the agent, not proof of a speech-provider outage. `PERSISTENCE_ERROR` alone does not establish a database failure because the runtime also uses it for unexpected exceptions. No surrounding raw exception or failed database command was supplied or found in repository log files.

The two near-identical `flow-error` entries can be one error observed by `LiveFlow.error` and again by `VoiceConnection.pause`. They must not be counted as two failed inference attempts. That duplicate logging remains unchanged.

The isolated 12:03 `VOICE_INVALID_STATE` can have several sources. The socket recovery defect is proven in a deterministic test, but historical attribution to that defect is not established.

To finish incident attribution: restart the matched backend/frontend through the operator's normal single-executor handoff, reproduce once, and collect the surrounding runtime/persistence diagnostics including `failureKind` and correlated attempt hash. Do not repeat uncertain inference or external writes automatically. No backend restart, application DB changes, paid provider calls or deployment was performed here.

## Verification

- Regression tests first failed for fatal socket-error recovery (`VOICE_SESSION_ENDED`) and legitimate pre-audio cancellation (`VOICE_INVALID_STATE`).
- Four injected application/type/validation/unexpected runtime failures initially had identical generic diagnostics; regression tests proved the missing classification before the change.
- Telemetry regression initially proved the missing allowlisted category; the test also rejects arbitrary exception labels and payloads.
- Initial focused backend baseline: 276 passed, 8 skipped.
- Backend full tests: **2511 passed, 19 failed, 10 skipped** (277 passing files, 3 failing, 2 skipped). Not a green full-suite result.
- Failures: 17 durable-latency/context/acceptance target failures (this suite already has documented failures in the existing latency backlog); one built-module import failure during concurrent dist rebuild, and one Calendar fresh-coverage authority assertion. No failing voice regression was found.
- Isolated serial rerun of the built assembly and Calendar authority files: **5 passed, 1 failed**. The built assembly passes without concurrent rebuild; the Calendar authority assertion still fails. It was not repaired or claimed baseline-confirmed in this voice task, because overlapping Calendar work pre-existed.
- Focused final backend regression run (`gateway.spec.ts`, `voice-output.spec.ts`, `telemetry.spec.ts`): **48 passed**.
- Frontend full tests: **601 passed**, 75 files.
- Backend and frontend builds: **passed**. Frontend reports a bundle-size warning.
- Backend and frontend lint: **passed with warnings**; no cleanup of unrelated warnings attempted.
- Backend e2e: **22 passed, 138 skipped**. Skips are not database/service evidence.
- `git diff --check`: **passed**.
- Unified review: **skipped**, not passed.

## Change ownership

Baseline HEAD was `ffb402f`; approval documentation commit is `a0e4507`. Source/test changes remain uncommitted to avoid capturing pre-existing overlapping calendar edits in `durable-chat-runtime.ts`. Only this task's small runtime diagnostic hunk was added; all pre-existing changes were preserved.

Task-owned edits: backend `voice/transport/voice.gateway.ts`, `voice/transport/voice-connection.ts`, `operations/telemetry.ts`, the runtime diagnostic hunk, `test/voice/transport/gateway.spec.ts`, `test/runtime/voice-output.spec.ts`, `test/operations/telemetry.spec.ts`, frontend `src/api/voice-client.ts` and its transport test. Goal/state/report live in this directory.

The user cancelled the initial researcher, then explicitly required direct work without skills or agents. All subsequent investigation, implementation and verification were performed in this session.
