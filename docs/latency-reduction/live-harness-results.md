# I4 safe live-harness preparation — 2026-10-30

**Offline implementation complete; actual live execution still BLOCKED. Not ready merely by supplying approval/config values.** Review **skipped**. No secrets/application `.env`, database/network/provider/Calendar/browser/staging calls, backend restarts, infrastructure/deployment, model changes, commits/staging/worktrees or agents. Tests used in-memory transports only, including when exercising real Calendar request construction.

## Files / ownership

- [readonly-calendar-boundary.ts](../../backend/src/benchmark/readonly-calendar-boundary.ts): explicitly injected fail-closed Calendar list-fetch boundary, not wired into production.
- [readonly-harness.ts](../../backend/src/benchmark/readonly-harness.ts): strict numerical/source/approval envelope and selected **synthetic-only** paired driver, reusing existing `runText`, scenario, redaction/correlation and timing analysis.
- [readonly-calendar-boundary.spec.ts](../../backend/test/benchmark/readonly-calendar-boundary.spec.ts): 28 offline boundary cases.
- [readonly-harness.spec.ts](../../backend/test/benchmark/readonly-harness.spec.ts): 33 offline preparation/selected-run cases.
- [live-harness-plan.md](live-harness-plan.md), this result and dated append to [acceptance-live.md](acceptance-live.md).

No shared runtime/model/Google/tool/application composition, old CLI/runner, package scripts, dependencies/lockfiles, native/offline performance fixtures, acceptance state or final report edited. Other agents' dirty changes preserved. Historical Step 3 evidence remains intact above the dated continuation.

## What is actually enforced

### Calendar egress boundary (only wherever explicitly installed)

`createReadOnlyCalendarBoundary(policy, injectedFetch, monotonicNow?, parentSignal?)` has **no default fetch**. A parsed copy of policy fixes one synthetic target, exact increasing window of at most one hour, max 20 list results, numerical request limit, cumulative response-byte limit and process-monotonic deadline.

Before upstream transport, it normalizes URL/Request input and denies everything except HTTPS `www.googleapis.com`'s exact encoded target events-list path with the current production list projection/query. Only GET, accept/authorization headers, exact window, bounded integer `maxResults`, fixed UTC/order/singleEvents/showDeleted/fields are admitted. Writes, method-override headers, other targets/origins/paths, get-event/discovery/freebusy/OAuth/refresh endpoints, pagination/unknown/duplicate query keys and alternate projections are denied. Redirect following is forced off, browser cookies omitted, and redirected/non-2xx responses denied. No request body is permitted.

Request budget is reserved synchronously before the first await; failures consume it. Response chunks are bounded cumulatively across reads; over-budget chunks are not delivered to the caller. An upstream may already have transmitted a chunk before cancellation; this is a consumed/projection limit, not a guarantee of exact network bytes or zero disclosure. Only approved synthetic account data is acceptable.

Any denial/transport failure poisons the boundary and aborts other guarded calls; caught errors cannot reopen it. Remaining monotonic deadline bounds waiting for response headers **and body**, including a synthetic transport that ignores cancellation. Parent abort revokes retained boundary callbacks. Errors are fixed codes, never upstream payloads/URLs/tokens. All upstream calls are injected; no connection was made to Google.

**Actual-path coverage:** tests inject this boundary into the real current `CalendarApi`. A v2 list request passes to an in-memory fake; an otherwise authorized v2 create is denied before that fake is called and latches closed. This demonstrates the installed boundary's behavior, **not installation in Aurvin's production runtime**. The boundary does not govern traffic that bypasses it.

### Selected driver / envelope

`validateReadOnlyEnvelope(raw, wallNow?)` admits only `calendar_list_events`, exactly two turns (one baseline, one current), one synthetic target and UTC window. No voice, creation, seeds, warmups, proposal replies or retries. Strict fields require nonempty operator/approval references, paid/Calendar-data/durable-database-write/synthetic-account declarations, expiry and positive finite integral budgets. These declarations are syntactic test inputs, **not authentication or signed operator authorization**.

Each source requires a distinct 40-hex source revision, matching build revision, matching source-tree/build-source SHA-256 fingerprints, and identical baseline/current harness and semantic fingerprints. Semantic fingerprint must eventually cover unchanged model/provider route, instructions/context/tool definitions, runtime limits, retention/accounting/durability, permissions and relevant environment. `baseUrl` must satisfy the existing loopback `/api` schema. Hash strings are checked for shape/equality only: they are not computed against a running server or evidence of a verified build. Dirty source trees require actual tree fingerprints, not just HEAD labels.

