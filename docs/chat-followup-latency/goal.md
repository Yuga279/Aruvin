# Faster follow-up chat without weaker durability

## Goal and approval boundary

The user approved the **Focused simplification** direction on 2026-11-02: use an isolated worktree, reuse existing components, target sub-100 ms application pre-dispatch/finalization overhead, and preserve durability. They then directed **three task workers, with no separate planning sessions**. Execute the selected scope through exactly three workers; each performs its own brief research/planning, implementation and tests. The later user direction supersedes the proposed separate planner/researcher and additional approval-session structure. External execution remains separately gated.

Investigation: [findings and fresh offline evidence](../latency-reduction/follow-up-investigation.md). Worktree branch: `codex/chat-followup-latency`, starting at `927ab45871d1206e1ac56978c13083fc924ae671`. Concurrent main-checkout context/admin work stays untouched. Findings measured a modified main checkout, not this clean branch; establish this branch's own baseline before comparing a candidate.

## Required product behavior

1. **Draft at any time during text generation and finalization.** Keep the textarea editable; preserve draft text, selection/focus behavior and input-method composition. Sending another turn remains gated until the current turn is durably terminal and its execution/transport reservations are released. No automatic queued sending, overlapping generation, or premature completion indication is introduced. Voice/dictation ownership remains exclusive.
2. **Remove unnecessary sidebar work near Send.** Update/reorder the known active session locally when enough authoritative information is available; reconcile through the existing list API outside the immediate completion-to-follow-up path. Preserve title, pinning, pagination, retry, new-session and stale-session behavior. Do not invent server timestamps or claim local reconciliation is durable evidence.
3. **Prepare ordinary healthy-path context once.** Use the existing bounded admission receipt and confirmed-record helpers, not a new caching framework. Retain actual checkpoint/manifest evidence and accepted settings. Avoid the second full archive/attempt walk and repeated whole-context assembly on a valid same-process attachment when equivalent evidence is proven. Keep necessary compact ownership/version checks and fresh privacy/time/voice projections. Exactly-once inclusion of the new input, valid historical ordering, token/message bounds and server attribution remain unchanged.
4. **Make cache misses and mutable history safe.** Expired, oversized, missing, stale, wrong-scope or invalidated receipts use strict reconstruction or safe refusal. Retention/revocation, mixed Calendar/voice history, response mode, configuration/assets, midnight/time-zone changes, retry, rebase/reconciliation and stream quiescence must not allow stale sensitive context or duplicate provider dispatch. A synthetic checkpoint ID or an unmaintained epoch is not authorization.
5. **Remove demonstrated duplicate durable work.** Reuse existing confirmed manifest/accounting evidence; make the combined session finish operation the single activity-update owner on its supported live path; retain an explicit owner in strict recovery/fallback paths. Group only consecutive storage-only work through existing bounded ownership phases, with unchanged mutation checks, limits, deadlines and failure settlement. Reduce serial dependencies and command count rather than merely renaming or moving them outside measurements.
6. **Keep essential persistence barriers.** Durable acceptance precedes inference, possible-billing evidence precedes provider dispatch, generation identity precedes visible output, and required checkpoint/archive/accounting/manifest finalization plus cleanup precedes terminal completion and the next send. Save failures are supervised and cannot silently become completion. Saved-result recovery must not repeat inference.
7. **Resolve checkpoint duplication only through an admitted implementation.** Investigate/reuse the existing bounded saver read facade. Its production activation remains gated on separately authorized native stock/facade conformance. Offline work can prepare and test it, but must not enable a default path without required evidence. Do not weaken scope/size/pending-write checks, change sync durability to async/exit, or replace LangGraph as a shortcut.

## Performance contract

These are **targets to verify**, not current results or guaranteed provider performance:

