# Backend startup fix — final report

## Outcome

The reported backend startup/proxy refusal is corrected and operational ownership recovery completed. Live backend and Vite proxy archive reads passed against the preserved Cosmos deployment, with inference explicitly disabled. Full Azure profile certification and live generation readiness are **not** established; outcome is **complete with those verification blocks** rather than production/chat certification.

## Cause and correction

- Existing executor metadata refused startup with `UNSUPPORTED_TOPOLOGY`, before HTTP listening. Generic startup logging hid that cause.
- Installed Nest Windows watch mode force-kills its child tree on reload, bypassing shutdown/ownership release; reproduced with a disposable process.
- `run.bat` now checks a foreground build, launches compiled Node directly, and waits for liveness before starting Vite. Explicit Ctrl-C/build/restart replaces unsafe automatic watch reload.
- Startup preserves known error codes through cleanup and emits static secret-safe guidance. Unknown/forged errors remain generic.
- README accurately describes installation and launch/restart behavior.

## Commit set

| Unit | Commit | Result |
| --- | --- | --- |
| Research | bb542b2, 1567347, 0b2916f | Failure, service identity, S1 connection comparison, force-kill reproduction |
| Approved goal/state | 3795ffb, 2116830 | User preserved Azure and authorized isolated checks plus safe recovery |
| Plans | 05e1aee, 933f0aa | Startup fix and bounded service/recovery steps |
| P1 startup fix | 2ac57e7 | Launcher, error handling, regression tests, README |
| P2 capability/evidence | 2f3a221 | Isolated Cosmos operations and conditional operational recovery |
| Verification correction | 7059ce7 | Compiled-entry test builds current source once; fresh-checkout test works |
| Live verification evidence | 0e6b1be | Backend/proxy reads, graceful shutdown and durable owner release |

## Actual checks

Environment: Windows; Node v24.18.0; npm 12.0.1. No paid inference, deployment/provisioning, S1 writes, private config changes, or credential/payload logging. Unified review **skipped**, never passed.

| Check | Outcome |
| --- | --- |
| Startup/launcher RED→GREEN | Expected missing build/hidden known-code failures; 12 focused checks passed after fixes |
| Backend build | Passed |
| Backend lint | Passed, warnings outside task files |
| Backend routine suite | 324 passed, one native skip |
| Fresh generated-output absence | Before test correction: 8 bootstrap failures; after suite-local build: 324 passed, one skipped without external build |
| Non-native e2e | 12 passed in three files; final orchestrator rerun passed |
| Full e2e without native test prerequisites | 12 passed, 33 skipped, 56 prerequisite failures; **not a passing full native integration result** |
| Frontend tests/build/lint | 50 tests passed; build passed; lint passed with three existing warnings |
| Isolated Cosmos capability probe | One real service test passed; generated test database dropped and absence verified |
| Focused deterministic compatibility checks | 13 passed; negative facts/unauthorized-target gates rejected as expected |
| Live backend | Liveness 200; sessions 200, empty; readiness 503 expected with explicitly disabled provider settings |
| Live frontend/proxy | Frontend 200; proxied liveness/sessions matched backend responses |
| Graceful service-backed shutdown | IPC exit 0; ownership/metadata returned to zero; data/indexes unchanged; no remaining owned listeners/processes |
| Actual Windows diagnostic Ctrl-C | Shutdown awaited once, no persistence/provider opens; Windows exit 1; IPC exit 0 |
| Whitespace/document paths | Passed |

A final orchestrator build/test run incorrectly overlapped compiled-artifact tests with Nest rebuilding `dist`, producing four missing-fixture failures. Serial rerun passed. This exposed a separate hidden prebuild dependency; the owning worker added one bounded suite-local build and proved fresh-checkout behavior. External builds and the compiled-entry suite must be serialized.

## Cosmos compatibility and recovery evidence

- S1-SEVI working connection targets the same service deployment but a different database; Aurvin's TLS/retry-write/idle settings match. No connection/index incompatibility was reproduced.
- Isolated operations exercised required indexes, bounded records, idempotency, revision CAS, standard checkpoint save/reopen, conditional owner handoff, fencing and clean release.
- Before application recovery, all local instances were absent and the user confirmed this PC is the only host and the old backend stopped. Three broadened scoped `currentOp` observations were zero; data, owner/revision and indexes stayed stable for 120 seconds.
- Application database contained no session/checkpoint/attempt work. Existing conditional `handoffStoppedExecutor` verified its revision change; replacement's scoped `releaseExecutor` completed. A fresh ordinary claim/release then passed.
- No direct sentinel deletion, data deletion, expiry-based takeover or silent inference/retry. Five data collections remained empty; metadata returned to empty; indexes unchanged.
- Live verification subsequently reopened real persistence and released its own ownership on graceful shutdown. Explicit empty provider variables survived `.env` loading; no generation was possible during this check.

## Limitations and use

- Service identifies as Azure DocumentDB (formerly Cosmos DB MongoDB vCore), advertising MongoDB 8.0.0 and sharded/proxy topology. Actual tier and complete supported application partition/feature configuration remain unresolved. The capability probe is **not full Azure certification**, does not satisfy the full service-facts gate, and does not change/admit a persistence profile.
- No paid chat or production-readiness claim. Full native integration suites need operator-supplied isolated native replica-set prerequisites; the Cosmos probe must not be relabelled as native MongoDB evidence.
- Application `.env` and its existing profile were preserved. Verification deliberately disabled inference in child-process environment only, not the private config file.
- Use `run.bat` for the corrected lifecycle. Stop via Ctrl-C before changes/restart; do not reintroduce overlapping executors or force-kill ownership takeover. On an unsafe exit follow the operator recovery procedure rather than deleting metadata.
- Verification processes were shut down cleanly; the app was not left running.

Evidence: [goal](goal.md), [state](state.md), [Cosmos/recovery evidence](p2-evidence.md), [live verification](live-verification.md). Research/plans contain the diagnosis and scoped execution record.
