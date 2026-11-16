# Latency acceptance follow-up

## Scope and authorization

Approved sequence resumed from `aurvin-latency-orchestration-handoff.md` on 2026-10-29. Starting HEAD: `2a32994bd27b8a98ecce02a12d2a39e45e97e76b`; starting checkout clean. This follow-up does not reopen the Phase 1 workflow.

One distinct subagent owns each step, with continuations on that same agent as needed. Execution is sequential; maximum three active children. Orchestrator owns this status record, not implementation. Review is **skipped**, not passed.

No staging, commits, pushes, worktrees, database connections, paid calls, Calendar access/mutations, backend restarts, deployment, migration, or infrastructure changes are authorized. Native saver facade activation remains gated. Preserve durability, accounting, identity-before-output, and existing semantics.

## Dependencies and ownership

| Step | Prerequisite | Ownership | Status |
| --- | --- | --- | --- |
| 1: Offline acceptance | Approved handoff | Offline performance tests/helpers and `acceptance-offline.md`; no production changes | Evidence complete; acceptance failed; agent `ses_e780b10d8ffeFccKv5k5cREvrN` |
| 2: Native harness preparation | Step 1 evidence | Isolated native performance suites/config and `acceptance-native.md`; no connections | Preparation complete; native execution blocked; agent `ses_e77ffd704ffe5re5G8iRwFTbu2` |
| 3: Live Calendar benchmark readiness | Steps 1–2 evidence; execution requires separate authorization | Bounded runbook/config and `acceptance-live.md`; unauthorized execution recorded blocked | Preparation complete; execution blocked; agent `ses_e77f2462affemsgySRz2penQLt` |
| 4: Evidence-based next intervention | Steps 1–3 reports | `acceptance-report.md`; synthesis and verification, not review | Complete; agent `ses_e77edb53fffeL59maNdV9EGSjE` |

## Acceptance and reporting gates

- Independently rerun matching baseline/current offline scenarios; capture total native wire commands, pre-dispatch waves, first-answer evidence, post-seal waves/tail, provenance and baseline scope differences.
- Fixed non-self-derived goals: at least 30% fewer pre-dispatch storage waves, 25% fewer total wire commands, 30% fewer post-seal waves. Report misses without weakening correctness or relabeling total-wave reductions.
- Native execution requires explicit operator authorization, dedicated replica-set attestation, existing operator test URI, exact `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`, and generated-database/sample-load approval. Never read application `.env` or substitute its database.
- Live execution requires explicit bounded cost/data/operator authorization; mutations require separate disposable-target permission. Preparation is not execution.
- Final evidence distinguishes fresh results, prior reports, skips, blocked checks, and hypotheses. No topology, latency, or speedup conclusions without measurements.

## Verification record

Step 1 report: [acceptance-offline.md](acceptance-offline.md). Independent incremental baseline `35eb6e8` already includes phases 0–6; full pre-initiative baseline remains unavailable. Candidate pre-dispatch goal 0/13, command goal 0/15, post-seal goal 7/12 (all Calendar scenarios miss). Full offline suite: 55 passed / 23 failed, no skips. Correctness diagnostic: 48 passed, 30 gates filtered, not acceptance success. Baseline: 46 passed, 15 candidate goals filtered. Agent reports backend build/lint and diff checks pass, with lint warnings. Synthetic wave timings are not native/provider measurements. Regression/acceptance gates intentionally remain failing; no production fix authorized in this step.

Step 2 report: [acceptance-native.md](acceptance-native.md). Six native scenarios prepared behind explicit preconnect authorization; 42 offline preparation tests pass, native 0 run / 6 skipped. Full offline performance now 97 passed / 23 failed (known failures preserved). Agent reports build/lint pass; broad test-tree TypeScript diagnostic fails with 201 diagnostics outside Step 2 files (not baseline-isolated). Native causal-wave targets, latency and saver conformance remain unverified; scope gaps explicitly recorded.

Step 3 report: [acceptance-live.md](acceptance-live.md). Runbook prepared, 12 offline tests pass, 23 links/source ranges validated. No live execution; CLI does not enforce read-only access, cumulative spending or complete causal-wave coverage. Offline acceptance, native evidence and explicit execution permissions remain missing.

Step 4 report: [acceptance-report.md](acceptance-report.md). Fresh scoped backend verification: 109 passed / 23 failed; frontend 495 passed. Both builds/lints pass with warnings. Broad backend typecheck fails with 196 diagnostics, not baseline-isolated; new native suite 0 executed / 6 skipped. Baseline source/instrumentation and original logs independently checked; all 30 fresh candidate summary rows match Step 1. Final report records hashes, precise commands, measurement exclusions, all 13 follow-up files and documentation checks.

## Current gate

