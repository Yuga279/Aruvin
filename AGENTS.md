# Aurvin project instructions

These instructions apply throughout this repository. Follow the user's latest instructions and more specific directory instructions. Requirements, implementation, and verification evidence are distinct; do not infer readiness from source or document existence.

## Current status and sources

- Root instructions and Phase 1 execution were approved on 6 October 2026 ("Everything is approved, you can proceed"), recorded in `docs/aurvin-phase-1/state.md`. The old awaiting-approval gate is closed; this does not authorize external provisioning, paid checks, or public deployment.
- The state records P1–P9 workers complete and all ten plans committed. P10 integrated verification is in progress; final verification/report remain pending. The recorded assembled smoke passed on isolated standalone MongoDB, with a replica-set limitation; it is not topology or Azure certification.
- Some preparation-era paragraphs in `state.md` still describe the old approval/scaffold state. Use its dated approval evidence, dependency status, and current gate alongside actual source/configuration and reported commits; reconcile stale records when advancing the workflow.

- `README.md`: local setup, admitted topology, startup modes, and check prerequisites.
- `docs/aurvin-phase-1/goal.md`: approved Phase 1 boundaries and acceptance criteria.
- `docs/aurvin-phase-1/state.md`: execution index, ownership, dependencies, and commit/status records.
- `docs/aurvin-phase-1/research.md`, `plan1.md` through `plan10.md`: compatibility findings and committed implementation plans.
- `docs/aurvin-phase-1/operations.md`, `staging-evidence.md`: operational procedures and actual/unrun drill evidence. `verification.md` and `final_report.md` are not yet present; do not claim final verification is complete.

## Workflow constraints

Use the MAW skill for this workflow. The user selected `--skip review`: skip unified review and do not dispatch a reviewer or a review-triggered fixer. Planning, execution, meaningful tests, compatibility checks, defect correction, and final verification remain required. Record review as **skipped**, never passed. Do not reinstate it unless the user changes this instruction.

When orchestrating MAW, manage graph/status/dispatch and serialize shared commits; do not write implementation code or ingest `research.md`/`plan*.md` for execution management. Use researcher/planner summaries and reported commits; assigned agents read their own artifacts. Respect separate planner/worker prerequisites and ownership in `state.md`; a committed plan does not satisfy a worker dependency. The recorded four-slot capacity permits at most three child agents alongside the orchestrator. Documentation maintenance alone does not require dispatching agents.

## Repository wiring and development

- `backend/` and `frontend/` are separate npm packages with separate lockfiles; there is no root package/workspace script. Run `npm ci` and package commands in the relevant directory. Both require Node `^22.22.3 || ^24.15.0 || >=26.0.0`.
- Backend uses ESM/TypeScript NodeNext: local TypeScript imports use `.js` specifiers. `backend/src/main.ts` bootstraps Nest; `app.module.ts` shares one `AppService` composition across chat HTTP and operations. `app.service.ts` wires persistence, fixed assets, model limits, context, runtime, and telemetry; do not instantiate a second runtime or persistence-close owner.
- Backend boundaries: `contracts`/`platform` shared types/config/identity, `persistence`, `context`/`instructions`, `model`, `agent`/`chat-runtime`, `http`, and `operations`. Preserve P1 ownership of contracts/manifests and P9 ownership of central wiring during MAW work.
- `frontend/src/App.tsx` is a thin `ChatProvider`/`ChatView` shell. Chat behavior lives in `features/chat`; client/protocol live in `src/api`. P10 owns chat `integration-tests/**`; P8 retains operations policy/source while P10 owns actual staging evidence entries.
- Run backend `npm run start:dev` and frontend `npm run dev -- --host 127.0.0.1` separately. Vite proxies `/api` to port 3000; a backend-port change also requires updating `frontend/vite.config.ts`.
- Backend bootstrap loads `.env` from its working directory. Fixed assets resolve to `backend/src/instructions/system.md` and root `product_knowledge.md`; keep the full checkout layout for releases. Nest build does not package those Markdown assets into `dist`.
- Blank external settings allow diagnostic liveness only: `/api/operations/live` works, `/api/operations/ready` returns 503, and chat is unavailable. Invalid config/assets fail startup. A leftover executor sentinel is taken over on restart so watch reloads and unsafe exits can boot; do not run two live backends against one database. Readiness is not a restart probe; provider outages must not cause restart loops or paid health calls.
- Browser configuration is only `VITE_API_BASE=/api`; never put credentials, user identity, or model overrides into `VITE_*` settings. Backend binds loopback; CORS is not authentication.