| Boundary | Target and method |
| --- | --- |
| Editing a text draft while a response runs | No backend-dependent lock; normal local input remains responsive. |
| Browser Send to visible pending feedback | p95 <=50 ms in a defined foreground-browser workload. |
| Browser Send to first provider dispatch | p95 <100 ms on the explicitly recorded topology/workload, including admission, context, HTTP attachment and application storage. |
| Actual provider stream end to ready-for-next-send | p95 <100 ms on that same profile, including remaining accounting, sealing, publication and resource release. |
| First parsed provider text to delivered/painted text | Measure separately; do not hide identity persistence, coalescing, transport or browser work inside provider TTFT. |
| Deterministic regression | No repeated full archive/attempt scan on a valid proven hot attachment; demonstrably fewer commands/dependencies than this branch's unchanged baseline; existing frozen acceptance gates remain visible and unchanged. |

Record p50/p95 and sample counts, cold/warm paths, history length/bytes, selected context size, model/cache state, database placement/topology, crash-journal mode and source/dependency identity. Application-only measurements use deterministic provider fixtures. Dependency-wave experiments are not native RTT, CPU timing or p95 proof. Do not use the fixture fetch-response marker as actual provider end. Existing diagnostics are preferred; add only missing redacted correlated milestones.

Until an authorized representative native/browser run exists, absolute latency acceptance is **unverified**, even if all offline checks pass. Report any measured miss and its remaining dependencies; never weaken safeguards, trim history, relax thresholds, rebase frozen gates or count skipped checks as passes to meet the number. Provider network/queue/prefill/decode and external tool latency are measured separately and cannot be promised below 100 ms by application refactoring.

## Architecture and scope limits

- Keep React/Vite, NestJS, LangGraph, the existing provider adapter, MongoDB repositories and admitted single-process executor. Prefer deletion and existing receipt/phase APIs over new abstractions.
- Keep the normal path small and reuse already verified state; retain cold/recovery validation where it is needed. Test shared submit/retry/text/voice/Calendar callers rather than fixing only the named UI path.
- No new service, dependency, alternate database, cross-collection transaction assumption, queue infrastructure, model switch, compaction, summarization, authentication project, public deployment, migration or feature-flag enablement.
- No live Calendar effects or relaxation of explicit user confirmation. No changes to privacy/retention or voice delivery semantics to achieve speed.
- No secrets or private payloads in logs/artifacts. No copying application `.env` or starting a second backend against the application database. No paid provider call, real database connection/load, process restart, infrastructure provisioning, service configuration or migration without separate explicit operator permission and bounded data/cost scope.
- Preserve unrelated work. Any integration with subsequently committed main-checkout context changes is an explicit compatibility step; never overwrite or silently omit their behavior during merge.
- Unified review stays **skipped**, not passed. Focused diagnosis, TDD, defect correction and final verification are mandatory.

## Acceptance and verification

- **AC1 interaction:** draft editing and submit guards work through streaming, finalizing, completed, failed, cancelled, retry, navigation and voice-ownership transitions; new text is not lost to an old request's cleanup/error handlers.
- **AC2 context:** proven hot attachments avoid repeated full archive/attempt reconstruction; invalid evidence falls back/refuses; context order, input uniqueness, bounds, retention/revocation, mixed-history voice delivery and dynamic time/environment projections are correct.
- **AC3 durable ordering:** fault-injection and concurrency checks preserve durable acceptance, provider identity/accounting, one active attempt, honest terminal events, release-before-next-send and saved-result recovery without inference replay.
- **AC4 less work:** matching source/fixture comparisons report complete commands and causal dependency boundaries, including ambiguous-write fallbacks and cold paths. Keep original fixed gates and explain remaining failures. Demonstrate each optimization, not a source-presence claim.
- **AC5 compatibility:** backend/frontend builds, lints and established deterministic suites run against the final commit set. Run native/e2e prerequisites only when authorized; record skips/failures separately. Existing failures are isolated against the baseline and routed to the owning worker, not suppressed.
- **AC6 performance honesty:** record actual measurement availability and the performance contract above. Offline completion may be reported separately from blocked real-latency acceptance; never mark the absolute target passed from synthetic counts.
- **AC7 operational safety:** no external effects, paid calls, service/default-facade activation, secrets, unauthorized startup or deployment. Final report records commit set, environment, commands, outcomes and unresolved gates.

Ownership and execution are indexed in [state.md](state.md). No separate planner/researcher sessions will be dispatched; brief planning remains inside the three task workers, followed by implementation and deterministic verification.
