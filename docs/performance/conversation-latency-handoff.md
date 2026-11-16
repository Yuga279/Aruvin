# Handoff prompt: remaining conversation latency verification and optional work

Copy the prompt below into the next agent. Do not treat conditional suggestions as already authorized product changes.

---

Continue the remaining verification and optional follow-up work from the conversation-latency optimization in `D:\Peter\Aurvin Agent\Aurvin`, on the **existing `codex/google-calendar-plugin` branch**. Baseline HEAD was `58f0b78`; all code changes are **uncommitted**. You are taking over an existing modified working tree where Priorities 1–5 from the previous handoff have just been implemented and verified against focused regression suites.

## Constraints

- Read root `AGENTS.md` and any more-specific instructions. Latest user instructions override conflicting repository workflow instructions: **NO SKILLS**, no MAW/reviewer workflow, unified review **skipped**. Do not spawn further agents unless the user explicitly changes that constraint.
- Inspect current branch, HEAD and `git status` before editing. Preserve all existing source edits, user files, `.openchamber/`, and untracked performance artifacts. Investigate changes that appeared after this handoff; do not assume exclusive access.
- Do not reset/discard, stage broadly, commit, push, create a branch/worktree, deploy, restart the running app, provision infrastructure, or call live paid/model/Google APIs. No application/external database writes or migrations for tests. Native tests may use only **existing operator-supplied isolated test settings** (`AURVIN_TEST_MONGODB_URI` with `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`), never application `.env`/data. Do not expose credentials, URIs, identity, messages or event content.
- Use deterministic fixtures and the existing Vitest infrastructure. No new dependency, abstraction, routing classifier or state framework without a demonstrated need. Maintain required file headers and scoped safety/durability boundaries.

## Read first

1. `docs/performance/conversation-latency-implementation.md` — actual changes, updated all-16 matrix, measured deterministic counts, verification status, and exact outstanding items.
2. `docs/performance/conversation-latency-investigation.md` — **complete historical baseline**; do not overwrite the original measurements.
3. `backend/test/performance/conversation-latency.spec.ts` and `backend/test/performance/latency-storage.spec.ts` — runnable regressions/profiles.

## Already implemented: preserve these invariants

- **History & Context (Sections 1 & 7):** Scoped bounded bulk message references, acceptance markers, and voice deliveries; scoped latest-attempt lookup (`limit 1`). Text reader regression at 20 prior turns: historical `165 / 248` point reads before/through completion → `3 / 5` point reads plus `0 / 2` bulk-reference calls plus `2 / 2` bulk-acceptance calls (**5 / 9 selected readers total**).
- **Calendar Discovery & Narrow Effect-Boundary Recheck (Sections 2 & 3):** Semantically unchanged complete discovery retains original revision/fetched time/expiry (with retention-shortening-only exception). Target selection uses `ensureFresh`. Effect-boundary gate (`requireTargetCurrent`) uses `CalendarDiscoveryPort.checkTarget` (`GET /users/me/calendarList/{calendarId}`, `requestKind: 'capability-recheck'`, `responseBytes: 16384`) when supported, updating the persisted discovery snapshot only when the target entry changed or was removed, and falling back to full `refresh` for mocks without `checkTarget`. Redundant connection reads in `leadRefresh`, `withAccessToken`, `leadRefreshV2`, and `tools.ts` are deduplicated (`LATENCY_CAPABILITY_PROFILE`: `afterResolve: 0`, `afterWriterCapability: 0`, `afterToolGate: 1`, `storageCommands: 15` down from `21`).
- **Lazy Calendar Budget Creation & Authoritative Ledger Reuse (Sections 4 & 5):**
  - `admitCalendarBudget` at `submitTurn` / `retryTurn` acceptance records `{ createdAt, deadlineAt }` in `attemptCalendar` without creating the `calendar-turn-budget` document in MongoDB until the first actual paid-dispatch reservation (`reserveDispatch`) or debit (`consumeDebitNow` / `consumeNow`), while preserving retry deadlines.
  - `CalendarTurnLedger` caches turn-scoped `confirmedBudget` and `confirmedDispatches`, reusing CAS-confirmed budget/dispatch envelopes across `reserveDispatch`, `chargeCalendarRequest`, `observeDispatch`, `finalizeDispatch`, `consumeDebitNow`, and `reconcileTerminalTurn`. `MongoCalendarAccounting.recomputeBudgetMoney` uses a single-claim fast path (`dispatches === 1` without prior terminal claims).
  - Measured `LATENCY_CALENDAR_PROFILE` storage commands:
    - `ordinary-text`: **72 (baseline) → 59 → 43 → 27** (`integration_connections.findOne`: 6, `metadata.find`: 3, `metadata.findOne`: 8, `metadata.updateOne`: 4, `metadata.replaceOne`: 6).
    - `get-event`: **156 (baseline) → 134 → 106 → 67** (`integration_connections.findOne`: 21, `metadata.find`: 3, `metadata.findOne`: 20, `metadata.updateOne`: 9, `metadata.replaceOne`: 14).
    - `create-event`: **222 (baseline) → 179 → 151 → 105** (`integration_connections.findOne`: 30, `metadata.find`: 10, `metadata.findOne`: 34, `metadata.updateOne`: 14, `metadata.replaceOne`: 17).
  - Measured `LATENCY_STREAM_PROFILE`: `accountingDispatchSaves` for 100 text frames is **6** (down from 105 baseline and 7 at prior handoff).
