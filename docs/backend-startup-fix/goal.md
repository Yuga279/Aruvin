# Backend startup recovery

## Decisions and authorization

- User requested a fix for Vite ECONNREFUSED on 127.0.0.1:8001.
- Preserve the existing Azure database and all chat history.
- User confirmed this PC is the only executor host, with the previous backend stopped. Local inspection found no remaining Aurvin processes/listeners.
- User explicitly approved "Fix, test, and recover": startup correction, create/drop generated isolated Cosmos test databases, then existing verified-stopped-owner recovery. No inference or provisioning authorized.
- Unified review remains skipped. Brief planning, regression checks and final verification remain required.
- No paid inference, external provisioning, broad process termination, sentinel deletion, or automatic takeover.

## Design

1. Keep the existing bounded launcher liveness gate and replace Nest watch launch with build-once/direct-Node launch. Windows Nest watch forcibly kills its child on reload, preventing graceful ownership release. Edits require explicit Ctrl-C, build, and restart; do not introduce a new watcher.
2. Preserve known startup failure codes through cleanup and display static actionable guidance without logging raw exceptions, credentials or message data. Ownership refusal must remain fail-closed.
3. Investigate the identified Azure DocumentDB API/tier and standard checkpointer compatibility using primary documentation, read-only facts and the explicitly authorized isolated service suites. Do not claim native MongoDB admission or full Azure certification from a successful connection; record capabilities actually exercised and unresolved tier/operations limits separately.
4. Only after compatibility evidence and authorized isolated service checks establish the capabilities needed for recovery, perform the existing verified-stopped-owner handoff and reconciliation procedure. Reuse saved graph results; never repeat inference during maintenance. Do not delete the sentinel or chat records. Stop on any active-owner, compatibility or reconciliation uncertainty.
5. Verify backend liveness, archive reads and admission separately, then proxy connectivity without a paid chat request. Record blocked gates honestly.

## Acceptance

- Startup ownership refusal has a clear, secret-safe diagnosis with a failing-then-passing regression test.
- Launcher waits for backend liveness before launching Vite and stops on failure.
- History and durable execution/accounting records remain intact.
- Restore serving only after safe ownership recovery and service admission evidence; otherwise report the remaining blocker rather than call the application fixed.
- Routine tests use deterministic fixtures. Isolated Azure writes were explicitly authorized by the user for generated isolated databases with bounded exposure/cost and cleanup; never use the application database as a test fixture or touch the S1 database.
