---
objective: turn-status-ux
workflow: maw-lite
status: complete
source: User request in this chat; docs/turn-status-ux/goal.md
goal_status: approved
dag_status: complete
resume_gate: authorized
---

# State & Execution Plan: turn-status-ux

## Workflow configuration

- Keep all workflow artifacts directly in `docs/turn-status-ux/`.
- Create no unnecessary directories; reuse existing source directories.
- Mandatory phases: Brainstorming, planning, execution, and final verification.
- Current authorization: Worker complete; final verification recorded.
- File preservation: Do not stage or overwrite unrelated uncommitted work (`backend/src/main.ts`, `backend/test/operations/`, `backend/scripts/`, `docs/terminal-close-launcher/`).

## Workflow milestones

- [x] Step 1: Brainstorming & Goal Alignment (`docs/turn-status-ux/goal.md`; `838803f`)
- [x] Step 2: Planning Completed (`docs/turn-status-ux/plan.md`; `9bd125f`)
- [x] Step 3: Execution Completed (Worker finished; `8be4e3b`, `5988c70`, `4a17a2b`)
- [x] Step 4: Final Verification & Report (`docs/turn-status-ux/final_report.md`; `f7e1ce7`)

## Brainstorming tasks

- [x] Explore project context: source request, existing code, tests, conventions.
- [x] Clarify requirements, edge cases, scope boundaries.
- [x] Present design for approval.
- [x] Write and commit the validated `goal.md`: `52e0103`, shimmer `838803f`.
- [x] Obtain explicit user approval of written specification.
- [x] Construct state tracking, plan scope, file ownership, and exit gate below.

## Initial findings

- `MessageItem` currently renders Generating… / Finalizing… below assistant content for the whole in-flight turn.
- Live bubble is the in-flight `MessageItem` in `Transcript` with `liveStatus={state.turnStatus}`.
- Composer already disables submit while `isStreaming`; that flag stays true through finalizing until a terminal stream action.
- Frontend Vitest is Node, not a browser DOM; presentation rules should be tested via a pure helper.
- Caret already exists in CSS for generating/streaming content.

## Confirmed product decisions

- Approach A: render-only presentation change; no reducer status machine.
- Generating… only on empty live assistant content, at the top of the message body, with a CSS text shimmer (reduced-motion: static).
- First token removes the label and shimmer.
- Finalizing… never shown.
- Send stays locked through finalizing.
- Cancelled / failed / interrupted / truncated remain after content; completed has no badge.
- No session rename/delete, no spinner/skeleton/bouncing dots.

## Dependency matrix & execution status

| Plan ID | Title & Scope | Worker dependencies | Touched files / subsystems | Planner status | Worker status | Commits |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Plan 1** | ChatGPT-style generating placeholder, hide Finalizing…, keep composer lock | None | Frontend `MessageItem`, optional presentation helper, `chat.css`, composer only if lock gap, focused frontend tests | [x] `9bd125f` | [x] Complete | `8be4e3b` `5988c70` `4a17a2b` |

## Plan scopes, file ownership, and completion gates

### Plan 1 — Turn status presentation
**Deliverable:** `plan.md`; MessageItem presentation contract plus Generating… shimmer
**Owned files:**
- `frontend/src/components/MessageItem.tsx`
- `frontend/src/styles/chat.css`
- Optional small helper colocated with MessageItem or `frontend/src/features/chat/`
- `frontend/src/components/Composer.tsx` only if AC4 lock needs a test-backed guard
- Focused frontend `*.test.ts` for the presentation table and send-lock invariant
**Scope:** Implement `docs/turn-status-ux/goal.md` presentation table, shimmer CSS with reduced-motion, and composer lock preservation. No backend, protocol, reducer status enum, or session-management UX.
**Exit gate:** Frontend tests prove AC1–AC3 and AC5–AC8 via a pure helper; AC4 submit remains disabled while `isStreaming` including `finalizing`; AC1b shimmer class only on the empty generating placeholder; `frontend` `npm test` and `npm run lint` pass.

## Acceptance coverage

| Goal criterion | Primary owner(s) | Integrated verification |
| :--- | :--- | :--- |
| AC1 Generating… on empty live bubble at top | Plan 1 | Final verification |
| AC1b Shimmer class on that label only | Plan 1 | Final verification |
| AC2 No in-flight labels once text exists | Plan 1 | Final verification |
| AC3 Never render Finalizing… | Plan 1 | Final verification |
| AC4 Send locked through finalizing | Plan 1 | Final verification |
| AC5–AC8 Terminal badges unchanged | Plan 1 | Final verification |
| AC9 User bubble / markdown / retry unchanged aside from labels | Plan 1 | Final verification |

## Final verification commands and evidence

| Working directory | Command | Expected purpose | Result |
| :--- | :--- | :--- | :--- |
| `frontend` | `npm test` | Presentation and lock unit tests | PASSED 16 files / 98 tests |
| `frontend` | `npm run lint` | Lint | PASSED exit 0 with existing warnings |

## Artifact and commit record

| Artifact | State | Commit |
| :--- | :--- | :--- |
| `goal.md` | Approved | `838803f` |
| `state.md` | Complete | this commit |
| `plan.md` | Written | `9bd125f` |
| `final_report.md` | Complete | `f7e1ce7` |

## Current gate and resume procedure

**CURRENT GATE: COMPLETE**

Resume steps:
1. [x] Read this state, approved goal, and current git status.
2. [x] Check current gate and prerequisites.
3. [x] Dispatch planner in foreground.
4. [x] Dispatch worker in foreground with `docs/turn-status-ux/plan.md`.
5. [x] Perform final verification and commit final report.
