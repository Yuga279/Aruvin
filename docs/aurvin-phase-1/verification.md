# Aurvin Phase 1 verification

Unified review: skipped, not passed. This file does not authorize public production.

## Environment

- Date UTC: 2026-10-07T06:55:36Z (P10 harness follow-up). Prior worker evidence 2026-10-06T13:25:16Z.
- Git commit set: P10 tests `351dfe3`..`1493f80` plus follow-up `0e32322` and this evidence file; owner fixes P8 `31f56bb`, P5 `a336b99`, P6 `88e5fac`; plan `7204dbd`
- OS / Node: Microsoft Windows NT 10.0.26200.0 / Node v24.18.0
- Native database prefix: aurvin_p2_test_
- Native topology: standalone (hello has no replica-set name). Isolated generated DBs only. Not replica-set certification.
- Azure selected service: not identified
- Live model: not run (`AURVIN_LIVE_SMOKE` unset)

## AC matrix

| AC | Result | Evidence | Owner if failed | Limitation |
| --- | --- | --- | --- | --- |
| AC01 | pass | [sessions.native.e2e-spec.ts](../../backend/test/integration/sessions.native.e2e-spec.ts) | | Isolated native only |
| AC02 | pass | [streams.native.e2e-spec.ts](../../backend/test/integration/streams.native.e2e-spec.ts) first loopback chunk contains `Hello` before completed | | P6 `88e5fac` coalesce confirmed. Not NGINX evidence |
| AC03 | pass | [context.native.e2e-spec.ts](../../backend/test/integration/context.native.e2e-spec.ts) | | Unique fixture generation IDs; isolated native only |
| AC04 | pass | context restart/isolation | | Reopen follow-up included first exchange once |
| AC05 | pass | [storage.native.e2e-spec.ts](../../backend/test/integration/storage.native.e2e-spec.ts) | | Headroom and no TTL on this native host |
| AC06 | pass | agent-memory refs | | Refs have no `content`; summary null; version > 0 |
| AC07 | pass | tool reconstruction; no live tools | | Fixture reconstruction only |
| AC08 | pass | [duplicates.native.e2e-spec.ts](../../backend/test/integration/duplicates.native.e2e-spec.ts) duplicate, mismatch, retry | | Retry used retryable SSE 502, not 402 credits. P8 `31f56bb` cooldown bypass confirmed |
| AC09 | pass | two-client and second executor | | Single-process topology only |
| AC10 | pass | [ordering.native.e2e-spec.ts](../../backend/test/integration/ordering.native.e2e-spec.ts) | | |
| AC11 | pass | HTTP-200, EOF, length, cancel | | Cancel is not a billing guarantee |
| AC12 | pass | [recovery.native.e2e-spec.ts](../../backend/test/integration/recovery.native.e2e-spec.ts) | | In-process only; not process kill |
| AC13 | pass | outgoing user/model and rejected overrides | | Server identity on follow-up POST; client overrides 400 |
| AC14 | pass | [accounting.native.e2e-spec.ts](../../backend/test/integration/accounting.native.e2e-spec.ts) known/dedup/lookup/retry row | | First POST keeps `gen_fixture`. Retry used retryable 502 |
| AC15 | pass | [budgets.native.e2e-spec.ts](../../backend/test/integration/budgets.native.e2e-spec.ts) | | |
| AC16 | blocked | `npm run test:azure` is not certification | R1 missing input | Native tests do not certify Azure |
| AC17 | pass | [security.native.e2e-spec.ts](../../backend/test/integration/security.native.e2e-spec.ts) | | |
| AC18 | blocked | local measurements; external drills separate | | Local OPS-01/04/08 passed. Process kill, proxy, restore, rollback blocked without flags |
| AC19 | pass | deterministic cases; live separate | | Live smoke not-run |
| AC20 | skipped-review | Builds and tests below; review not passed | | AC16/AC18/live/proxy/kill/backup/rollback still block V |

## Commands

Working directory `backend` unless noted. Native commands used prefix `aurvin_p2_test_` without printing the URI.

### Follow-up 2026-10-07

| WD | Command | UTC | Exit | Counts |
| --- | --- | --- | --- | --- |
| backend | `npm run build` | 2026-10-07T06:54:58Z | 0 | nest build pass |
| backend | `npm run lint` | 2026-10-07T06:54:59Z | 0 | warnings only |
| backend | `npm test` | 2026-10-07T06:55:08Z | 0 | 51 files, 312 passed |
| backend | `npx vitest run --config ./vitest.config.e2e.ts test/app.e2e-spec.ts --reporter=verbose` | 2026-10-07T06:55:22Z | 0 | 3 passed |
| backend | `npx vitest run --config ./vitest.config.e2e.ts test/integration --reporter=verbose` | 2026-10-07T06:55:36Z | 0 | 33 passed, 0 failed, 0 skipped |
| backend | duplicates + accounting + context + streams (same env, earlier same hour) | 2026-10-07T06:51:52Z then 06:54:17Z | 0 after fixture/harness fixes | AC02/03/04/06/08/13/14 executed pass |