- **Stock Saver Wrapper Duplication (Section 8):** Reconciliation reuses one graph state. `ScopedMongoSaver.put` and `ScopedMongoSaver.putWrites` wrap `this.serde` via `withCachedDumps` so size-check serialization (`dumpsTyped`) is reused when delegating to `super.put` / `super.putWrites` instead of double-serializing payloads. `ScopedMongoSaver.getTuple` short-circuits immediately (`if (!latest[0]) return undefined`) when the pre-check finds no checkpoint on an empty thread.
- **Terminal Publication, SSE Feedback, Provider Retry Hygiene & UI Memoization (Sections 10, 11, 12, 14):** Pre-terminal cleanup boundary, identity-bound `releaseReservation`, immediate SSE acceptance/generating flush, non-sleeping terminal provider rejections, and narrow memoized React row/Markdown/Canvas props remain intact.
- **Bounded Latency Timeline (Section 16):** `RecordStore.onCommand` instruments actual store reads/writes (`driver_read`, `driver_write`) and records per-turn `driverReads` and `driverWrites` (`WeakMap`-backed) on `terminal` process events alongside `durationMs` and `eventLoopDelayMs`. `Telemetry` samples `monitorEventLoopDelay` (`event_loop_delay`), measures `stream_header` and `stream_first_feedback` separately from total `request` duration, and maintains 5-bucket latency histograms (`le10`, `le50`, `le250`, `le1000`, `gt1000`) via `distribution()`.

## Remaining tasks for the next agent, in priority order

### 1. Immediate task: Full serialized verification and lint/build closeout

Focused regressions for Priorities 1–5 passed (**10 files / 92 tests**, including all 11 tests in `test/performance/conversation-latency.spec.ts`), and the user requested an immediate handoff before running the full serialized suites. Run and record:

1. **Backend build & lint:**
   - `Set-Location backend; npm run build`
   - `Set-Location backend; npm run lint`
2. **Backend full unit suite (serialized):**
   - `Set-Location backend; npm test -- --maxWorkers=1`
   - **Important:** Do not run `npm run build` concurrently with the test suite. `test/operations/bootstrap.spec.ts` rebuilds/deletes shared `dist` and will race `calendar-simplification.built.spec.ts` if run in parallel. Always build first, then run `--maxWorkers=1`. Fix any regression uncovered by the full suite before marking verification complete.
3. **Backend e2e suite:**
   - `Set-Location backend; npm run test:e2e`
   - Distinguish passes from missing-prerequisite skips. If operator-supplied isolated native MongoDB test variables (`AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`) are available, also verify `test/persistence/checkpoints.native.e2e-spec.ts` against `ScopedMongoSaver`. Never point tests at application `.env` or production data.
4. **Frontend build, lint, and tests:**
   - `Set-Location frontend; npm run build`
   - `Set-Location frontend; npm run lint`
   - `Set-Location frontend; npm test`
5. **Git/doc hygiene check:**
   - `git diff --check`
   - Update `docs/performance/conversation-latency-implementation.md` with the exact final verification counts.

### 2. Optional architectural engineering (only if requested or proven safe)

- **Section 9 (Per-session ownership queue):** Global ownership queue wait is measured (`ownership_queue`) and internal command counts are substantially reduced. Replacing the global queue with per-session queues requires a separate executor-control, drain/shutdown, and crash-journal proof with dedicated tests. Never weaken sentinel/lease guarantees as an optimization.
- **Section 12 (Browser animation-frame delta batching):** Only consider if live browser CPU/render profiling demonstrates frame drops during streaming; preserve exact ordered deltas, reset/terminal/cancel ordering, accessibility, and sanitization.
- **Section 15 (Parallel availability batches):** Keep sequential unless a bounded parallel coordinator is proven to preserve shared global byte/interval/request/disclosure budgets, cancellation, and honest incomplete-coverage reporting.

### 3. User-gated product & environment decisions (do not choose autonomously)

1. **Section 5 (Explicit text-only capability mode):** Whether ordinary text turns may omit Calendar tool schemas or use a user-selected text-only mode. Do not add keyword routing or a paid classifier.
2. **Section 6 (Deterministic receipt-only create completion):** Define when deterministic verified-receipt narration may replace the second (continuation) model call without discarding another user-requested explanation or general answer.
3. **Section 13 (Model / reasoning configuration & live benchmarks):** Any change to the configured OpenRouter model, reasoning parameters, context ceilings, or bounded paid live-provider benchmarks requires explicit user authorization.
4. **Section 15 (Target-only vs. all-calendar conflict scope):** Default conflict checking remains across all discovered calendars unless the user explicitly approves narrowing conflict scope to the target calendar.
