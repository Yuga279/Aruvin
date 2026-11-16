# Isolated native latency acceptance — Step 2

2026-10-29. **Prepared, not natively executed or accepted.** Review **skipped**. No production changes, saver facade activation, application `.env` access, database/network/provider/Calendar/browser/staging connections, backend restarts, staging, commits, pushes or worktrees. No agents dispatched.

## Preparation plan and outcome

- [x] Add offline failing authorization/command-monitor checks, then implement the minimal helper.
- [x] Compose generated-database native text/Calendar fixture using existing real persistence and deterministic transports; retain default saver and majority writes.
- [x] Add bounded native scenarios and a baseline/current invocation with explicit source provenance, monotonic milestone/storage timing and complete monitored command totals.
- [x] Run offline helper tests, definitely-disabled native discovery, backend build/lint and diff checks; record actual results and remaining gates.

## Files and scope

New files, all uncommitted:

- [native-safety.ts](../../backend/test/performance/native-safety.ts): fail-closed authorization and payload-free complete command-event measurement.
- [native-database.ts](../../backend/test/performance/native-database.ts): authorization **before client construction**, explicit replica-set/majority options, post-authorization topology check, generated-database drop/close.
- [native-runtime.ts](../../backend/test/performance/native-runtime.ts): real persistence/ownership/default saver with existing text/Calendar fixture transports and monotonic boundary instrumentation.
- [native-latency.e2e-spec.ts](../../backend/test/performance/native-latency.e2e-spec.ts): six bounded native scenarios.
- [native-preparation.spec.ts](../../backend/test/performance/native-preparation.spec.ts): offline authorization, connector lifecycle and measurement checks; approved-looking values are synthetic objects, not real environment credentials.
- [native-runtime-preparation.spec.ts](../../backend/test/performance/native-runtime-preparation.spec.ts): entirely mocked database opener/BSON fake; verifies text and Calendar boundary plumbing and ready-after-slot-cleanup. **Not native measurements.**
- This artifact. Existing `test:e2e` discovery is sufficient; no package, lockfile or configuration edits.

Step 1 files (`durable-latency.spec.ts`, `latency-runtime-fixture.ts`, `acceptance-offline.md`) and orchestrator-owned `acceptance-state.md` remain untouched by Step 2.

Scenarios match the corresponding Step 1 prompts/fixtures: new text, follow-up after 1/20 completed turns, Calendar ordinary text, Calendar read, Calendar direct create. Each sample uses six separate generated databases and **27 turns total**, including 21 seed turns. Explicit samples 1–3 bound each invocation to **18 databases / 81 turns maximum**. One scenario runs at a time; no executor is shared across databases or substituted for the production ownership implementation.

The model/Google transports remain deterministic fixtures; real Calendar reads/creates are impossible through those transports. Calendar capability/credential services remain simplified. Native storage is real only in a separately authorized future execution. No fake-derived count or time is inserted into a native result.

## Fail-closed configuration

Disabled discovery checks only `AURVIN_NATIVE_PERF_ENABLE`; it never accesses the URI. If enabled but any other requirement is missing/invalid, each selected test blocks before constructing a client. The helper repeats full authorization immediately before constructing its client. Merely having an existing URI/prefix cannot enable these tests.

All fields below are mandatory, exact values unless noted:

| Setting | Requirement |
| --- | --- |
| `AURVIN_NATIVE_PERF_ENABLE` | `authorized` |
| `AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET` | `attested` — separate operator attestation, not inferred from URI |
| `AURVIN_NATIVE_PERF_CREATE_DROP` | `approved` — generated DB creation and deletion |
| `AURVIN_NATIVE_PERF_SAMPLE_LOAD` | `approved-max-18-databases-81-turns` — per-invocation ceiling |
| `AURVIN_NATIVE_PERF_REPLICA_SET` | Explicit attested set name, 1–80 alphanumeric/underscore/hyphen characters |
| `AURVIN_NATIVE_PERF_SAMPLES` | Exactly `1`, `2`, or `3`; no implicit default |
| `AURVIN_NATIVE_PERF_LABEL` | `baseline` or `current` |
| `AURVIN_NATIVE_PERF_REVISION` | Identified source revision, 40 lowercase hexadecimal characters |
| `AURVIN_TEST_DB_PREFIX` | Exactly `aurvin_p2_test_` |
| `AURVIN_TEST_MONGODB_URI` | Existing operator-supplied nonblank test URI; never logged or used to choose an application DB |