`npm run test:azure`, `npm run test:behavior`, frontend checks, and P9 smoke were not re-run in this follow-up. Prior 2026-10-06 results still apply: azure exit 1 (missing selected-service facts); behavior 4 passed, 1 skipped live; frontend 14 files 49 passed; P9 smoke 1 executed pass.

### Prior 2026-10-06

| WD | Command | UTC | Exit | Counts |
| --- | --- | --- | --- | --- |
| backend | `npm run build` | 2026-10-06T13:25:16Z | 0 | nest build pass |
| backend | `npm run lint` | 2026-10-06T13:25:30Z | 0 | warnings only |
| backend | `npm test` | 2026-10-06T13:25:33Z | 0 | 49 files, 303 passed, 1 skipped |
| backend | `npx vitest run --config ./vitest.config.e2e.ts test/app.e2e-spec.ts --reporter=verbose` | 2026-10-06T13:25:48Z | 0 | 3 passed |
| backend | `npx vitest run src/app.controller.spec.ts -t "P9 native assembled fixture chat" --reporter=verbose` | 2026-10-06T13:25:52Z | 0 | 1 passed, 13 skipped |
| backend | `npx vitest run --config ./vitest.config.e2e.ts test/integration --reporter=json` | 2026-10-06T13:26:00Z | 1 | 29 passed, 4 failed, 0 skipped |
| backend | `npm run test:azure` | 2026-10-06T13:24:54Z | 1 | 1 failed (missing selected-service facts) |
| backend | `npm run test:behavior` | 2026-10-06T13:24:19Z | 0 | 4 passed, 1 skipped (live) |
| frontend | `npm test` | 2026-10-06T13:27:05Z | 0 | 14 files, 49 passed |
| frontend | `npm run build` | 2026-10-06T13:27:05Z | 0 | vite production build |
| frontend | `npm run lint` | 2026-10-06T13:26:01Z | 0 | warnings only |

P9 smoke (Task 1): 1 executed pass, prefix `aurvin_p2_test_`, no paid inference. Stands.

## Measurements

Host: Windows PC, Node v24.18.0, loopback fixture chats. Sample size 20. 100-attempt sample not run (`AURVIN_P10_LOAD` unset). Follow-up re-executed OPS-01/04/05/08 tests as pass; p50/p95 not resampled.

| ID | n | p50 | p95 | Slowest | Result |
| --- | --- | --- | --- | --- | --- |
| OPS-01 ready | 20 concurrent | 15 ms | 15 ms | 15 ms | pass vs 1100 ms target |
| OPS-04 first-byte | 20 sequential | 7 ms | 11 ms | | pass vs 2000 ms |
| OPS-04 terminal | 20 sequential | 43 ms | 58 ms | | pass vs 5000 ms |
| OPS-05 in-process shutdown | 1 idle | | | test 258 ms | `{ safe: true }`; not Windows process-exit |

## Defects

No open assembled-native AC02/03/04/06/08/13/14 defects after this follow-up.

| AC | Command | Expected | Observed | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| AC03, AC04, AC06, AC13 | context.native.e2e-spec.ts | second session completed | 2026-10-06 `PERSISTENCE_ERROR` from reused `gen_fixture` | P10 harness (not P5) | resolved: unique generation IDs per completions POST, first POST keeps `gen_fixture`, suffix persisted on shared DB handle |
| AC02 | streams first loopback chunk | first TCP chunk contains `Hello` | 2026-10-06 `turn-accepted` only | P6 | resolved by `88e5fac`; follow-up native pass |
| AC08, AC14 | duplicates/accounting retry | retry POST 202 | 2026-10-06 503 `NOT_READY`. After `31f56bb`, 402 `FRAMES.errorBefore` still 503 because P4 maps 402 to `PROVIDER_CREDITS` (blocked; P8 does not bypass). Retryable SSE 502 pre-content error returns 202 | P8 cooldown bypass confirmed; credits/auth remain fail-closed | resolved for AC08/AC14 evidence using 502 |

## Limitations

No production-readiness claim. AC16 blocked: product family, API/server version, six-collection partitioning, RU capability flags and backup mode, consistency, tier/topology, and an isolated staging target remain missing ([research.md](research.md) §13.3). This follow-up used isolated native **standalone** MongoDB; that is not replica-set or Azure certification. `npm run test:azure` previously exited 1 because selected-service facts are absent; that is not certification.

Live smoke not a pass unless authorized and bounded. Proxy, process kill, restore, and previous-release rollback are blocked without operator input. Unified review is skipped, not passed. V remains blocked by AC16/AC18 and those unrun external drills, not by AC02–AC15/AC17/AC19.

Literal `FRAMES.errorBefore` (SSE error 402) is still a credits block for explicit retry. P10 retry evidence uses a retryable 502 pre-content frame. That does not claim credits/auth retry is admitted.
