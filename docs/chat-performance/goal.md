# Verify and fix chat performance concerns

## Objective

Verify the four opportunities in the user's request against the current implementation. Assign one fixing subagent per confirmed concern, with minimal changes and regression evidence. Do not treat quoted cost, latency, or frame-rate estimates as measured results.

## Findings and acceptance criteria

1. **Explicit OpenRouter session affinity.** `backend/src/model/policy.ts` clears `sessionId`. Current OpenRouter documentation confirms explicit `session_id` enables stickiness after the first successful request; implicit routing exists without it. Supply a stable, server-derived conversation-scoped key across turns and retries without inheriting global session/tracing environment settings or trusting client identity. Verify serialized payloads, cross-session isolation, and existing attribution/privacy policy. Preserve existing Anthropic cache controls. Do not promise cache hits or a particular saving.
2. **Text first-delta blocking.** `backend/src/model/openrouter-adapter.ts` awaits pre-fetch accounting and generation identity persistence on the text path; `backend/src/chat-runtime/durable-chat-runtime.ts` enables nonblocking behavior only for live turns. Use deterministic delayed-persistence tests to establish avoidable blocking and implement only a safe reduction. Acceptance and possible-billing evidence must remain durable before paid dispatch; asynchronous observations must be supervised, drained, and fail closed before terminal success. Preserve generation identity, cancellation, ownership fencing, retry, and recovery guarantees. Do not blindly enable the live bypass or remove required persistence barriers. If safe removal is not possible within these guarantees, report that constraint rather than weakening them.
3. **Repeated streaming parsing.** `prepareCanvasMarkdown` reparses all changed stream content; its bounded cache avoids duplicate identical parses but not repeated prefix work. Archived artifacts and message components already have caching/memoization. Reduce repeated parsing/render work using the smallest compatible approach, preserving partial Markdown, split fences/tags, math, lists, Canvas identity, terminal output, and reset/session isolation. Add deterministic equivalence and work-growth checks; do not claim guaranteed 60 FPS without browser measurements.
4. **Seal history re-fetch.** Text generation calls `messages.getReferences` despite retaining the context source snapshot. Establish completeness and validity for ordinary, retry, and recovery paths. Reuse validated source records where safe, retaining necessary fallback reads and ownership/version checks. Verify history ordering, exact manifest contents, missing/stale record handling, and reduced query count.

## Execution boundaries

- One dedicated fixing subagent per confirmed concern; at most three children concurrently.
- Separate planning and execution gates; backend runtime edits for concerns 2 and 4 must be serialized. Serialize commits across all agents.
- Unified review remains **skipped** under repository instructions; testing, compatibility checks, defect correction, and final verification remain required.
- Preserve all pre-existing working-tree changes, especially voice integration tests. No deployment, external provisioning, paid provider calls, credentials, or production database access.
- Reuse existing dependencies and patterns; no unrelated refactoring or public API expansion beyond what is necessary.
- Each fix requires a demonstrated failing regression followed by a passing focused check. Run relevant package build/lint/test checks and backend e2e checks; report unavailable prerequisites and skipped tests separately.
- Record actual changes, checks, limitations, and measured versus unmeasured effects in `docs/chat-performance/final_report.md` and track ownership/dependencies in `state.md` after approval.

## Evidence references

- `backend/src/model/policy.ts`: `providerParameters`.
- `backend/src/model/openrouter-adapter.ts`: `stream`, `capture`, pre-fetch save.
- `backend/src/chat-runtime/durable-chat-runtime.ts`: model supervision, `generateTurn` history selection.
- `frontend/src/features/chat/ChatView.tsx`: streaming artifact collection.
- `frontend/src/features/canvas/canvas-artifacts.ts`: `prepareCanvasMarkdown`, `collectSessionCanvasArtifacts`.
- `frontend/src/components/MessageItem.tsx`: existing memoized message rendering.
- OpenRouter documentation: https://openrouter.ai/docs/guides/best-practices/prompt-caching (checked 6 November 2026).

## Approval gate

Status: awaiting user confirmation before dispatching subagents, as required by the repository's MAW workflow.