The approved four-step follow-up and the 2026-10-30 implementation continuation are finished to their authorized extent: offline evidence, both offline code interventions, native prerequisite preparation, blocked-live readiness, and independent assembled-source verification. **Latency acceptance remains FAILED; native/live execution remains BLOCKED.** Review remains **skipped**. No overall completion/readiness claim is made for the latency initiative.

The earlier recommendation to investigate text pre-dispatch and Calendar phase misses was implemented offline in I1/I2. Remaining pre-dispatch (0/13) and command (0/15) goals need a further separately planned intervention, chiefly in the initial message/context/manifest load sequence; they are not closable by removing existing durability guards.

All implementation changes remain uncommitted/unstaged. No package/configuration or lockfile changes were made. Continue the same owning agent if a correction is needed; do not dispatch a reviewer or review-triggered fixer.

## Implementation continuation — 2026-10-30

User requested completing all recommended steps with a subagent assigned per step. This authorizes scoped offline production fixes and verification, superseding the earlier no-production-edit restriction for this continuation only. Existing test/harness/doc changes are preserved. No commits, paid calls, database access, Calendar access, restarts or infrastructure changes are inferred without their missing concrete permissions/prerequisites. Review stays skipped. Do not declare full completion while required measurements are blocked or goals fail.

| Step | Scope and owner | Dependency | Current status |
| --- | --- | --- | --- |
| I1 | Offline shared text dispatch critical-path fix; agent `ses_e74a3d899ffezSWNZQOyLVTsvZ` | Existing independent evidence | Implemented and independently verified; pre/command goals still miss |
| I2 | Offline Calendar phase optimization; agent `ses_e749c38e0ffeaaIkFjROqMOjO7` | I1 shared-path results | Implemented and independently verified; post-seal goals pass, pre/command goals still miss |
| I3 | Native prerequisite preparation and eventual baseline/current measurement; original native owner `ses_e77ffd704ffe5re5G8iRwFTbu2` | Preparation independent; execution needs offline results and operator authorization/attestation/load approval | Offline prerequisite preparation complete; actual execution blocked |
| I4 | Safe live harness and eventual bounded read-only Calendar benchmark; original live owner `ses_e77f2462affemsgySRz2penQLt` | Harness preparation independent; execution needs native evidence and cost/data/operator permission | Offline guard/harness prepared; runtime integration and actual execution blocked |

Implementation agents must plan before editing, retain fixed baseline/acceptance thresholds, use TDD and meaningful checks, and preserve synchronous majority durability, generation identity before output, accounting, conflict/context/tool/retention semantics and executor isolation. Do not activate the saver facade without native conformance. Orchestrator manages status, not code.

User answered the execution-prerequisite questions with **Help prepare prerequisites** (native) and **Prepare safe live harness** (live). No native connection, paid call, Calendar access or restart authorized. Native prerequisite and live offline harness preparation may proceed independently of I1/I2, with real execution still dependency/authorization gated. Continue original native/live owners; maximum three concurrent agents including I1.

I1 agent evidence: [text-critical-path-results.md](text-critical-path-results.md). Removed redundant accounting save and forwarded existing accounting receipt into revision-CAS path. New text commands 188→179, pre/first-answer waves 88/98→83/92; follow-up commands 183→174, waves 83/93→78/87. Calendar unchanged. Agent reports 443 focused passes; full safe matrix 118 passed / 15 failed, all 15 non-regression cases pass, all 15 combined acceptance cases still fail. Build/lint pass with warnings. Frozen baseline/gates unchanged. This is an offline code improvement, not native/live latency evidence.

I3 agent evidence: [native-prerequisites.md](native-prerequisites.md), dated continuation in [acceptance-native.md](acceptance-native.md). Driver-free preflight reuses authorization policy without URI-content exposure. Shared scenario definitions confirm paired one-sample load of 12 databases / 54 turns. Candidate and extracted incremental baseline each pass 46 offline checks; each native selection has 0 run / 6 skipped. Missing baseline e2e configuration corrected; source/overlay hashes recorded. Focused lint/docs pass; integrated build still pending. Execution permission, public settings, secure URI, dedicated replica-set attestation/create/drop/load approval and finalized source identity remain missing. No actual native evidence, causal-wave instrumentation or saver conformance pass.

I4 agent evidence: [live-harness-results.md](live-harness-results.md), dated continuation in [acceptance-live.md](acceptance-live.md). Added an explicitly injected Calendar read-only egress guard and synthetic selected-run harness; 61 offline tests pass, targeted lint and scoped source/spec typechecks pass. Guard denies mutations/out-of-target reads and bounds requests/bytes/deadlines only where installed. Live mode unconditionally rejects; this is not production-wide enforcement or preventive spend authority. Actual integration still requires compatible credential/discovery handling, trusted running-source/admission/cleanup evidence, native evidence and explicit execution/setup/restart permissions. Integrated build/regressions pending I2 stabilization. No live run or external call occurred.

