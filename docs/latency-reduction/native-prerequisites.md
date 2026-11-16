# Native prerequisites — offline I3 preparation

2026-10-30. The user requested **help preparing prerequisites**, not a connection. No execution, provisioning, restart, paid call or secret inspection is authorized. Review remains **skipped**.

## Preparation plan

- [x] Add failing offline preflight checks, then reuse the existing authorization helper for public-field validation without client construction or URI access.
- [x] Independently exercise the same native overlay against candidate and identified old source using only mocked openers/BSON fakes.
- [x] Record secret-safe readiness output, exact operator inputs, one-sample pair bounds, commands/results and remaining gates.

Own only native preparation files and this document; preserve historical evidence in `acceptance-native.md`. No shared production/runtime/offline/state/report changes. Avoid package builds while I1 owns shared implementation.

## Current status: BLOCKED, not execution-ready

Fresh no-connect report: **all nine public fields unset; URI environment entry unset**. URI contents were **not read**, parsed, validated or logged. No application `.env` or secret store was accessed. There is no native measurement, service discovery or topology evidence.

The new report imports only the driver-free `native-safety.ts` helper. It calls the existing `authorizeNative` policy with an explicitly offline placeholder to validate public fields; the placeholder is never returned as configuration or passed to any client. Actual URI presence is checked with `Object.hasOwn` only; a throwing URI getter is covered by offline tests. Invalid public values and exceptions are never echoed. Preflight cannot construct a client, even if every execution field is already set to authorized values.

`executionReady` is **always false**: preflight is not execution authorization or actual topology/source conformance. `publicFieldsValid` describes public-field syntax only; `proposalMatches` additionally requires one sample. Neither proves URI nonblankness, secure delivery, the authenticity of an attestation, source identity, a dedicated deployment or I1/I2 acceptance. Exit 0 means the no-connect reporting/check completed, **not** that prerequisites are satisfied.

### Safe command available now

From candidate `backend/`, without setting permissions or loading dotenv:

```powershell
npm test -- test/performance/native-preflight.spec.ts --maxWorkers=1 --silent=false --disableConsoleIntercept
```

It prints a payload-free JSON status, for example this actual capture (field statuses abbreviated here; full JSON is in the log):

```json
{"kind":"native-offline-preflight","mode":"offline-no-connect","executionReady":false,"publicFieldsValid":false,"proposalMatches":false,"uri":"unset","proposedPair":{"samplesPerSource":1,"databases":12,"turns":54}}
```

Full capture: `C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-preflight-report.log`. Do not use broad e2e discovery with credentials present: older unrelated native suites have weaker opt-in guards.

## Exact operator inputs still required

Nothing below has been approved or supplied. This is a checklist to prepare, not permission to connect, create infrastructure or start/restart a service.

| Input | Required value/evidence | Observed status |
| --- | --- | --- |
| Written execution permission | Operator, date/expiry, dedicated test deployment identity, exact source/harness identifiers, two invocations, one sample each, cleanup responsibility | **Not granted**; latest choice was preparation only |
| `AURVIN_NATIVE_PERF_ENABLE` | `authorized`, only after the above permission | Unset |
| `AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET` | `attested`; independent attestation of an existing dedicated non-application **native MongoDB replica set**, not inferred from a URI | Unset / no attestation |
| `AURVIN_NATIVE_PERF_REPLICA_SET` | Exact independently attested set name, 1–80 alphanumeric/underscore/hyphen characters | Unset |
| `AURVIN_TEST_MONGODB_URI` | Existing operator test URI, injected securely into the operator's execution process; do not paste into chat, documents, logs, commands/history or application `.env` | Entry unset; contents uninspected |
| `AURVIN_TEST_DB_PREFIX` | Exactly `aurvin_p2_test_`; never an application database | Unset |
| `AURVIN_NATIVE_PERF_CREATE_DROP` | `approved`, with explicit permission to materialize/drop only generated `aurvin_p2_test_<UUID>` databases and operator cleanup of leftovers after unsafe exit | Unset / no permission |
| `AURVIN_NATIVE_PERF_SAMPLE_LOAD` | Existing guard token `approved-max-18-databases-81-turns`; **written approval for this proposal must be narrower: 6 DB/27 turns per invocation, 12 DB/54 turns for the pair** | Unset / no load permission |
| `AURVIN_NATIVE_PERF_SAMPLES` | Exactly `1` for **both** proposed invocations; legacy guard accepts up to 3, but that is **not** this proposal or permission | Unset |
| `AURVIN_NATIVE_PERF_LABEL` | `baseline` in old snapshot; `current` in frozen candidate snapshot | Unset |
| `AURVIN_NATIVE_PERF_REVISION` | 40 lowercase hex source revision; baseline `35eb6e85d0b80f3d88abf32218120ce19a7a32d8`; current source must be finalized/identified after I1/I2 | Unset / current source not frozen |