## Phase 1 scope

Phase 1 is text chat using LangGraph, server-side OpenRouter, NestJS/TypeScript, and React/Vite/TypeScript: new chats, session sidebar, durable history, welcoming empty state, and streamed responses. Use one backend-configured model without a UI model picker. New Chat stays unsaved until its first accepted message.

Context contains system instructions, basic guardrails, `product_knowledge.md`, the selected current-session history, and the new user input exactly once. Aurvin may answer general questions; product knowledge is background about Aurvin. Account for checkpoint-restored messages to avoid duplicating application-loaded history.

Resolve the hardcoded Phase 1 user ID on the server and send OpenRouter's `user` field on every model attempt. Keep identity ready for future authentication without trusting arbitrary client-supplied identity. Authentication is deferred; initial use is local or access-controlled staging. Public production access remains undecided and requires access-control requirements to be settled before rollout.

Live MCP connections, tool execution, automatic compaction, summary generation, episodic extraction, embeddings, and cross-session retrieval are outside Phase 1. Prepare their storage boundaries and linkage without implementing those features now.

## Persistence and memory

Use the agreed six-collection layout, subject to verified service capabilities:

| Collection | Responsibility |
| --- | --- |
| `sessions` | One bounded metadata document per chat; navigation and lifecycle information. |
| `messages` | One document per visible message; durable UI transcript and ordering. |
| `agent-memory` | Bounded context manifests referencing original records and active ranges; future artifacts carry provenance and revisions. |
| `metadata` | Bounded attempts, accounting, and lifecycle evidence; future tool-call events and causal links. |
| `checkpoints` | Standard LangGraph checkpointer state. |
| `checkpoint_writes` | Standard LangGraph pending checkpoint writes. |

Messages are the UI archive; checkpoints serve resumable graph execution; agent memory controls context selection. Initially reference messages instead of copying them. Future compaction must preserve the UI transcript. Avoid unbounded transcript or tool-result arrays inside one document. Bound record sizes, manifests, and query/page sizes.

Use stable user, session, turn, event, message, and attempt identifiers, with provider request/generation identifiers when available. Use ordered event sequences and causal links rather than timestamps alone. Future tool events must link to their originating turn/assistant event and matching result; context selection must preserve valid call/result groups. Do not store private model reasoning.

R1 is partially blocked: the actual Azure product/API/tier remains unknown. Native persistence code exists, but Azure compatibility is not certified. Before admitting an Azure profile, verify service identity, document limits, enabled features, partition/index rules, transactions, and standard checkpointer compatibility with primary documentation and isolated service tests. Do not assume Cosmos DB has native MongoDB semantics or a universal 16 MB document limit.

Admitted chat requires native MongoDB replica-set configuration and one `single-process` executor per database. Default admission takes over a leftover sentinel after watch reload or an unsafe exit so the next process can listen. Do not run overlapping live executors. Opt-in local crash recovery still follows `operations.md` handoff/reconciliation; never delete the sentinel merely because a session lease expired.

## Reliable chat behavior

- Persist acceptance before inference. Implement accepted, generating, finalizing, completed, and explicit failed/cancelled/interrupted outcomes as specified in `goal.md`; distinguish length truncation.
- Confirm completion only after required checkpoint and application finalization are durable. Streamed text is provisional until terminal status is confirmed.
- Make submissions idempotent and enforce one active generation attempt per session across tabs within the admitted single-process topology. Explicit retry creates a new attempt linked to the same accepted user input; do not imply multi-instance support.
- Define crash recovery and reconciliation without assuming cross-collection transactions. Reuse saved graph results during finalization recovery rather than silently repeating inference.
- Distinguish cancellation, disconnects, provider errors, and persistence errors. Do not claim exactly-once provider billing or guaranteed charge prevention through cancellation.
- Enforce finite input, output, context, concurrency, timeout, and retry budgets. Owning plans choose and verify concrete limits; do not silently discard history at a context limit.