I2 first-intervention evidence: [calendar-critical-path-results.md](calendar-critical-path-results.md). Calendar read/create commands 255→243 / 309→297; regular pre-dispatch 102→100, proposal 185 unchanged; post-seal 42→32. Original post-seal goals now 12/12 pass; pre-dispatch 0/13 and commands 0/15 still miss. Agent reports 726 focused passes; full safe matrix 127 passed / 15 acceptance failures. Builds/lint pass with warnings. No frozen gate/instrumentation changes. Continuing remaining evidence-reuse investigation within existing offline authorization, not declaring full acceptance.

I1 continuation evidence is appended to [text-critical-path-results.md](text-critical-path-results.md). Combined bounded acceptance phase, reused acknowledged acquisition session with legacy fallback, and overlapped independent stock-saver/history reads. New-text commands 179→174/pre waves 83→75; follow-up 174→169/pre 78→69; near-ceiling pre 80/81→69; retry 172→168/pre 78→70. Agent reports 764 focused passes; captured matrix 135 passed / 15 acceptance failures; non-regression 15/15 and post-seal 12/12 pass, pre 0/13 and commands 0/15 still miss. Targeted lint passes with warnings; no build. I2 source changed between captures and after them, so these are scoped intermediate results, not final checkout certification.

I2 continuation appended to [calendar-critical-path-results.md](calendar-critical-path-results.md): revision-scoped debit receipt saves two reads (5→3 commands, three writes retained); stale/forged/private-claim/duplicate/uncertain-write cases covered. Strict aggregate/settlement reads retained because existing receipts do not prove safe omission. Agent reports 741 focused passes, 20 final safety passes, intermediate matrix 135 passed / 15 acceptance failures. Concurrent assembled Calendar read/create 236/290 commands, regular pre 92/proposal 174/post 32, not isolated I2 gains. Scoped typecheck reports 44 diagnostics outside its selected files including seven in I1 runtime edits; routed to original I1 owner for correction, not a reviewer/fixer. No package build in this continuation. All source now awaiting serialized stable integrated verification.

I1 correction handoff supplied by user: seven TS2774 diagnostics resolved by explicit capability guards, no type casts or behavior/gate changes. Reports build/lint pass, 764 expanded focused passes, matrix 135 passed / 15 acceptance failures. Scoped typecheck still reports 37 fixture diagnostics in two existing fixtures; their provenance is **not yet independently established**, so no attribution to I2/native/live is assumed. Original synchronous correction dispatch was interrupted; user-supplied report and on-disk evidence now go to independent final verifier. No review requested or reinstated.

## Independent assembled verification — 2026-10-30

Report: [implementation-verification.md](implementation-verification.md) (committed separately as `67669df`; no implementation file was committed by this workflow). All other changes remain unstaged.

- Fresh assembled results: backend build/lint pass (warnings remain); safe offline backend suite **2216 passed / 16 failed / 2 skipped**, excluding loopback/socket files; performance matrix **46 passed / 15 failed**; frontend build/lint pass, **495 tests pass**.
- Goal reconciliation against incremental baseline `35eb6e8`: pre-dispatch **0/13**, complete commands **0/15**, post-seal **12/12**, non-regression **15/15**, combined scenario acceptance **0/15**.
- Applied reductions: new text 205→174 commands and 84/95/73→75/84/44 waves; Calendar read 266→236 and 107/181/48→92/164/32; Calendar create 320→290 and 107/235/48→92/218/32. Gains are combined I1/I2, not isolated per intervention.
- Diagnostics: 199 broad backend typecheck diagnostics vs 194 in baseline; I1-owned files **0**; the 37 fixture diagnostics (`latency-runtime-fixture.ts` 1, `calendar-runtime.fixture.ts` 36) were independently reproduced in `35eb6e8`, so they are pre-existing. The one non-acceptance suite failure was `calendar-simplification.built.spec.ts` (`vi` undefined in `test/http/fixtures.ts`), consistent with the separately tracked shared-dist rebuild/import race; not isolated to baseline here.
- Frozen identities rechecked by orchestrator: `durable-latency.spec.ts` `a92507ec…e129d` and `latency-runtime-fixture.ts` `61a7e900…b9f6`, both matching the Step 4 hashes.
- Native: **0 run / 6 skipped** behind fail-closed authorization. Live: live mode unconditionally rejects; guard applies only where installed. Neither is performance evidence.

**Remaining blockers:** dedicated replica-set attestation, securely supplied test URI, create/drop and 12-database/54-turn load approval for native; production egress installation, preventive spend authority, credential/discovery compatibility and trusted admission for live. Further offline acceptance requires the larger message/context/manifest load consolidation.
