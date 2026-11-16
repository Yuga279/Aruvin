# Final Report: voice-mode-instructions

## Executive Summary

Aurvin now keeps one stable dual-mode system prompt and selects `text` or `voice` with a short backend-owned system message immediately before the latest user input. Mode switching does not rewrite the reusable prefix. `SpeechProse` remains the live safety net. Text chat still uses Canvas/Markdown guidance. Selectors are request-scoped and not stored as transcript or checkpoint conversation history.

This is cache-friendly request construction, not a certified cache-hit rate or a guarantee of model obedience.

## Workflow Configuration

- Skipped Phases: review (explicitly skipped, never passed)
- Worktree / branch: `codex/voice-mode-instructions`, based on `main`
- Goal approval: “Approve and implement”, 16 October 2026
- Protected uncommitted file preserved: `backend/test/voice/agent/voice-delivery.spec.ts`

## Plan Breakdown & Execution Record

| Plan ID | Title | Commits | Status |
| :--- | :--- | :--- | :--- |
| Research | Technical research | `8a607b1` | Completed |
| Plan 1 | Cache-friendly per-request response modes | `f1adc25` | Completed |
| P1 | Dual-mode prompt, selector, budgets, runtime wiring, tests | `fb2652a`, `3c3c7ac`, `115418c` | Completed |

Worker progress notes: `8a16f3b`. Documentation/status commits: `1d00d74`, `0432a86`, `b0a661d`.

## What shipped

- Shared instructions in `backend/src/instructions/system.md` define both modes; Canvas guidance is text-only.
- Assembler/runtime attach one current-mode system selector after history and before the latest user message.
- Selector overhead is reserved in context/startup budgets.
- Deterministic tests cover selector order/authority, prefix equality including captured outbound provider payload, retries/switches, persistence isolation, and exact budget boundaries.

## Verification & Quality Assurance

Independent orchestrator rerun after worker completion:

| Check | Result | Notes |
| :--- | :--- | :--- |
| Focused context/assembly/runtime/adapter/contract/speech-prose/behavior content | Pass 169/169 | 16 files |
| `npm run build` | Pass | |
| `npm run lint` | Pass | Warnings only; no errors |
| `npm test` | 986 pass / 4 fail / 10 skip | See unrelated failures |
| Isolated rerun of bootstrap timeout | Pass | Parallel-load flake |
| `npm run test:behavior` | 4 pass / 1 fail / 1 skip | Knowledge digest CRLF |
| `npm run test:e2e` | 19 pass / 70 fail / 40 skip | Missing isolated Mongo |
| `git diff --check` | Pass | CRLF warning on `state.md` only |

### Unrelated / blocked (not P1 defects)

1. **Protected voice-delivery tests** (3 failures): cost-and-flow expectations in the preserved uncommitted `voice-delivery.spec.ts` are not implemented on this `main` baseline. Not edited, staged, or committed.
2. **Bootstrap timeout** under parallel `npm test` + e2e load: `explains existing-owner refusal without leaking exception data` passed in isolation (6.43s). Recorded as resource contention, not a P1 regression.
3. **Behavior knowledge digest**: received SHA-256 `38764473…` vs pinned `A71F2D64…` for unmodified `product_knowledge.md` on Windows CRLF. Instruction digest remains pinned and matching. Digest pin was not changed.
4. **Native e2e**: `AURVIN_TEST_MONGODB_URI` / `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` absent. All 70 failures are `Isolated native test configuration is required.` Native selector assertions were updated but **not run**.

## Key Artifacts

- Goal: `docs/voice-mode-instructions/goal.md`
- State & matrix: `docs/voice-mode-instructions/state.md`
- Research: `docs/voice-mode-instructions/research.md`
- Plan: `docs/voice-mode-instructions/plan1.md`
- Review: skipped

## Limitations

- Offline tests do not prove live-model spoken composition or provider cache discounts.
- No new model, UI control, provider cache policy, rewrite model, automatic screen switch, paid call, or deployment.
- Frontend unchanged.
- Azure compatibility, production readiness, and actual cache hit rates remain uncertified.