## Implementation and operations

Keep provider integration, persistence, context assembly, graph orchestration, transport, and UI responsibilities separate behind shared contracts. Follow existing TypeScript/module configuration and reconcile dependencies through P1. Respect central application wiring ownership.

Keep keys and credentials server-side, validate requests, render Markdown safely, and correlate logs without secrets or message/tool payloads. Provider `user` attribution complements durable application accounting; it does not establish authorization. Present useful user-facing failures without backend implementation details.

Implement and verify readiness, degradation, shutdown/drain, telemetry, staging access, proxy streaming, retention, backup/restore, and migration/rollback through their assigned plans. Record measurements and limitations. A local chat success does not establish production readiness. These documents alone do not authorize external infrastructure provisioning or deployment.

### Ponytail, lazy senior dev mode:

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size, lazy means less code, not the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment naming the ceiling and upgrade path.

Not lazy about: understanding the problem (read it fully and trace the real flow before picking a rung, a small diff you don't understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs (the platform is never the spec ideal, a clock drifts, a sensor reads off), anything explicitly requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind, the smallest thing that fails if the logic breaks (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.

For this repository, retain the established Vitest/fixture requirements in "Verification and reporting"; the minimal-check rule does not waive required suites or instruct agents to replace existing test infrastructure.

### File Header Requirements

**MANDATORY** for all code files:

**Example Header Style**
```typescript
/**
 * ============================================================================
 * FILE: <filename>
 * LOCATION: <filepath>
 * ============================================================================
 *
 * PURPOSE:
 *    Brief 1-line description of what this file does
 *
 * ROLE IN PROJECT:
 *    How this file fits into the larger system (2-3 lines)
 *
 * KEY COMPONENTS:
 *    - Component1: What it does
 *    - Component2: What it does
 * ============================================================================
 */
```

**Enforcement:**
- New files: ALWAYS add header before first write
- Existing files: Add header when modifying >30%
- Use the language's valid comment syntax; keep shebangs/directives in their required position. Do not insert comments into strict JSON or generated files.

## Verification and reporting

Use the package manifest in the relevant directory. Current checks are:

| Directory | Existing checks |
| --- | --- |
| `backend` | `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e` |
| `frontend` | `npm run build`, `npm run lint`, `npm test` |

- Focused checks from either package: `npm test -- <relative-test-path> -t "<test-name>"`. Backend routine discovery is `*.spec.ts`, excluding Azure/behavior/e2e suffixes; frontend discovery is `src/**/*.test.ts` in a Node environment, not a browser DOM.
- Backend `npm run test:azure` and `npm run test:behavior` exist and use separate configs. Both allow empty discovery; exit code zero with no tests is not evidence. Native integration suites can also skip when prerequisites are absent; report skips separately.
- Native database tests require operator-supplied `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`. Fixtures create/drop isolated generated databases: never point them at application/production data. Do not print URIs or credentials.
- Use deterministic provider fixtures for routine checks. Live/service/staging checks need explicit authorization and bounded cost/data exposure. Test idempotency, concurrency, recovery, context ordering/bounds, streaming terminal states, provider attribution, compatibility, and isolation; source presence is not a passing result.

Documentation-only changes require document/link/graph consistency checks rather than unrelated application tests. Skipped review does not waive failed checks or defects; route fixes to their owning workers. Final verification records the actual commit set, environment, checks, results, and limitations. Mark the workflow complete only when required evidence and the final report are complete.

## Workspace and Git hygiene

Preserve user changes and untracked local configuration (including `.openchamber/`). Stage named task files explicitly; do not use `git add .` or include secrets, dependencies, generated output, or unrelated work. Source is already tracked; do not recreate the old scaffold baseline. Keep commits focused and ownership/status/commit records accurate. Do not reset, delete, or overwrite user work to simplify execution.

Use `codex/` for new branches unless the user specifies otherwise. Report artifacts using clickable paths and distinguish planned, implemented, tested, skipped, and awaiting-approval states.
