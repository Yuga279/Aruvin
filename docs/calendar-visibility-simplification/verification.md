# Integrated Verification: Calendar Visibility and Simplification

**Date:** 27 October 2026
**Scope:** Offline implementation and integrated verification for P1 backend process visibility and P2 Google Calendar simplification. This report does not claim live incident resolution, native database certification, or production readiness.

## Baseline and commit set

- Resumed clean source baseline: `de68b1e` (`fix(calendar): seal recoverable failures and preserve turn evidence`).
- Final integrated source tree: `920e2c2` (second merge of `codex/calendar-p2-remaining` into `codex/google-calendar-plugin`). The working tree was clean after integration and before these final documentation files.
- Goal preparation: `1339432`; approval recorded in `6635fb7`.
- Research and plans: `1691a7a`, `186bf49`, `8c7c06e`, `fb9d68b`, `f4c4a69`.
- P1 implementation/evidence: `9522cf4`, `c476854`, `2538fad`, `0ba16ec`, `8d12bd3`, `b0ad7c5`, `4326a1c`, `c2df866`, `1b8b18a`.
- P2 implementation/evidence: `aeeceec`, `252f2fe`, `00a1e39`, `920f60d`, `250d742`, `cdffbd2`, `93c98a8`, `36a9f89`.
- Workflow/integration records: `b61de04`, `4e4ab23`, `3d10665`, `857f93a`, `37f7618`, `0e35418`, `a5e3126`, `074da01`, `920e2c2`.

The code-review phase was explicitly declared **not needed** and remains **skipped**, not passed. No reviewer or review-triggered fixer was dispatched.

## Environment

- Windows checkout; backend working directory `backend/`.
- Node `v24.18.0`; npm `12.0.1`.
- `AURVIN_TEST_MONGODB_URI` was not configured and `AURVIN_TEST_DB_PREFIX` was not `aurvin_p2_test_`.
- `AURVIN_LIVE_SMOKE` was not `authorized`.
- No application database was inspected; no `.env` app was started; no Google/OpenRouter calls, provisioning, OAuth changes, or live writes were performed.

## Integrated checks

These commands ran sequentially against the integrated code through `920e2c2`, after the prompt-release correction and before documentation-only finalization.

| Working directory | Command | Result |
| --- | --- | --- |
| `backend/` | `npm run build` | Passed. |
| `backend/` | `npm run lint` | Passed with warnings only; warnings were confined to existing `test/voice/**` cases. |
| `backend/` | `npm test -- --no-file-parallelism` | **2,001 passed, 10 skipped**; 246 files passed, 2 skipped. |
| `backend/` | `npm run test:e2e` | **22 passed, 129 skipped**; 4 files passed, 40 skipped. Skips are not native service evidence. |
| `backend/` | `npm run test:behavior` | **5 passed, 1 skipped** across 2 files. The skipped test is the guarded live smoke; no live request was made. |
| Repository | `git diff --check de68b1e..HEAD` | Passed with no whitespace errors. |

Vitest printed its existing informational `vite-tsconfig-paths` notice. The backend package's clean-install command (`npm ci`) was not run; checks used the already installed dependencies. No frontend checks were run because the objective changed no frontend or shared UI/wire files.

### Focused worker evidence

- P1 added HTTP submit/SSE correlation, interleaved assembly attempts, bounded diagnostic-count tests, ordinary-chat exception redaction, and feedback/answer/recovery trace assertions. Focused results recorded in `observability.md`: assembly 10, HTTP assembly 2, validation 98, ordinary runtime 7, feedback 5, answer regressions 15, and recovery 5 passed.
- P2 worker-recorded focused evidence includes the built assembly spec (1 test), AC9 path suite (8 files / 47 tests), contract/repair/model request suites (9 files / 145 tests, then 6 files / 35 tests), scripted model (7 tests), direct-execution suite (36 files / 325 tests), pagination/ownership suite (5 files / 93 tests), repair/recovery suite (8 files / 161 tests), and compatibility batteries (9/50, 9/64, 8/85). The integrated full backend suites above were rerun on the merged tree.
- The P2 prompt change initially exposed a stale deterministic behavior pin. Commit `36a9f89` updates the fixed asset release to `phase1.v2` and the digest/expectations while leaving product knowledge and evaluation cases at `phase1.v1`. The updated test was observed red before the asset change; focused deterministic behavior then passed 4/4, and the full behavior configuration passed 5 with the live smoke skipped.

## Acceptance evidence and limitations

| Criteria | Offline result | Boundary |
| --- | --- | --- |
| AC1–AC4: process lifecycle, precise safe failures, task outcome, bounded/private logs | **Verified offline** with production-assembly traces and focused regressions documented in `observability.md`. | Does not identify the original live incident's actual rejected arguments or model behavior. |
| AC5: documented Google contract and truthful model/runtime schema | **Verified offline** through the tool-contract mapping, parity checks, and assembled request tests in `contract-alignment.md`. | Public documentation reads are not account/provider acceptance. |
| AC6: first-page listing, continuation, ownership | `{}` first page and returned Aurvin continuation pass through fixtures. Primary and access roles are qualified truthfully. | `accessRole: owner` means manager access, not secondary data ownership. No definitive exhaustive secondary-owner inventory is established; do not overclaim. |
| AC7: schemas in initial/continuation/correction requests; bounded repair and duplicates | **Verified offline** through serialized request assertions, bounded feedback tests, and execution-count regressions. | Scripted models do not establish selected-model compliance. |
| AC8: safety and stored-record compatibility | **Verified offline**; existing records/shapes and write/recovery invariants are retained and documented. | Previous-binary/database rollback drill is unrun; unattended rollback remains blocked. No deployment is authorized. |
| AC9: P1 telemetry on simplified P2 path | **Verified offline** through diagnostic v1 assertions and built-application serialization tests. | Diagnostic records remain bounded best-effort logs, not durable audit evidence. |
| AC10: distinguish offline, native, live, and skipped evidence | **Recorded accurately.** Offline checks passed; native/live gates remain unrun. | The original reported incident is **not claimed resolved**. |

## Not run / blocked

- Native MongoDB integration: unavailable because the isolated operator URI/prefix were not configured. No application/production database was substituted.
- Azure compatibility suite/service certification: not run; no Azure service profile was selected or certified.
- Live Google/OpenRouter acceptance and the reported incident reproduction: not authorized or run. A separate bounded authorization or an explicit implementation-only waiver is required; no live-resolution claim is made.
- Previous-binary rollback drill: unrun; unattended rollback is blocked pending evidence for a complete prior release.
- `npm ci`: not run after the package-lock pruning; clean-install reproducibility is therefore not independently established.

The user explicitly selected an implementation-only waiver on 27 October 2026. Workflow status is complete within that scope. Native/live and previous-binary rollback evidence remain unverified; the live gate was not authorized or run, and the original incident is not claimed resolved.
