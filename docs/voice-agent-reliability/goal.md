# Voice agent reliability

## Requested outcome

Investigate the voice failures reported on 3 November 2026 and fix demonstrated causes with regression tests. Absolute failure-free operation cannot be guaranteed across databases, networks, browsers and external providers.

## Scope and acceptance

- Trace `VOICE_INVALID_STATE`, runtime `PERSISTENCE_ERROR`, and downstream `VOICE_AGENT_FAILED` across browser, transport, agent, runtime and persistence boundaries.
- Reproduce suspected defects with deterministic tests before implementation; distinguish actual storage failures from exceptions wrapped as persistence errors.
- Fix root causes in shared owners, including sibling callers, with the smallest supported changes.
- Keep recoverable failures from unnecessarily ending the call. Preserve durable accepted input and honest delivery states; do not falsely report completion.
- Preserve ordering, cancellation, bounded budgets, provider accounting and single-executor constraints. Never automatically repeat inference or calendar writes when delivery or execution is uncertain.
- Improve sanitized diagnostics where needed to identify the failing stage without logging message content, credentials or private model reasoning.
- Run relevant regression suites, builds and lint; report actual results and any unavailable service verification separately. Unified review remains skipped.

## Constraints

Preserve all pre-existing uncommitted changes, particularly calendar/runtime/frontend edits. Coordinate before touching overlapping files. No paid provider calls, production database changes, infrastructure provisioning or deployment. No broad redesign, new dependency or speculative unlimited retries.

## Initial evidence and limits

The reported runtime error precedes model stream termination and voice flow failure. The runtime uses `PERSISTENCE_ERROR` as a fallback for non-AppError exceptions, so storage failure is not established by this code alone. `LiveFlow.error` and `VoiceConnection.pause` both log `flow-error`, explaining a possible duplicate diagnostic rather than two failed turns. `VOICE_INVALID_STATE` has multiple sources, including raw socket errors; its exact cause remains unproven.

## Approval

Approved on 3 November 2026 through the scope approval form: “Approve investigation and fixes”.