Budgets include integral **micro-USD** (`1,000,000 = USD 1`), cumulative prompt/completion tokens, model dispatches, Calendar/refresh requests, whole-pair deadline (max 300 s), existing per-turn client timeout (1–90 s), cumulative consumed response bytes per client/Calendar boundary and max results. Envelope must cover two turns of the declared **unchanged** server ceilings: context/output tokens multiplied by model dispatch ceilings, Calendar/refresh ceilings, and model-spend reservation ceilings. It does not lower model/context/tools or discard history to fit an envelope. A pair at the existing Calendar maximum needs capacity for up to 16 model dispatches, 40 charged Calendar requests and 4 refresh requests, excluding separately authorized setup. Reservations are **not** invoice guarantees.

`runReadOnlyHarness(raw, {mode:'live'})` **always rejects `LIVE_RUNTIME_INTEGRATION_REQUIRED` before parsing input or calling any transport/settlement hook**. No environment flag, approval-shaped JSON, native credential or CLI option bypasses this. No live CLI/script or default adapter was added. This is the fail-closed behavior when reliable cost/runtime enforcement is unavailable; there is no claim of a hard spend cap.

Synthetic mode alone requires explicit injected server transport, Calendar transport and settlement/evidence callback. The harness supplies the guard to the synthetic server transport; this hook is trusted test code, not remote attestation that a real server uses the guard. Never pass real fetch/provider credentials to these synthetic hooks. It reuses existing acceptance→SSE→durable-status client, limits each turn to its three existing client requests, bounds cumulative client bytes, and races submission/stream/settlement against a whole-run monotonic deadline. Approval expiry is rechecked between phases. First failure stops **all later turns**, not just repetitions. Parent shutdown revokes guarded callbacks and aborts pipelines; that does not establish provider cancellation/billing cessation.

Settlement must be completed/ready/durable, known synthetic billing/usage, matching source/build/harness/semantic identity, expected tool only, terminal completed evidence and complete unique successful model-stream-end records matching token/count totals and both per-turn/pair numerical ceilings. No next turn on unknown billing, missing usage/timing, wrong tool, overspend, inconsistent provenance, timeout, missing cleanup or failed/truncated/clarification outcomes. Numerical settlement comparisons are **post-operation verification of test receipts**, not preventive enforcement of real remote spend or token usage. Actual billing in returned reports remains **unknown**, even when synthetic accounting fixtures are known.

The accepted run-envelope object is copied by parsing; subsequent caller mutation cannot widen it. Limits are per invocation; no durable cross-invocation admission ledger exists. These are additional reasons not to expose synthetic mode as an operator live entry point.

## Measurement / evidence limitations

- Client first nonempty delta, acceptance/duration and per-dispatch first-output/end/token-derived throughput reuse existing monotonic timing interfaces. Missing first text is null; a tool decision's meaningful output is not a user's first answer. Tool/provider spans overlap; no additive latency or CPU/RTT inference.
- Exported rows contain source revision, hashed attempt identity, timing/model summaries and synthetic outcomes only. No prompts, text, raw Calendar/account/session/turn/attempt identifiers, URLs, headers, credential data or arbitrary receipt fields. Existing safe projection/correlation is reused; raw fixture text and metadata redaction are asserted.
- Complete wire commands, causal storage waves, acknowledged-seal/post-seal tail and provider-versus-storage decomposition **remain unavailable** in this driver. `commandWaves='unavailable'`, not zero. It does not replace missing native instrumentation/results or satisfy 30% pre-dispatch / 25% complete-command / 30% post-seal targets.
- No live speed, topology, colocation, production readiness, whole-initiative baseline or acceptance conclusion follows. Historical offline misses are not rebased/suppressed. I1/I2 changes require independent updated evidence owned by those agents/orchestrator.

## TDD and actual commands

All from `backend/`; no broad benchmark tests, sockets, e2e or package build:

```powershell
npm test -- test/benchmark/readonly-calendar-boundary.spec.ts --maxWorkers=1
npm test -- test/benchmark/readonly-calendar-boundary.spec.ts --maxWorkers=1 -t 'production'
npm test -- test/benchmark/readonly-harness.spec.ts --maxWorkers=1
npm test -- test/benchmark/readonly-harness.spec.ts --maxWorkers=1 -t 'real deny boundary'
npm test -- test/benchmark/readonly-harness.spec.ts --maxWorkers=1 -t 'revokes boundaries'
npm test -- test/benchmark/readonly-harness.spec.ts --maxWorkers=1 -t 'inconsistent per-dispatch timing'
npm test -- test/benchmark/readonly-calendar-boundary.spec.ts test/benchmark/readonly-harness.spec.ts --maxWorkers=1
node node_modules/oxlint/bin/oxlint --type-aware src/benchmark/readonly-calendar-boundary.ts src/benchmark/readonly-harness.ts test/benchmark/readonly-calendar-boundary.spec.ts test/benchmark/readonly-harness.spec.ts
```

| Check | Actual result |
| --- | --- |
| Initial minimal-export boundary stub | 23 failures, exit 1. Two initially included a wrong class-name import, corrected before implementation; focused corrected production check then 1 pass / 1 intended failure / 21 filtered. Not all initial failures are claimed as valid red evidence. |
| First implemented boundary | 22 pass / 1 fail; investigation found test used legacy v1 create, already denied before transport. Replaced it with authorized **v2** fixture so the check reaches the injected boundary; then 23 pass. |
| Minimal-export harness stub | 25 fail / 1 initially vacuous pass; tightened transport-call assertion and observed its focused failure before implementation. |
| First combined green | 49 pass, exit 0. |
| Added parent-revocation / per-turn / fingerprint tests | Red captures followed by 56 green. A retained-boundary test initially used an invalid URL and was corrected to the fully allowed URL; its focused run then failed as intended before parent-signal integration. |
| Added method-override / cumulative-byte / SSE cleanup checks | 57 pass / 3 fail, exit 1; failures show the missing protections. Implemented header allowlist, cumulative bytes and pipeline abort. |
| Added inconsistent per-dispatch timing check | Focused 1 fail / 32 filtered, exit 1, before monotonic ordering validation. Inconsistent timing is not exported as a successful model summary. |
| Final owned offline specs | **61 pass / 0 fail / 0 skip**, 2 files, exit 0; existing Vite paths-plugin warning remains. |
| Final targeted type-aware lint | **Pass**, exit 0, no output/warnings on the four owned files. Earlier local warnings were corrected. |
| Scoped compiler API, two source roots | **0 diagnostics**, exit 0. No emit/incremental output. |
| Scoped compiler API, four source/spec roots plus imports | **0 diagnostics**, exit 0 in the final capture. Earlier diagnostics included owned narrowing/mock types and imported Calendar-publication diagnostics; this is not a whole-repository typecheck or baseline-isolated claim. |
| Application build, broad regression/e2e and native/live | **Not run**. Coordinated full integration/build remains required after I1/I2 stabilize. |

Exact no-emit compiler check used (read only `tsconfig.json`; did not enumerate all repository roots):

```powershell
@'
const ts = require('typescript'), path = require('path');
const roots = ['src/benchmark/readonly-calendar-boundary.ts', 'src/benchmark/readonly-harness.ts', 'test/benchmark/readonly-calendar-boundary.spec.ts', 'test/benchmark/readonly-harness.spec.ts'];
const ownPaths = new Set(roots.map(p=>path.resolve(p).toLowerCase()));
const c=ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json',ts.sys.readFile).config,ts.sys,process.cwd());
for (const [label, files] of [['source',roots.slice(0,2)],['source-and-specs',roots]]) {
 const ds=ts.getPreEmitDiagnostics(ts.createProgram(files,{...c.options,noEmit:true,incremental:false}));
 const own=ds.filter(d=>d.file&&ownPaths.has(path.resolve(d.file.fileName).toLowerCase()));
 for (const d of ds) { const p=d.file?.getLineAndCharacterOfPosition(d.start||0); console.log(`${label}: ${d.file?.fileName}:${p?p.line+1:0} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`); }
 console.log(`${label}: ${ds.length} total; ${own.length} owned-file diagnostics`);
 if(ds.length) process.exitCode=1;
}
'@ | node -
```

Final explicit Python `pathlib`/regex checks passed for **7 owned files / 33 local links**, including source-line range existence, no trailing whitespace and required code headers (exit 0). Plain `git diff --check` does not inspect these untracked files. Tests/checks are offline implementation evidence, not native/live acceptance.