There is no dotenv loader, fallback URI, application database substitution, or preauthorization discovery connection. Explicit client options retain `w: majority`, `retryWrites: false`, primary reads, command monitoring and finite connection/operation deadlines. After—and only after—authorization/connection, `hello` must match the declared set, report a writable primary, and not be a router. Every data operation uses `aurvin_p2_test_<random UUID without hyphens>`; materialization occurs during existing bundle bootstrap. URI default database is never used for application records.

One production ownership bundle/executor is claimed per fresh database. Measured success checks durable completed attempt/accounting, cleared attempt/owner, zero active/unresolved work, and actual readiness after slot/write cleanup. Shutdown stops admission, drains runtime and ownership, releases the executor, then drops only the generated DB and closes the client in `finally`. Cleanup errors fail the test; a generated DB name (not URI) is available for operator cleanup. An abrupt OS/process termination can still leave a generated database behind; no automatic broad-prefix deletion is provided.

## Measurement contract and limits

- Window: immediately before submission through `executeTurn` settlement, including acceptance, ownership, default saver and release. Bootstrap/index setup, seed turns, later correctness/history/accounting/readiness probes and final database deletion are outside it.
- Every `commandStarted` event during that window is counted, without collection/name filtering or sample extrapolation. Histograms include `getMore`, bulk command names, retries if any, failed attempts and non-target database commands. Target/non-target counts are separate; no command documents, replies, URI, host, credentials or user payloads are retained. Driver SDAM heartbeat events, handshakes and protocol bytes not exposed as command events are **not** counted; this is complete **command-monitor** coverage, not a packet trace.
- Request IDs correlate completion/failure events. Pending/unmatched events fail correctness gates instead of silently reducing totals. All observed write commands must carry majority concern. Full payload-free command intervals and complete histograms are emitted in JSON before assertions; failed correctness is not acceptance success.
- `performance.now()` supplies real monotonic command intervals and milestone times. Marks are first model-fetch dispatch, first emitted text delta, existing saver `put` acknowledgment with `sealed=true` for the executing attempt, finalization start, slot release, completed-frame delivery and settlement. No extra reads/writes are added to establish these boundaries.
- Summaries include full elapsed time, sum of command durations, union-of-command-interval busy time, pre-dispatch/first-answer/post-seal busy time and command-start counts, plus post-seal tail. Cross-boundary intervals are clipped, not discarded. Command duration includes driver/client/network waiting; it is not server execution time, network RTT, CPU cost or provider TTFT.
- Native command overlap does **not** establish a causal storage dependency graph. No native wave count is fabricated: the **30% pre-dispatch/post-seal wave goals remain unverified**. Busy-time reduction must not be substituted for those wave goals. An authorized measured baseline/current comparison can evaluate the 25% complete command-monitor goal, but no baseline counts or latency ratio gate are invented in this preparation.
- Six native scenarios are prepared, not the full offline matrix. Near-context-ceiling/50-turn cases, conflict/proposal reply, rejection/retry, cancellation, finalization/crash recovery, cursor stress/fault injection, proxy/browser streaming, actual provider windows and topology/Azure compatibility are **remaining coverage gates**. Three samples are smoke measurements, not a sound tail-latency certification.
- The saver facade remains default-disabled. Existing stock-saver native tests and broader facade-vs-stock pending-write/restart/scope/bounds/failure conformance are separate required work/authorization before default activation. These prepared performance suites do not prove saver conformance.

## Commands actually run (safe, no connections)

From `backend/` in PowerShell; logs are under approved temporary storage (PowerShell UTF-16LE output):

```powershell
npm test -- test/performance/native-preparation.spec.ts --maxWorkers=1 > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step2-red.log 2>&1
npm test -- test/performance/native-preparation.spec.ts --maxWorkers=1 > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step2-green.log 2>&1
npm test -- test/performance/native-preparation.spec.ts -t 'preserves the operator drop-cleanup error' > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step2-cleanup-red.log 2>&1
npm test -- test/performance/native-preparation.spec.ts test/performance/native-runtime-preparation.spec.ts --maxWorkers=1 > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step2-offline.log 2>&1
npm test -- test/performance --maxWorkers=1 > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step2-performance.log 2>&1
$env:AURVIN_NATIVE_PERF_ENABLE = 'disabled'
npm run test:e2e -- test/performance/native-latency.e2e-spec.ts --maxWorkers=1 --reporter=verbose > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step2-disabled.log 2>&1
npm run build > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step2-build.log 2>&1
npm run lint > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step2-lint.log 2>&1
node node_modules/typescript/bin/tsc --noEmit --incremental false > C:/Users/Peter/AppData/Local/Temp/opencode/latency-step2-typecheck.log 2>&1
```

