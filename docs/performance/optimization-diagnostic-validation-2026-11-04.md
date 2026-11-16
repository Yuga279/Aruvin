# Optimization diagnostic validation — 4 November 2026

## Scope and evidence

Validated the supplied `optimization-diagnostic-report.md` against the current checkout, current primary documentation, and offline regression tests. Only confirmed actionable findings receive fixer agents. No live provider requests, application database changes, paid benchmarks, or deployment are authorized by this work. Unified review is skipped; investigation and test verification are not review certification.

## Findings

### 1. Anthropic caching: reported defect rejected; no fixer

`backend/src/model/policy.ts` deliberately serializes top-level `cache_control: { type: 'ephemeral' }`. Both text and calendar bodies retain it. The text adapter sends the body built by this policy.

[OpenRouter's current prompt-caching documentation](https://openrouter.ai/docs/guides/best-practices/prompt-caching#anthropic-claude), retrieved directly and through Context7, explicitly documents this exact structure as **automatic caching**, recommended for multi-turn conversations. Explicit content-block breakpoints are an alternative, not a requirement. The documentation names Anthropic, Vertex, Azure, and Bedrock provider support. The configured provider parameters do not override `provider.order`.

The report therefore does not establish broken caching, and changing its tests to forbid the supported structure would be incorrect. Real cache hits still depend on model minimum lengths, reusable prefixes, TTL, and provider routing; offline serialization tests cannot establish actual cache hits. No live cache-hit or TTFT claim is made. Cache writes also cost more than ordinary input; discounted cache reads do not imply 90% savings on an entire request or conversation. The report's quoted $0.375/$3 ratio is 12.5%, not 10%.

### 2. Frontend streaming: confirmed avoidable work; fixer dispatched

`ChatView` recollects Canvas artifacts when `streamText` changes. `extractMessageCanvasArtifacts` preprocesses and parses that content, while `SafeMarkdown` separately preprocesses and parses it for rendering. Artifact collection also revisits historical messages during streaming.

`ChatProvider` exposes one changing context value; `Sidebar` and `Composer` consume it directly. Stream-only updates therefore invalidate consumers even when their relevant state is unchanged. Memoizing these context consumers alone does not solve context invalidation. Any fix must also account for parent props and action identities and preserve voice, calendar, and Canvas behavior.

These are confirmed structural costs, not evidence of the claimed 40–60% CPU reduction or zero dropped frames. Fix and regression verification results will be recorded below.

### 3. Context preflight: normal-path triple reconstruction rejected; no fixer

The normal same-process path already uses an admission receipt. Admission assembles context; execution's `reuseAdmittedContext` validates the receipt, refreshes only mutable source references, and assembles once. `contextPreparedViaReceipt` skips another assembly in graph `prepare`. Graph preparation still checks the persisted manifest; that is an integrity check, not another full history reconstruction.

Missing/invalid receipts intentionally use the stricter recovery path, where additional assembly can occur. Without evidence that those checks are redundant across recovery boundaries, removing them is not justified. Existing tests assert no archive/attempt rescans and exactly one assembly during healthy execution. The report's uniform triple-preflight and 30–80 ms savings claims are not established.

### 3b. Token estimation: conservative capacity trade-off confirmed; heuristic fix rejected

`estimatePromptTokens` deliberately uses UTF-8 serialized bytes plus framing as a conservative admission estimate, documented in source and tested explicitly against character-division heuristics. It can reject ordinary English history well before the provider's actual token limit; its ratio is not universally four. Output, margin, fixed context, and message-count reserves also reduce usable history.

An English average such as bytes/3.2 is not a safe upper bound across Unicode, code, arbitrary configured models, or tool schemas. Independent input/model-policy gates and calendar cost reservations also use byte-based bounds; changing this one function would not consistently unlock capacity. No fixer is dispatched without a verified model-specific counting strategy and calibration evidence. This remains a potential capacity enhancement rather than a validated safe bug fix.

A local arithmetic probe using the current raw assets, UTC environment for 2026-11-04, text mode, and `user: "x"` produced **10,126 input-estimate units**, plus **3,072 output/margin reserve**, leaving **3,186 estimate units** under the default 16,384 ceiling. Current instruction/knowledge sizes were **7,622 / 1,522 UTF-8 bytes**. These are byte-based admission measurements, not actual provider tokens. They confirm meaningful capacity pressure without validating a universal division ratio or the diagnostic's older instruction size.

### 4. Session navigation: confirmed unindexed computed sort; fixer dispatched

`MongoSessions.list` computes `pinned` with `$set/$ifNull` and sorts by pin/activity/session. The existing activity index lacks the pin key and cannot supply the computed ordering. Its first user filter can still benefit from indexing; the defect is not necessarily a whole-collection scan. MongoDB may optimize sort/limit memory, but it must still process candidate sessions; measured latency and the report's 10x claim are unverified.

Legacy missing/null pin flags must remain equivalent to false for ordering and cursors. A simple indexed replacement without legacy handling is not correct. The fixer must preserve this behavior without automatically backfilling application data, and retain recovery-list index support.

Reference: [MongoDB index-supported sort](https://www.mongodb.com/docs/manual/tutorial/sort-results-with-indexes/), also queried through Context7.

## Verification

Base commit: `cf6ceafece9994144f455f4c36b464e2c7ad5890` on `main`; working tree initially clean. Environment: Windows, Node `v24.18.0`. Task changes are uncommitted.

Initial offline validation command (backend):

```powershell
npm test -- test/model/prompt-caching.spec.ts test/performance/admission-context-reuse.spec.ts test/performance/admission-preflight-simplification.spec.ts test/context/context-budget.spec.ts
```

Result: **4 files, 48 tests passed**. These establish serialized request structure and fixture behavior, not live provider caching or native database latency.

Broader backend `npm test` during investigation: **277 files passed, 3 failed, 2 skipped; 2,511 tests passed, 19 failed, 10 skipped**. Failures were in:

- `test/assembly/calendar-simplification.built.spec.ts`: missing built `dist` module (build prerequisite not yet run).
- `test/performance/durable-latency.spec.ts`: 17 failed tests, including long-history context-budget rejection and calendar/recovery performance targets. This does not validate the report's triple-reconstruction hypothesis; it does mean the broad performance suite is not green.
- `test/integration/plugins/multi-calendar/authority.spec.ts`: one fresh-coverage/renewed-acceptance assertion failed.

The calendar authority failure reproduced in isolation: **4 passed, 1 failed**.

The runtime, estimator, model policy, and those three test files are unchanged by this task. Do not silently weaken their guards or acceptance targets to claim a passing suite. Existing [prompt-token analysis](../prompt-token-optimization-analysis.md) separately documents the deliberate estimator's real capacity cost and a prompt-size optimization proposal; it is not tokenizer calibration evidence.

Backend `npm run test:e2e`: **4 files passed, 42 skipped; 22 tests passed, 138 skipped**. Prerequisite-gated native/service skips are not passing evidence for those integrations.

### Session-navigation fix and verification

Changed `backend/src/persistence/sessions.ts` to read separate true, false, and null/missing pin partitions, each sorted by activity/session with `limit + 1`, then merge at most `3 * (limit + 1)` rows using binary ordering. Unpinned cursors omit the true partition. Stored legacy records are not mutated. This bounds returned records and application merge work, not necessarily the number of index entries examined by residual acceptance filtering.

Added `user_lifecycle_pin_activity_session` in `backend/src/persistence/indexes.ts`; retained the activity index used by recovery. Added five regression tests in `backend/test/persistence/session-navigation.spec.ts` and updated the additive index-count assertion in `calendar-records.spec.ts`.

Fixer-reported evidence:

- Red-first check failed against the original aggregation path before implementation.
- Backend build passed; full lint exited 0 with unrelated warnings; changed-file lint clean.
- Bounded-worker targeted run: **64 files passed; 400 tests passed, 1 skipped**.
- Built assembly passed after build; default-parallel targeted attempts encountered an artifact race and timeout before the bounded-worker passing rerun.
- Focused native checks: **8 skipped**, no operator test URI supplied. Index eligibility is not an observed explain plan or measured speedup.

Orchestrator independently reran:

```powershell
npm test -- test/persistence/session-navigation.spec.ts test/persistence/calendar-records.spec.ts test/assembly/calendar-simplification.built.spec.ts --maxWorkers=2
```

Result: **3 files, 9 tests passed**. This resolves the earlier missing-build prerequisite failure, not the unrelated authority/performance failures. `git diff --check` passed (line-ending warnings only).

The post-build full backend rerun (`npm test -- --maxWorkers=2`) produced **278 files passed, 3 failed, 2 skipped; 2,516 tests passed, 19 failed, 10 skipped**. Built assembly passed. Besides the unchanged 17 performance and one authority failures, it exposed a task-induced compatibility test still expecting 10 indexes. The same persistence fixer reproduced that failure and updated only the expected count to 11 in `backend/test/compatibility/intersection.spec.ts`, preserving its capability checks. Subsequent compatibility/persistence verification: **35 files, 225 tests passed**. The full suite was not rerun after that assertion-only correction; the 18 unrelated failures remain unresolved, not waived.

### Frontend fix and verification

Changed:

- `frontend/src/features/canvas/canvas-artifacts.ts`: shared preprocessing, Markdown tokens, and Canvas classification through a cache bounded to **32 entries / 256 Ki characters**; oversized content bypasses caching.
- `frontend/src/features/chat/markdown/safe-markdown.tsx`: consumes shared parsed work.
- `frontend/src/features/chat/ChatView.tsx`: separates archived extraction from streaming extraction and stabilizes Sidebar callbacks.
- `frontend/src/components/Sidebar.tsx` and `Composer.tsx`: thin context consumers pass relevant state/actions to memoized heavy views. The wrappers still consume context; this is not a claim of zero React work during streaming.
- Regression tests: `stream-render-boundary.test.ts`, `shared-parsing.test.ts`, and updates to `composer-followup-draft.test.ts` / dictation `composer-events.test.ts`.
- Browser fixture: `frontend/src/features/chat/testing/stream-render-browser.html` and `.tsx`.

Fixer-reported evidence:

- Red-first tests observed two parser calls instead of one, failed identity reuse, and missing memo-boundary assertions.
- Focused checks: **42/42 passed**. Full frontend: **77 files, 607 tests passed**.
- Browser fixture: three deltas produced **zero additional heavy Sidebar/Composer renders**; actions remained stable; Canvas, drafting, navigation, and terminal controls passed. This does not measure overall CPU or frame rate.
- Build passed with the existing >500 kB chunk warning. Lint passed with 79 warnings outside changed files. Frontend whitespace check passed.
- No live voice/provider testing or completed Calendar-specific browser run. Existing voice/calendar Node regressions passed. Task-owned browser tabs/server were closed.

Orchestrator independently reran frontend `npm test`: **77 files, 607 tests passed**.

## Outcome

Exactly **two fixer agents** were dispatched, for confirmed frontend and persistence work. No caching, context-runtime, estimator, provider-routing, or prompt-asset implementation was changed. No commits, application database backfill, live service calls, deployment, or paid tests were performed. Native planner/latency and overall frontend performance gains remain unmeasured. Unified review remains **skipped**. This task's scoped fixes and validation are complete, but the repository-wide backend suite is **not green**.
