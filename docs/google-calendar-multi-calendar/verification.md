# Multi-calendar verification

Review: **skipped, not passed**. Whole-workflow acceptance: pending.

## Commit and environment

Package and focused commands ran on branch `codex/google-calendar-plugin` at
`7e59b78b72dcec11a0e563a256020f3b775f25ac` (working tree clean of P9 source;
untracked `.openchamber/` screenshot only, not staged). A later evidence-only
commit may move HEAD; it does not change the tested source. UTC window
26 October 2026, Windows x64, Node `v24.18.0`, npm `12.0.1`, Vitest `4.1.11`
in the backend package. Backend MCP client/server `2.3.1`. MongoDB driver
`6.21.0`. Native URI was not supplied; exact prefix was not `aurvin_p2_test_`.
No credentials or URIs are recorded.

This rerecord follows P6 `1818749` (successor coverage persistence) and P7
`eb1203c` (browser fixture stream stabilization). Prior evidence SHA
`81512b9` is superseded for AC07 and P9-BROWSER. P9 implementation commits
remain `cb9a33b` `08809fb` `a383638` `d32947f` `87c82ac` `24746e5` `af36a3f`
`81512b9`. Adapter corrections stayed in P9-owned `assembled.ts` and were not
edited in this pass.

## Actual result ledger

| Check | Status | Evidence / limits |
| --- | --- | --- |
| Planner backend focused command in plan9.md | passed | Historical 5 files / 51 tests; 25 October 2026; not this run. |
| Planner frontend focused command in plan9.md | passed | Historical 3 files / 20 tests; Node only; not this run. |
| Owner calendar focused (`backend/` calendar contracts/persistence/plugins/mcp/model/runtime/context/assembly/operations/http/config) | passed | Historical at `81512b9`: 105 files / 784 tests, 0 failed, 0 skipped. Not re-run this pass. |
| New P9 assembled + SDK (`backend/` `test/integration/plugins/multi-calendar` and `test/plugins/integration/multi-calendar`) | passed | Focused `authority.spec.ts` this pass: 1 file / 5 tests, 0 failed, 0 skipped. Full package run below includes the remaining P9 files. Native e2e file is not in routine `*.spec.ts` discovery. |
| Frontend focused Calendar + P9 integration | passed | Historical at `81512b9`: 9 files / 49 tests, Node. Frontend P9 tests were not changed and were not re-run this pass. |
| Backend `npm run build` | passed | Exit 0 after tests. Type/module compatibility, not test evidence. |
| Backend `npm run lint` | passed | Exit 0 after tests; warnings only (pre-existing voice/calendar unused-import and unbound-method warnings); zero errors. |
| Backend `npm test` | passed | Default file-parallelism (not `--no-file-parallelism`). 244 files: 242 passed, 2 skipped. 1954 tests: 1944 passed, 10 skipped, 0 failed. Skips are existing empty/prerequisite suites, not native PASS. |
| Backend `npm run test:e2e` | not re-run | Previous skip record at `81512b9` still applies: native env vars absent. Not re-executed this pass. |
| Frontend `npm run build` | not re-run | Historical at `81512b9`: exit 0; Vite chunk-size warning (>500 kB). |
| Frontend `npm run lint` | not re-run | Historical at `81512b9`: exit 0; warnings only. |
| Frontend `npm test` | not re-run | Historical at `81512b9`: 67 files / 482 tests, Node; not browser. |
| Native checks | blocked | P9-NATIVE. |
| Browser checks | tested, incomplete | P9-BROWSER 8/8 P9-observed on intercepted-fetch fixture. P9-ACCESSIBILITY unrun. Fixture does not execute every requested browser scenario. |
| Live Google/model/policy | blocked | Named gates below; fixtures are not service evidence. |

## Acceptance mapping