From root: `git diff --check`. No dependency install or remote documentation fetch. New-file links and guard/scenario/load bounds checked against source.

| Fresh check | Result |
| --- | --- |
| Initial helper red run against minimal stubs | 19 pass / 4 expected failures, exit 1; accepted authorization and measurement behavior absent |
| First helper green run | 23 pass, exit 0 |
| Final focused offline preparation tests | 42 pass, exit 0; no skips or connections |
| Full offline performance directory | 97 pass / 23 fail / 0 skip, exit 1; all known Step 1 failures retained |
| Definitely-disabled native performance selection | 0 run / 6 skipped, exit 0; **not conformance/latency success** |
| Backend build | Pass, exit 0 |
| Type-aware lint | Pass, exit 0; repository warnings remain |
| Additional broad `tsc --noEmit` diagnostic | Fails, exit 1; 201 diagnostics outside Step 2 files in the latest capture; no whole-test-tree typecheck pass claimed |
| Diff whitespace | Pass; existing Step 1 LF→CRLF warnings |
| Explicit new-file trailing-whitespace and local Markdown-link checks | Pass; seven named task files checked (untracked files are not covered by plain `git diff --check`) |
| Actual native baseline/current, conformance, live/staging | **Not executed; unauthorized** |

An added offline cleanup regression first failed (1 failed / 39 filtered) because a `finally` close exception masked the generated-DB deletion failure. Cleanup now attempts both operations and preserves the actionable drop-cleanup failure; its check is included in the final focused/full runs. No Step 1 production/performance target was changed. Broad typecheck diagnostics were not baseline-isolated; do not represent them as a verified baseline count or a passing check. No Step 2 file has a diagnostic in that capture. Lint has repository warnings, but none in these new files in the final capture.

## Future operator authorization template — NOT executed

Written approval must identify operator/date/expiry, dedicated non-application native replica-set identity and set name, existing test credential source (no secret in report), generated DB create/drop/leftover cleanup permission, source snapshot/harness hashes, exact sample count and maximum load, and the two separately approved baseline/current invocations. A baseline+current pair doubles per-invocation load (at three samples: **36 databases / 162 turns**). No other native suite or external service is authorized by this template.

Only after that approval, in the intended source snapshot's `backend/`:

```powershell
# Existing AURVIN_TEST_MONGODB_URI must already be supplied by the operator.
# Do not print it, load application .env, or set it to an application DB.
$env:AURVIN_TEST_DB_PREFIX = 'aurvin_p2_test_'
$env:AURVIN_NATIVE_PERF_ENABLE = 'authorized'
$env:AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET = 'attested'
$env:AURVIN_NATIVE_PERF_CREATE_DROP = 'approved'
$env:AURVIN_NATIVE_PERF_SAMPLE_LOAD = 'approved-max-18-databases-81-turns'
$env:AURVIN_NATIVE_PERF_REPLICA_SET = '<operator-attested-set-name>'
$env:AURVIN_NATIVE_PERF_SAMPLES = '1'
$env:AURVIN_NATIVE_PERF_LABEL = 'current'
$env:AURVIN_NATIVE_PERF_REVISION = '2a32994bd27b8a98ecce02a12d2a39e45e97e76b'
try {
  npm run test:e2e -- test/performance/native-latency.e2e-spec.ts --maxWorkers=1 --no-file-parallelism --silent=false --disableConsoleIntercept --reporter=verbose > C:/Users/Peter/AppData/Local/Temp/opencode/latency-native-current.log 2>&1
} finally {
  $env:AURVIN_NATIVE_PERF_ENABLE = 'disabled'
}
```

For the independent incremental baseline, use the **identified `35eb6e85d0b80f3d88abf32218120ce19a7a32d8` extracted snapshot** from Step 1, not candidate production code with a different label. Copy exactly the same new `native-*.ts` harness files into its `backend/test/performance/` (no production edits), verify shared dependency versions/lockfile equivalence and record harness hashes. In that snapshot's `backend/`, after separate load authorization, run the same exact native command with `AURVIN_NATIVE_PERF_LABEL='baseline'`, `AURVIN_NATIVE_PERF_REVISION='35eb6e85d0b80f3d88abf32218120ce19a7a32d8'` and output `latency-native-baseline.log`; return enable to disabled in `finally`. This invocation is **prepared, not validated against native storage**. Revision strings are operator provenance labels, not automatic source verification; verify snapshot identity externally before running.