Final SHA-256 (raw file bytes):

| Owned file | SHA-256 |
| --- | --- |
| `backend/src/benchmark/readonly-calendar-boundary.ts` | `98316cef43e7b87f99a0dfb4a00b8d8ebb87e81be53b51deaac0db43ca19a67e` |
| `backend/src/benchmark/readonly-harness.ts` | `0960e687911ca5d25cf3b8ed5edbe4f7370824b0a1805dbcfceb6fe9dbd90caf` |
| `backend/test/benchmark/readonly-calendar-boundary.spec.ts` | `4ec4a6afe2c678637b6e96e98b3d3b9d9cdaa0e20278f4df558857235c9c9c5f` |
| `backend/test/benchmark/readonly-harness.spec.ts` | `91aac70dbf36832bd57fdfef1116d05965b5c3ad1d083c41ea321acab43623b2` |

## Exact integration needs for orchestrator — not implemented/authorized

1. **Production installation, separate owner/permission.** [app.service.ts](../../backend/src/app.service.ts) passes `this.ports.fetcher` both to Calendar assembly/discovery and runtime/model creation. [calendar-assembly.ts](../../backend/src/operations/calendar-assembly.ts) uses its shared fetcher for CalendarApi, availability, OAuth and identity. Installing this narrow Calendar-only guard as the entire shared fetcher would correctly deny model/OAuth/other traffic and is **not** a runnable solution. A separately scoped isolated benchmark composition must prove all Google mutation/out-of-target paths use the guard, model calls use their unchanged transport plus preventive budget authority, and nothing falls back to global fetch. Do not patch these shared files concurrently with I1/I2; no edits here were made.
2. **Discovery/credentials are unresolved.** The prepared guard deliberately denies discovery, token refresh, availability and other tools. Existing required grants are write-capable; ordinary readonly-only credentials are not a verified working replacement. Operator must supply an already-approved synthetic-only account/target and valid credential source through existing server secret ownership, plus a verified compatible fresh-discovery/token-lifetime plan, or separately authorize bounded discovery/refresh integration. Never skip capability checks or broaden the guard automatically. No OAuth/browser consent or credential operation was performed.
3. **Reliable budget admission before dispatch.** A real server adapter needs an exclusively allocated/provider-enforced spend cap or another verified reliable preventive bound covering all dispatches, cached/reasoning/request charges, repairs/retries and unknown outcomes; numerical declarations and ledger reservations alone are insufficient. Preserve original accounting and hold unknown billing. Similarly enforce cumulative token/request/turn/deadline ceilings at the actual server execution boundary without changing model/context/tool/retention/durability semantics. Isolated test budgets must cover unchanged ceilings; if not, remain blocked. Current receipt checks cannot replace preventive authority.
4. **Identity and durability attestation.** Add trusted non-secret running-build/source-tree/harness/semantic verification and ready-after-cleanup/accounting evidence, exact baseline/current labels and same approved guards. Synthetic receipts are arbitrary trusted test inputs and must not become client-supplied server attestations. Add authenticated one-shot admission/revocation across invocations; current per-call counters are not a durable run authorization ledger. Preserve one executor/database and no sentinel deletion.
5. **Execution permissions/evidence.** Still need actual authorized native baseline/current results, updated offline acceptance disposition, named operator/cost/data/DB-write permission with expiry, numeric limits and provider-side cap proof, synthetic-account visibility/target/time restrictions, retention/evidence access/cleanup approval and any isolated-server setup/restart/deployment permission. None supplied by “Prepare safe live harness.” Event creation and mutation cleanup need separate permission and are excluded. Existing server/backend must not be restarted under this task.
6. **Measurement integration.** Complete command monitoring and causal pre-dispatch/acknowledged-seal/post-seal instrumentation remain separate work; keep missing coverage explicit, and do not turn provider timings or synthetic numbers into native phase evidence. Full build/regression/integration checks should be serialized with the owners after shared changes settle.

**Readiness answer:** No, supplying only numerical config/credentials/operator approval will not make this runnable safely. Offline harness/guard are prepared and tested; production egress coverage, reliable preventive spend authority, credential/discovery compatibility, trusted admission/identity/cleanup evidence and missing native/phase gates remain required. Live mode must stay blocked until a separately authorized integration implements and tests those requirements. No code path was added that quietly treats a prompt/client flag as protection for server tools.
