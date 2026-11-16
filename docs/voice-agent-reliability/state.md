---
objective: voice-agent-reliability
workflow: direct-session
status: awaiting-incident-evidence
skipped_phases: [review]
source: user-failure-logs-2026-11-03
goal_status: approved
dag_status: initial
resume_gate: authorized
---

# Voice agent reliability state

## Workflow configuration

- Goal: [goal.md](goal.md); approved through the scope approval form on 3 November 2026.
- Branch: `voice-chat-upgrade`; initial HEAD `ffb402f`.
- Preserve all pre-existing dirty files and local configuration. No implementation edits made by this task.
- Unified review: **skipped**, not passed. Research, planning, tests and final verification required.
- User subsequently directed: no skills or subagents; work directly in this session, quickly. This supersedes the initial multi-agent dispatch plan. The researcher was cancelled by the user, not failed, and was not restarted.
- No live/paid/service-changing checks authorized.

## Milestones

- [x] Initial source/log investigation and bounded goal drafted.
- [x] Goal approval.
- [x] Direct source tracing; reproduced fatal socket-error and pre-audio cancellation defects in failing tests.
- [x] Narrow implementation selected: reuse disconnect/reconnect, accept bounded pre-audio cancellation, emit safe runtime failure categories.
- [x] Direct implementation; regression checks passed; full checks recorded with failures.
- [x] Unified review skipped by repository instruction.
- [x] Offline verification and [final report](final_report.md); full backend suite is not green.
- [ ] Original incident persistence root cause: awaiting correlated runtime evidence.

## Initial dependency matrix

| Unit | Scope | Planner prerequisite | Worker prerequisite | Status |
| --- | --- | --- | --- | --- |
| R | Trace reported errors and reproduce roots; report sanitized evidence and exact ownership | Goal approval | N/A | Pending |
| P1 | Confirmed runtime/agent/durability causes and diagnostics | R | Committed plan; overlapping user edits coordinated | Pending |
| P2 | Confirmed transport/lifecycle causes and regression tests | R; P1 if shared contract changes needed | Committed plan; P1 if required | Pending |
| V | Integrated verification and final report | P1/P2 plans | Applicable workers complete | Pending |

Ownership will be narrowed from research summaries before planner dispatch. R owns research documentation only. P1/P2 must not overwrite existing user changes; shared contracts and runtime edits require serialized ownership. A plan's existence does not satisfy a worker prerequisite.

## Acceptance coverage and verification

P1 covers runtime classification, durable state, no unsafe replay and agent propagation. P2 covers state transitions, socket failure handling and recoverable call lifecycle. Both require failing-then-passing deterministic regression evidence. V runs relevant backend/frontend tests, build and lint and records skips, limitations and exact commit set. No live-service success is claimed from fixture tests.

## Current gate

Direct-session implementation is in the working tree. Final focused backend regressions: 48 passed; frontend: 601 passed; both builds/lints passed with warnings; e2e 22 passed/138 skipped. Full backend: 2511 passed/19 failed/10 skipped, including 17 latency/context target failures, a concurrent dist rebuild/import race (isolated serial rerun passed), and one Calendar fresh-coverage authority assertion (still fails isolated). Details in [final_report.md](final_report.md). Preserve pre-existing changes; do not commit the already-dirty runtime file wholesale. Original incident persistence cause remains unconfirmed and is not claimed fixed; no live replay or unsafe retries performed.