```powershell
# NOT RUN. Reuse the Step 1 extracted snapshot, not a new worktree.
Copy-Item 'D:/Peter/Aurvin Agent/Aurvin/backend/test/performance/native-*.ts' C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8/backend/test/performance/
Set-Location C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8/backend
# Supply the separately approved guard settings above, then:
$env:AURVIN_NATIVE_PERF_LABEL = 'baseline'
$env:AURVIN_NATIVE_PERF_REVISION = '35eb6e85d0b80f3d88abf32218120ce19a7a32d8'
try {
  npm run test:e2e -- test/performance/native-latency.e2e-spec.ts --maxWorkers=1 --no-file-parallelism --silent=false --disableConsoleIntercept --reporter=verbose > C:/Users/Peter/AppData/Local/Temp/opencode/latency-native-baseline.log 2>&1
} finally {
  $env:AURVIN_NATIVE_PERF_ENABLE = 'disabled'
}
```

Compare matching scenario/sample histograms and measured boundaries, with source/harness/dependency/topology/load records attached. Do not mix fake counts, a candidate mislabeled baseline, or larger historical denominators with these measurements. `35eb6e8` already contains phases 0–6: it is **not** the complete pre-initiative baseline. Reconstructing that full baseline remains separate work.

**Always target the exact performance filename.** Do not run broad `npm run test:e2e` while credentials are present: older unrelated native fixtures have weaker opt-in guards and are outside this authorization.

## Remaining gates and Step 3 handoff

Step 1 acceptance remains failed (55 pass / 23 fail in its original offline directory); Step 2 adds preparation checks only and neither fixes nor suppresses those misses. Native target attainment, actual storage bottleneck/topology, saver conformance/default activation and full-initiative baseline all remain unproven.

Step 3 may prepare a bounded live benchmark/runbook now, using this blocked status and the offline failures. Executing it still needs explicit provider cost/data/operator authorization, Calendar read scope/disposable data permission, and separately approved bounded native evidence where required; any event creation needs separate disposable-target mutation permission. No live calls, backend restarts, paid work or staging were authorized here. Insufficient evidence must remain explicit in Step 4; preparation cannot substantiate storage/provider latency or colocation speedup claims.

## I3 continuation — 2026-10-30 (preparation only)

User chose **Help prepare prerequisites**, not native execution. See [native-prerequisites.md](native-prerequisites.md) for exact operator inputs, no-connect report and baseline overlay correction. Earlier evidence above is preserved; these fresh checks do not supersede acceptance misses or establish native conformance.

- Added driver-free, secret-safe preflight using the existing authorization policy. Actual URI contents are never accessed; only environment-key presence is reported. Current report: all nine public fields unset, URI entry unset, execution blocked. Even fully populated fields cannot make preflight construct a client or declare execution ready.
- Shared the same six scenario definitions between suite and report. Proposed load remains one sample per source: **12 generated DBs / 54 turns for baseline+current**, including seeds. Legacy guard ceiling is not permission to run extra samples.
- Independently checked identical seven-file overlay against candidate and old `35eb6e8` source: **46 offline tests pass on each**; both native selections **0 run / 6 skipped** with execution forced disabled. Mocked openers/BSON fakes only. Five old-source runtime/persistence/fixture blob hashes match their baseline commit; seven harness hashes match between overlays.
- Found and corrected a real baseline-runbook gap: Step 1 snapshot lacked e2e config. Extracted `backend/vitest.config.e2e.ts` from the exact baseline commit; initial startup failure was not a native run. Future baseline preparation must include that config, in addition to the native-file overlay described above.
- Focused seven-file type-aware lint passes with no diagnostics. No package build was run alongside I1; final integrated build remains orchestrator-owned. Current implementation is evolving under I1/I2, so old clean-candidate labels/hashes must not be reused for a later native run without identifying final source.
- No connection, secret/application `.env` access, service change, provisioning, restart, paid call, Calendar access, commit/staging/worktree or reviewer. Native measurements, causal-wave goals, real durability evidence and saver conformance remain blocked/unverified. Review remains **skipped**.