The one-sample pair has **six scenarios per source**: new text, follow-up-1, follow-up-20, Calendar text/read/create. Each uses one generated database. Seed turns: `0+1+20+0+0+0=21`; measured turns: 6. Therefore each source runs `6 DB / (21+6)=27 turns`; the pair is **12 DB / 54 turns**, unchanged. The suite and preflight now share the same immutable scenario list, so reported load is derived from the actual suite definitions rather than a second hardcoded scenario list. A regression check fixes the proposal at 12/54.

Bootstrap/index work, post-window correctness/readiness probes and deletion also consume storage commands; the turn bound is not a predeclared command-count or dollar budget. All external model/Calendar transports in these native fixtures remain scripted, including the synthetic Calendar-create scenario; this does not authorize any real Calendar mutation. Client/time budgets and single-executor-per-generated-database ownership are unchanged. Majority durability and default-disabled saver facade remain intact.

### Approval proposal to fill later — NOT APPROVED

> I, [operator], authorize only the two identified source/harness snapshots on [existing dedicated test replica-set identity/set name], using securely supplied isolated test credentials, for one sample of the six native scenarios per source: 12 generated databases and 54 turns total, including seeding. I approve required bootstrap/index/probe work and creation/deletion of those generated databases only, and accept responsibility for leftover cleanup. Approval expires [time]. This grants no application DB access, infrastructure provisioning, service change, real provider/Calendar call, mutation, staging, saver activation or public deployment.

Before using any future execution command, record source and harness hashes, installed dependency versions/lockfile equivalence, topology/load conditions and both invocation identifiers. The source revision field alone is not cryptographic verification of a dirty checkout. Current `HEAD` is still `2a32994bd27b8a98ecce02a12d2a39e45e97e76b`, while I1/I2 implementation is changing: **do not label that evolving source as the old clean committed candidate**. Freeze and identify the final implementation separately. No candidate build or acceptance conclusion was borrowed from concurrent agents.

## Independent OFFLINE overlay check

The old Step 1 extracted snapshot was reused; no worktree or production source edit was made. Seven explicit native files were copied into `C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8/backend/test/performance/`. All seven SHA-256 values match candidate overlay files: [temporary manifest](C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-overlay-hashes.json).

Git blob hashes of five old-snapshot files were independently compared with the exact `35eb6e8` commit: durable runtime, persistence composition, checkpointer, text fixture and Calendar fixture — **5/5 match**. Record: `C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-baseline-source.json`. This is scoped source provenance, not a full source-tree attestation. `35eb6e8` already includes phases 0–6; it is not a reconstructed full pre-initiative baseline.

The first old-snapshot disabled-e2e invocation failed **before discovery**, because the Step 1 archive omitted `backend/vitest.config.e2e.ts`. This was a real preparation gap in the earlier invocation instructions. The exact baseline config was extracted from the same commit, not substituted with candidate production code:

```powershell
# Root; these two local archive/extract commands were actually run.
git archive --format=zip --output=C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-baseline-e2e-config.zip 35eb6e85d0b80f3d88abf32218120ce19a7a32d8 backend/vitest.config.e2e.ts
Expand-Archive -LiteralPath C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-baseline-e2e-config.zip -DestinationPath C:/Users/Peter/AppData/Local/Temp/opencode/latency-baseline-35eb6e8
```

After that correction, **both snapshots independently pass 46 offline preparation checks** and **both discover/skip all 6 native scenarios with execution forced disabled**. The mocked-opener tests actually assemble and run a text and Calendar-text turn over the BSON fake on each source. They validate boundary plumbing/cleanup/readiness, not native performance. Native discovery validates imports/configuration, not all six real-storage paths. No native result, source speedup, majority-ack measurement or conformance claim follows from these checks.

