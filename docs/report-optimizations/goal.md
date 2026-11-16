# Validated diagnostic-report optimizations

## Source and authorization

User request, 30 October 2026: investigate `C:/Users/Peter/.gemini/antigravity/brain/5768b6f6-0bb8-46e9-b04a-b2541356afb8/diagnostic-report-optimizations.md`, assess validity, then use one subagent per valid opportunity to implement it. The user then directed direct multi-agent execution without skills or approval checkpoints. This session implemented O1-O3; the user owns O4 in another live session. Unified review remains skipped under repository instructions.

## Findings and proposed scope

### 1. Stable response-mode prefix — valid with coordinated contract changes

The assembler currently inserts the current response-mode system message between history and the latest user input. Moving it immediately after fixed assets improves reusable prefixes for unchanged mode and history. The system asset explicitly specifies the old position, so changing only the assembler would leave contradictory instructions. Update that instruction and all affected assertions, preserving exactly one authoritative current selector, unchanged history order, one new input, budgets, voice delivery semantics, and calendar redaction.

The report's claim that zero history can ever be cached is false: adjacent later turns can share history preceding the earlier selector. Cache savings and latency depend on provider framing, thresholds, routing, lifetime, and history changes. Message-array prefix tests are not proof of provider token-cache hits. No guaranteed percentage or paid measurements.

### 2. Anthropic cache enablement — valid, conditional on configured model

Current text request serialization has no cache control. Current OpenRouter documentation supports top-level `cache_control: { type: 'ephemeral' }` for Anthropic automatic advancing caching, as well as explicit content-block breakpoints. Prefer the documented top-level form if it works with the existing request paths, avoiding new public schemas and string-to-block conversions. Apply only to supported explicitly configured Anthropic model identifiers; leave other providers unchanged. Inspect both ordinary and calendar model serialization and reuse the shared provider policy if appropriate. Preserve attribution, privacy, disabled transforms/plugins, tools, limits, retry behavior, and accounting. Do not edit already-dirty adapters/tests without explicit ownership reconciliation.

Cache-write premiums, minimum prompt thresholds, expiration, endpoint availability, and cache reuse mean lower cost is conditional, not guaranteed. No model switch or live call is authorized. Reference: https://openrouter.ai/docs/guides/best-practices/prompt-caching (retrieved through Context7).

### 3. Batched transcript acceptance checks — valid for internal user records

Replace sequential acceptance metadata lookups in `MongoMessages.list` with one bounded scoped batch query when candidate records exist, and none otherwise. Preserve exact user/session/message/turn matching, hidden unconfirmed records, result ordering, pagination cursor semantics, redaction, and public output shape. Prefer existing indexes and deterministic identities where sufficient; add an index only if the actual chosen lookup requires it, with appropriate tests. Maintain sanitized persistence errors. No Azure compatibility or measured remote latency claim.

### 4. Batched UI stream deltas — valid; incremental parser deferred

Coalesce bursty deltas at the presentation-state boundary using a small frame/timer scheduler without altering raw SSE envelope delivery, validation, identity, or sequence semantics. Cover submit and retry consistently. Preserve reset replacement, event ordering, pending text before terminal/error events, interruption/cancellation behavior, and isolation across new chat, session switches, retries, abort, and unmount. Bound background-tab delay where necessary and cancel stale callbacks. Use deterministic scheduler tests in the established Node Vitest environment.

Keep existing safe Markdown parsing and canvas behavior. Do not implement a new incremental Markdown parser: the report supplies no correctness strategy or measurement justifying that larger change. Frame batching reduces update frequency for bursts but does not change full cumulative parsing's asymptotic complexity or guarantee savings when arrivals are already slower than frames.

## Execution boundaries

- Exactly one opportunity agent for each of the four opportunities, reused for its research, planning, execution, and fixes rather than spawning separate agents for each phase. At most three active children alongside the orchestrator. The orchestrator maintains documentation and verification, not implementation code.
- Each agent first prepares its own plan and reports a summary; implementation follows committed planning and ownership checks. The orchestrator does not ingest plan/research artifact bodies. Serialize staging and commits.
- O1 owns context assembly, response-mode system documentation, and affected selector assertions. O2 owns model policy/cache serialization and dedicated tests. Coordinate any shared tests before editing; do not touch existing dirty model adapter work. O3 owns transcript acceptance batching and dedicated persistence tests, with indexes only if justified. O4 owns presentation-side delta batching and dedicated frontend tests.
- Preserve all initial tracked/untracked changes, particularly existing calendar/runtime/adapter/performance work and local configuration. No broad staging, resets, paid/service calls, external provisioning, or deployment.
- Deterministic failing-then-passing tests for each change, followed by backend and frontend build/lint/unit checks and backend e2e where prerequisites permit. Record unavailable native prerequisites and skips separately. Baseline failures in the dirty checkout are not automatically attributed to these changes.
- Final report distinguishes structural evidence and actual tests from unmeasured cost, TTFT, database latency, and browser FPS. Unified review: skipped, not passed.

## Acceptance

- All four valid cores implemented with the safety constraints above and runnable regression checks.
- One agent per opportunity and no unrelated implementation changes.
- Preserved user work; named-file commits and accurate results/limitations recorded.
- No unsubstantiated performance percentages, cache-hit guarantees, or production/Azure certification.
