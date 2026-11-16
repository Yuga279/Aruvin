# Staging evidence ledger

Prepared by P8; ownership of actual evidence entries transfers to P10 after P8 completes. P8 retains operations.md policy and operational source/assets. Unified review: skipped.

No deployment, Azure compatibility, proxy streaming, process-kill, migration or restore success is claimed by this document. Source/fixture assertions are distinct from actual staging evidence.

## Environment and authority
Profile: existing Windows PC, one loopback Node executor, optional authorized NGINX TLS/authenticated gateway.
Azure product/API/tier/partition/backup identity: not supplied; selected-service evidence blocked.
Gateway exposure/tooling/certificates, backup-tool/encrypted-store access, hard-stop supervisor: not supplied; activation requires operator authorization.
Evidence must include release and actual source commit set, OS/Node/Nest/NGINX/server/tools/saver versions, test database alias (no URI), configured budgets, workload/sample count, UTC start/end, command/procedure, result, measured values, limitations and artifact hash/path. Use synthetic data; no keys, passwords, transcripts, raw provider frames or private reasoning.

## Required drills
| ID | Requirement | Initial status | Execution owner / evidence |
| --- | --- | --- | --- |
| OPS-01 | liveness/readiness/probe concurrency/deadline | not run | P10; measured health calls and no-provider-call counter |
| OPS-02 | rate/run/control capacity | not run | P10; boundary outcomes and no accepted input on rejection |
| OPS-03 | outage/privacy/access credentials | not run | P10; fixture outage plus separately authorized provider-policy evidence |
| OPS-04 | correlations/redaction/finite metrics/latencies | not run | P10; bounded samples, p50/p95, zero-leak assertions |
| OPS-05 | graceful drain and full process exit | not run | P10; actual Windows shutdown/supervisor behavior |
| OPS-06 | abrupt crash/stopped-owner/reconciliation | not run | P10; process/control-plane proof and fixture POST counts |
| OPS-07 | authenticated real gateway streaming/cache/timeouts | not run | P10; nginx -t and actual delayed-chunk measurements, access denial |
| OPS-08 | retention/no independent TTL | not run | P10; actual collection index/config inspection |
| OPS-09 | consistent six-collection backup/isolated restore | not run | P10; native result separate from blocked selected-service result, manifest/hash/time/data-loss |
| OPS-10 | migration-version gate/rollback | not run | P10; isolated previous-compatible-release and incompatible-schema assertions |

## Result-entry format
Each result records ID, environment/commit set, authorization, exact command/procedure, workload, target, actual measurement, pass/fail/blocked/not-run, artifact hash/path, defects routed to owner, and limitations. Do not replace not-run with pass merely because a unit test or nginx source assertion passes. Preserve failed attempts and retests. Any blocked required staging evidence remains an integration gate; unresolved public-production-only policy does not falsely fail a completed local fixture test.

## Rollout limitations
No public production authorization, identity decision, capacity/spend commitments or production recovery objectives. Azure selected-service compatibility/backup is unverified. Real deployment access/proxy/shutdown/restore evidence awaits authorized P10 execution. No unified-review pass exists.

## P10 result entries

P10 appends measured results. P8 policy above is unchanged. Unified review: skipped.

| ID | Result | What was actually run | Limitation |
| --- | --- | --- | --- |
| OPS-01 | pass | 20 concurrent ready calls; live POST count unchanged; ready p95 15 ms | Not a hosted probe |
| OPS-02 | pass | Budget-1 boundary in budgets spec (429 `RATE_LIMITED`) | Staging 20/min and 8-stream target not run |
| OPS-03 | pass | Fixture catalogue failure; live 200, ready 503, no completion POST | Provider account privacy evidence not authorized |
| OPS-04 | pass | 20 fixture samples; first p50/p95 7/11 ms; terminal p50/p95 43/58 ms | 100-attempt sample not run |
| OPS-05 | blocked | Idle in-process shutdown `{ safe: true }` | Windows hard-stop not claimed |
| OPS-06 | blocked | In-process AC12 is not this drill | Needs stopped-PID proof |
| OPS-07 | blocked | nginx.conf was not executed | Needs authorized NGINX and certificate |
| OPS-08 | pass | Index inspection found no independent TTL | Does not prove backup retention |
| OPS-09 | blocked | Native dump/restore not run | Selected-service restore also blocked |
| OPS-10 | blocked | No previous release artifact | Incompatible schema check does not certify rollback |

### Follow-up 2026-10-07

P10 harness rerun, isolated native standalone, prefix `aurvin_p2_test_`. Integration 33 passed. Local OPS-01/04/05/08 tests re-executed pass; p50/p95 not resampled. OPS-06/07/09/10 remain blocked. P8 policy above is unchanged. No production, proxy, kill, restore, or rollback claim.