### Exact fresh test commands

From candidate `backend/`:

```powershell
npm test -- test/performance/native-preparation.spec.ts -t 'reports every missing|validates public field|reports missing URI' --maxWorkers=1 > C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-preflight-red.log 2>&1
npm test -- test/performance/native-preparation.spec.ts test/performance/native-runtime-preparation.spec.ts test/performance/native-preflight.spec.ts --maxWorkers=1 --silent=false --disableConsoleIntercept > C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-current-offline.log 2>&1
npm test -- test/performance/native-preflight.spec.ts --maxWorkers=1 --silent=false --disableConsoleIntercept > C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-preflight-report.log 2>&1
$env:AURVIN_NATIVE_PERF_ENABLE = 'disabled'
npm run test:e2e -- test/performance/native-latency.e2e-spec.ts --maxWorkers=1 --reporter=verbose > C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-current-disabled.log 2>&1
node node_modules/oxlint/bin/oxlint --type-aware test/performance/native-safety.ts test/performance/native-database.ts test/performance/native-runtime.ts test/performance/native-latency.e2e-spec.ts test/performance/native-preparation.spec.ts test/performance/native-runtime-preparation.spec.ts test/performance/native-preflight.spec.ts > C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-focused-lint.log 2>&1
```

From extracted baseline `.../latency-baseline-35eb6e8/backend/`, after the identical seven-file overlay and config correction:

```powershell
npm test -- test/performance/native-preparation.spec.ts test/performance/native-runtime-preparation.spec.ts test/performance/native-preflight.spec.ts --maxWorkers=1 --silent=false --disableConsoleIntercept > C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-baseline-offline.log 2>&1
$env:AURVIN_NATIVE_PERF_ENABLE = 'disabled'
npm run test:e2e -- test/performance/native-latency.e2e-spec.ts --maxWorkers=1 --reporter=verbose > C:/Users/Peter/AppData/Local/Temp/opencode/latency-i3-baseline-disabled.log 2>&1
```

| Fresh check | Actual outcome |
| --- | --- |
| Initial preflight red tests | 3 expected failures / 40 filtered; stub report lacked behavior; exit 1 |
| Candidate focused offline tests | **46 passed / 0 skipped**, exit 0 |
| Old-source identical-overlay focused offline tests | **46 passed / 0 skipped**, exit 0 |
| Standalone real-public-environment no-connect report | 1 passed; all authorization fields unset; URI entry unset; `executionReady=false` |
| Candidate native suite, forced disabled | **0 run / 6 skipped**, exit 0 |
| Old-source native suite, forced disabled, after config repair | **0 run / 6 skipped**, exit 0 |
| Seven-file focused type-aware lint | Pass, exit 0; no diagnostics |
| Build | **Not run**: no production/build wiring changed; avoid concurrent package build with I1. Orchestrator's final integrated build remains required |
| Whole offline performance/acceptance | Not rerun here while I1 changes shared paths; previous failures are not suppressed or rebased |
| Whitespace/local links | Checked separately; shared-file LF→CRLF warnings remain unrelated |
| Actual native/database/provider/Calendar/staging | **Not run; not authorized** |

## Changed files and remaining gates

I3 changes: `backend/test/performance/native-safety.ts` (preflight and shared unchanged scenario definitions), `native-preparation.spec.ts` (three new public/secret-safety checks and accurate header), `native-latency.e2e-spec.ts` (uses shared scenario definitions), new `native-preflight.spec.ts`, this document, and an appended dated continuation in `acceptance-native.md`. Existing native runtime/database/assembly fixture behavior is unchanged. No shared source/offline/state/report file was edited.

Still missing: actual execution permission; dedicated topology attestation; secure URI delivery; exact-prefix/create-drop/sample approval; finalized current-source identity and integrated I1/I2 evidence; actual native baseline/current measurements. Preflight cannot verify those facts. Native **causal-wave instrumentation remains absent** (busy intervals are not dependency waves). Saver facade-vs-stock pending-write/restart/scope/bounds/failure conformance remains required **before default activation**. Broader native fault/cancellation/retry/conflict/proposal/near-context-ceiling coverage and a true full pre-initiative baseline also remain gaps. No infrastructure setup or service change is included or implied.