| Criterion | Status | Required integrated evidence / remaining gate |
| --- | --- | --- |
| AC01 | tested, partial | No-target assembled boot, local Host/Origin/CSRF, Node no-ID Connect. P9-LIVE-CONSENT blocked. |
| AC02 | tested, partial | Cached 20+1 pages, no-store, owner discovery suites at prior SHA. Live list completeness P9-LIVE-ACL. |
| AC03 | tested, partial | SDK shared writer / masked writer create; reader/freeBusyReader refused before Google. P9-LIVE-ACL blocked. |
| AC04 | tested, partial | Explicit/default/primary HTTP targeting; save/reset without restart; no silent fallback. Native restart P9-NATIVE. |
| AC05 | tested, partial | Ordinary NL scheduling and unique-name routing without JSON echo. Human browser reply/focus covered in fixture 8/8; AT unrun. |
| AC06 | tested, partial | SDK 2×50 batches, HTTP-200 errors as incomplete, 23/25-hour opaque all-day, 2000/2001 interval bound. P9-LIVE-BUSY blocked. |
| AC07 | tested, partial | P9 `authority.spec.ts` 5/5 GREEN after P6 `1818749`: natural selection, unchanged conflict/coverage acceptance, coverage-change renewal, competing same-session 202+409, cross-session reference denial. Live conflict drill P9-LIVE-BUSY blocked. |
| AC08 | tested | Actual SDK five-tool catalogue, selector denial, schema tampering, repair exhaustion in assembled HTTP. |
| AC09 | tested, partial | Assembled pin during default switch and receipt-failure readback GREEN. P9-NATIVE and P9-LIVE-RETRY blocked. |
| AC10 | tested, partial | Production ledger equals observed Google Calendar HTTP count; grouped tool context; no secret payloads. Native lost-debit P9-NATIVE. |
| AC11 | tested, incomplete | Node client/reducer/SSR historical GREEN. P9-BROWSER 8/8 P9-observed. P9-ACCESSIBILITY unrun. |
| AC12 | tested, partial | One assembled store/runtime; owner migration fixtures not re-executed as app-data migration. P8-GATE-MIGRATION-ENTRYPOINT blocked. |
| AC13 | tested, partial | Host/Origin/CSRF/no-store GREEN. P8-GATE-P2-INVALIDATION source-wired `340bb28`, native/backup still blocked. P9-REAL-DATA-POLICY blocked. |
| AC14 | pending | Exact SHA/environment recorded. Review skipped. Required native/accessibility/live/policy evidence absent. |

## Named pending gates and limitations

P9-NATIVE, P9-ACCESSIBILITY, P9-LIVE-CONSENT, P9-LIVE-ACL, P9-LIVE-BUSY,
P9-LIVE-RETRY, P9-LIVE-QUOTA and P9-REAL-DATA-POLICY are not satisfied by
source existence or fixtures. P9-BROWSER intercepted-fetch fixture is 8/8
P9-observed; it is not live Google and does not replace keyboard/AT or
unexecuted fixture scenarios. P8-GATE-P2-INVALIDATION remains blocked for
native index/backup/restore despite A3 source wiring `340bb28`.
P8-GATE-MIGRATION-ENTRYPOINT remains blocked. P8-GATE-P4-CALENDAR-GET is
satisfied in the prior P9 assembled run after P4 `5202f8b`.
P8-GATE-P6-REQUEST-ACCOUNTING is satisfied in the assembled production-ledger
equality check after P6 `60345e9`. The former AC07 P6 HTTP defects
(`publishProposal` coverage renewal and competing-tab 503) are closed in
deterministic assembled HTTP after `1818749`.

Skipped or empty suites are not passing evidence. Historical Phase 1 native/browser
results and pending live/policy gates remain separate. No provisioning, application
data migration, paid inference, live service action, deployment, Azure, multi-instance
or production certification is inferred.

See [staging evidence](staging-evidence.md), [final report](final_report.md),
[approved goal](goal.md) and [execution state](state.md).
