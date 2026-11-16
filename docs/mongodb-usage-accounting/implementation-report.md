# MongoDB usage accounting — implementation and verification report

## Outcome and verification boundary

Implemented the mandatory accounting/storage/reporting/migration/documentation scope of the approved **custom single-worker** plan on 14 October 2026. No MAW workflow or additional agent was dispatched. All six coarse Steps are completed with the native-test exception explicitly allowed by the plan: native prerequisites were unavailable, so native evidence remains **skipped/unverified**.

Precise monetary evidence, independent cost completeness, optional provider token details, dispatch/provider/application timing, bounded internal reporting and ordinary indexes, opt-in dry-run-first maintenance, and backward-reading/recovery tests are implemented. Existing chat/voice execution, accounting identities, numeric compatibility fields, control records, stock saver layout, and ownership/journaling safeguards remain intact. No dashboard/auth endpoint, rollup, refund system, seventh accounting collection, live migration, paid provider call, deployment, provisioning, push or PR was introduced.

**Evidence is local/offline, not native MongoDB/Azure/production certification.** Required final builds/lint and executed regression suites passed. The supplemental whole-test-source TypeScript check still fails with **31 independently reproduced pre-existing errors**, not new accounting errors. Earlier intermittent bootstrap failures are retained below, not relabelled as passing.

### Checkout and environment

- Original baseline: `e5b33d9` (`docs(super-admin-config): mark workflow complete with blocks`). The checkout was clean on `main`, with no open PR for `main`, at initial inspection.
- Another actor created `e319871` from partial accounting work and staged further changes during implementation. The worker did **not** stage, unstage, commit, push, switch branches, or revert. That commit and staging state were preserved. The user explicitly authorized continuation in this checkout after declining a worktree.
- Final evidence covers `e319871` **plus the actual working-tree continuation**, not the commit alone. Unrelated concurrent frontend CSS/voice work was preserved untouched; frontend checks were run against the actual checkout, not an accounting-only substitute.
- Windows; Node **v24.18.0**. Installed MongoDB driver **6.21.0**, LangGraph **1.4.19**, MongoDB saver **1.4.1**, Zod **3.25.76**, Vitest **4.1.11**, TypeScript **6.0.3**. No dependency/lockfile change.
- `AURVIN_TEST_MONGODB_URI` / required isolated prefix prerequisites: **unavailable**, checked without printing values. No application/native database connection, provider spending, migration or external provisioning was used for verification. Existing owned network-disabled bootstrap children and Windows guard fixtures are routine offline tests.

## Exact changed paths

These are the accounting-task changes relative to `e5b33d9`, including changes already in `e319871`, continuation, and new artifacts. Unrelated frontend changes are **not** worker implementation paths.

### Production source

1. `backend/src/chat-runtime/finalization.ts` — optional observation after required durable publication.
2. `backend/src/contracts/accounting-reporting.ts` — bounded range/report types and ceilings.
3. `backend/src/contracts/metadata.ts` — optional money/timing/breakdowns; finite compatibility cost.
4. `backend/src/contracts/repositories.ts` — separate internal read-only reporting port.
5. `backend/src/contracts/usage-evidence.ts` — canonical decimal/provenance/pricing/timing rules and exact character estimates.
6. `backend/src/contracts/voice-accounting.ts` — optional evidence without invented actual charges.
7. `backend/src/model/accounting.ts` — absolute response/generation normalization and replay-safe financial observations.
8. `backend/src/model/openrouter-adapter.ts` — dispatch count and monotonic/UTC observations; protocol/retry policy retained.
9. `backend/src/operations/accounting-migration.ts` — dry-run-first, quiescent-owner, revision-safe enrichment pages.
10. `backend/src/persistence/accounting-codec.ts` — narrowly scoped monetary BSON/domain mapping.
11. `backend/src/persistence/accounting-reporting.ts` — bounded native read aggregation, legacy fallback, scoped cursors.
12. `backend/src/persistence/indexes.ts` — two ordinary reporting indexes; existing indexes retained.
13. `backend/src/persistence/metadata.ts` — reporting/maintenance access and nonregressing evidence guards.
14. `backend/src/persistence/mutation-journal.ts` — only immutable validated accounting reads admitted; arbitrary aggregation still refused.
15. `backend/src/persistence/records.ts` — accounting codec before size checks and strict decode.
16. `backend/src/scripts/migrate-accounting.ts` — explicit-target operator command, static diagnostics, bounded pages and close.
17. `backend/src/voice/usage/voice-accounting.ts` — precise snapshotted TTS estimates, socket/response separation.

### Tests

18. `backend/test/compatibility/intersection.spec.ts`
19. `backend/test/model/accounting.spec.ts`
20. `backend/test/model/adapter.spec.ts`
21. `backend/test/model/usage-evidence.spec.ts`
22. `backend/test/operations/accounting-command.spec.ts`
23. `backend/test/operations/bootstrap.spec.ts` — value-free process-state diagnostics only; no timeout/behavior weakening.
24. `backend/test/persistence/accounting-evidence.spec.ts`
25. `backend/test/persistence/accounting-migration.spec.ts`
26. `backend/test/persistence/accounting-reporting.spec.ts`
27. `backend/test/persistence/accounting-reporting.native.e2e-spec.ts` — gated, unexecuted native evidence.
28. `backend/test/persistence/local-open.spec.ts`
29. `backend/test/persistence/mutation-journal.spec.ts`
30. `backend/test/runtime/accounting-completion.spec.ts`
31. `backend/test/voice/providers/accounting.spec.ts`

### Documentation

32. `README.md`
33. `docs/aurvin-phase-1/operations.md` — dated current accounting read exception, not changed historical drill results.
34. `docs/voice-modes/operations.md`
35. `docs/mongodb-usage-accounting/operations.md`
36. `docs/mongodb-usage-accounting/implementation-report.md`

Only coarse checkboxes were changed in the external approved document at `C:\Users\Peter\.config\openchamber\projects\path_RDovUGV0ZXIvQWxmcmVkIEFnZW50L0FsZnJlZA\plans\1791962947250-mongodb-usage-accounting-upgrade-custom-workflow.md`. Phase 1 MAW state/plans and historical verification were not advanced or rewritten.

## Schema/storage additions and examples

New optional text/voice object `money` has exactly:

`currency`, `reportedAmount`, `estimatedAmount`, `costStatus`, `source`, `observedAt`, `pricing`.

When nonnull, pricing has exactly `version`, `source`, `unit`, `units`, `unitSize`, `rateUsd`. Text additionally has optional nullable `cachedPromptTokens`, `cacheWriteTokens`, `reasoningOutputTokens`. Both contracts admit optional `timing` with `dispatchedAt`, `firstOutputAt`, `providerEndedAt`, `durableCompletedAt`, `providerDurationMs`, `firstOutputLatencyMs`, `dispatchCount`. Actual collection monetary paths `money.reportedAmount`, `money.estimatedAmount`, and `money.pricing.rateUsd` use **BSON Decimal128**; domain/graph representations use decimal strings. Other fields/types and stock checkpoint codecs are not replaced. No reporting-date sidecar or new schema-version default is introduced.

These examples are synthetic, not captured provider/user data.

### Legacy text, readable unchanged

```json
{
  "schemaVersion": 1, "kind": "accounting", "userId": "u1", "sessionId": "s1",
  "turnId": "t1", "attemptId": "a1", "generationId": "gen_fixture",
  "requestedModel": "fixture/model", "reportedModel": null, "reportedProvider": null,
  "promptTokens": null, "completionTokens": null, "cost": 0.1,
  "accountingStatus": "pending", "outcome": "interrupted",
  "startedAt": "2026-10-06T00:00:00.000Z", "endedAt": "2026-10-06T00:00:01.000Z"
}
```

Parsing/readback preserves that exact domain object without new keys. Opt-in conversion adds only monetary evidence (and advances storage revision), retaining the original numeric cost/timestamps/outcome:

```json
{
  "money": {
    "currency": "USD", "reportedAmount": "0.1", "estimatedAmount": null,
    "costStatus": "known", "source": "legacy-number",
    "observedAt": "2026-10-14T08:00:00.000Z", "pricing": null
  }
}
```

This is known monetary evidence with unavailable tokens. Conversion observation is not an invented historical provider timestamp. Actual BSON stores `reportedAmount: Decimal128("0.1")`; Extended JSON renders it as `{"$numberDecimal":"0.1"}`. Numeric `cost: 0.1` is retained, not added as a second charge.

### New text evidence, JSON-safe saved result

An otherwise same-shaped new record with numeric `cost: 0.000000123456789` can carry:

```json
{
  "money": {
    "currency": "USD", "reportedAmount": "0.000000123456789", "estimatedAmount": null,
    "costStatus": "known", "source": "provider-response",
    "observedAt": "2026-10-14T08:00:00.120Z", "pricing": null
  },
  "cachedPromptTokens": 4, "cacheWriteTokens": 2, "reasoningOutputTokens": 3,
  "timing": {
    "dispatchedAt": "2026-10-14T08:00:00.000Z",
    "firstOutputAt": "2026-10-14T08:00:00.020Z",
    "providerEndedAt": "2026-10-14T08:00:00.120Z",
    "durableCompletedAt": "2026-10-14T08:00:00.160Z",
    "providerDurationMs": 120, "firstOutputLatencyMs": 20, "dispatchCount": 1
  }
}
```

The storage codec converts only monetary amounts/rate to Decimal128. LangGraph result validation/serialization keeps strings; HTTP streamed usage stays numeric. Optional absent counters do not become zero/default keys. First output remains null for empty/error-before-output streams; a later failure retains an already observed first output. Failed/cancelled/interrupted/truncated charges are still counted when reported.

### Legacy voice and new estimate

The deterministic legacy voice factory in `accounting-migration.spec.ts` is a complete strict-schema-valid before example: user `u1`, voice session `v1`, response `r1`, socket `socket`, usage `speech`, `status: completed`, `audioMs: 100`, `billableCharacters: 12`, numeric `estimatedCostUsd: 0.00018`, `actualCostUsd: null`, original start/end strings, and no new evidence. Its `userTag` is a valid fixture pseudonym (`aurvin-user-` plus 64 `a`s). Readback equals that legacy object.

A newly measured response retains the compatibility estimate and adds:

```json
{
  "actualCostUsd": null,
  "estimatedCostUsd": 0.00018,
  "money": {
    "currency": "USD", "reportedAmount": null, "estimatedAmount": "0.00018",
    "costStatus": "unknown", "source": "provider-estimate",
    "observedAt": "2026-10-14T08:00:01.000Z",
    "pricing": {
      "version": "voice-rate-snapshot-v1", "source": "operator-configured",
      "unit": "characters", "units": 12, "unitSize": 1000, "rateUsd": "0.015"
    }
  }
}
```

Stored estimate/rate are Decimal128; readback is the shown strings. Legacy migration instead uses `source: legacy-number`, `pricing: null`, because it cannot recover historical pricing. STT observed audio remains a separate socket unit, never an invented billed duration. TTS socket lifecycle rows contribute no duplicate response charge. Actual voice charges remain null.

## Reporting and maintenance handoff

Full definitions, exact templates, deployment order, ownership gates, backup-first and rollback prerequisites are in [operations.md](operations.md).

- Internal reads: `bundle.metadata.listAccounting({start,end,userId,limit,cursor})`, and `bundle.metadata.accountingTotals({start,end,userId?,byUser?,limit,cursor})` on the existing admitted bundle.
- Half-open UTC ranges, maximum **31 days**, page at most admitted `maxPageSize`/**50**, total input **10,000**; overflow fails rather than truncating spend. Native read-only Decimal128 aggregation, no message/checkpoint joins, bounded facet output and scalar request grouping.
- Distinct request/attempt/operation counts, lifecycle charges, token/dispatch completeness, and separate reported/estimated currency/unit subtotals. Unknown amounts return null; rejected dispatch billing is not assumed free. Legacy normalized timestamps/numeric-cost fallback explicitly include unmigrated records.
- Ordinary metadata indexes: `kind_user_accounting_range` = `{kind:1,userId:1,startedAt:1,_id:1}`; `kind_accounting_range_user` = `{kind:1,startedAt:1,userId:1}`. Existing indexes are retained; actual native explain results are unrun.
- `node dist/scripts/migrate-accounting.js --database "$TargetDb"` is dry run; apply additionally requires **`--apply --maintenance-confirmed`**, independent operator approval, quiescence and admitted ownership. Private explicit `AURVIN_ACCOUNTING_MONGODB_URI` is used, not application env fallback or a URI argument. No application `.env` is loaded.
- Pages **1–50**, batches **1–1,000 pages**; `--after-id "$NextCursor"` resumes bounded scans. Dry run has zero mutations. Apply only enriches accounting kinds with revision checks, preserving originals; controls/checkpoints are never transformed. Normal executor/index lifecycle still uses existing guard machinery.
- Mixed records remain readable/idempotent. Old strict readers reject enriched fields; old-code rollback is **not unconditional**. Guarded, backed-up metadata-only removal is documented for metadata-only enrichment. New graph writes require verified complete pre-upgrade restore or a separately approved serializer-aware conversion; no destructive cleanup tool or checkpoint rewrite is shipped.

## Actual checks

### Initial baseline, before accounting edits

| Directory / command | Actual result |
| --- | --- |
| Backend `npm run build` | PASS. |
| Backend `npm run lint` | Exit 0 with existing warnings, not warning-free. |
| Backend `npm test` | **FAIL**: 874 passed, 1 bootstrap timeout failed, 10 skipped; 113 passed files / 1 failed / 2 skipped. This aggregate run is not called passed. |
| Backend `npm test -- test/operations/bootstrap.spec.ts` | Subsequent focused PASS: 8 tests. This does not change the preceding aggregate failure. |
| Backend `npm run test:e2e` | **FAIL / prerequisite blocked**: 19 passed, 70 failed at isolated-native configuration checks, 37 skipped. No native connection/data operations occurred. The ungated native cases were not evidence of tested MongoDB behavior; final runs explicitly exclude them. |
| Frontend `npm run build`, `npm run lint`, `npm test` | Build PASS; lint exit 0 with warnings; tests PASS 47 files / 317 tests. |

### Final checkout checks (14 October 2026)

| Directory / command | Actual result |
| --- | --- |
| Backend `npm run build` | PASS; `nest build`. The full unit suite also builds the real release for the bootstrap fixtures. |
| Backend `npm run lint` | PASS exit 0; **274 warning lines** remain. Existing categories include type-aware unbound methods, stringification, control-regex and fixture warnings. Not claimed warning-free. |
| Backend `npm test` | **PASS** at terminal-reported 14:35:38: **120 passed files, 2 skipped; 923 passed tests, 10 skipped**, zero failures. Earlier failing aggregate runs remain separately recorded below. |
| Backend `npm run test:e2e -- --exclude "**/*.native.e2e-spec.ts"` | PASS: **4 files / 19 deterministic tests**, zero failures. This is not an unfiltered native e2e pass. |
| Backend `npm run test:e2e -- test/persistence/accounting-reporting.native.e2e-spec.ts` | **SKIPPED**: 1 file / 3 tests, zero executed tests. No passing native assertion is claimed. |
| Backend `node dist/scripts/migrate-accounting.js --help` | PASS, static usage text only; no database connection/migration. |
| Original `e5b33d9` archived backend `npm run build`, then direct compiled old-schema assertions | PASS: actual old text/voice readers accept complete legacy records and reject the same records with valid additive monetary evidence. No database/provider access. |
| Document/source consistency and scoped `git diff --check e5b33d9` | PASS: all **36** reported task paths exist, all **31** code files have required headers, local links in five affected documents resolve, all six approved coarse steps are ticked, and the scoped tracked diff has no whitespace errors. |
| Frontend `npm run build` | PASS; TypeScript/Vite build against current checkout. |
| Frontend `npm run lint` | PASS exit 0 with **24 warning lines** (refs/immutability/fast-refresh/test patterns); unrelated work left intact. |
| Frontend `npm test` | PASS: **47 files / 319 tests**, zero failures; includes concurrent user frontend edits, not just the original baseline. |
| Backend supplemental `npx tsc --noEmit --incremental false -p tsconfig.json` | **FAIL exit 2: 31 errors** in existing test/fixture typing and ES2024-lib assumptions. Same command on a fresh `git archive e5b33d9 backend` copy using the same installed dependencies also fails exit 2 with **31**. Normalized `(relative file, TS diagnostic code)` multisets have **zero differences**. No new accounting file/typecheck diagnostic remains. Required production build succeeds. |

Supplemental comparison output is in approved local temporary files `C:\Users\Peter\AppData\Local\Temp\opencode\accounting-prechange-typecheck.log` and `accounting-final-typecheck.log`. The original archive reference was explicitly `e5b33d9`, not the partial accounting commit. Existing failures include admin-config `.mock` fixture typing, `Promise.withResolvers` under ES2023, mock store/result types, older native harness/config signatures, deliberate invalid-object fixtures, and existing cursor/provider test properties. They were not fixed by unrelated scope expansion.

### Failing-then-passing accounting evidence

Focused runs watched missing/rejected optional contracts, Decimal128 storage, immutable evidence regression, timing observations, CLI availability/gates, reporting methods, cost-only reconciliation timestamp drift and cache masking fail before their corresponding implementation/fix. The shared accounting paths were fixed, not parallel endpoint writers.

Representative actual commands and outcomes:

- `npm test -- test/model/usage-evidence.spec.ts`: initial **5 failed / 11 passed**; later UTC/pricing/generation-counter regressions also failed before fixes. Final coverage is included in the passing aggregate.
- `npm test -- test/persistence/accounting-evidence.spec.ts`: initial **3 failed** (missing BSON conversion/nonregression). Voice monetary-rate storage subsequently failed before its codec fix. Final aggregate passes.
- `npm test -- test/model/adapter.spec.ts test/voice/providers/accounting.spec.ts`: initial new timing/voice evidence checks **3 failed / 47 passed**; corresponding focused green run passed.
- `npm test -- test/persistence/accounting-reporting.spec.ts`: missing methods initially failed; exact legacy sum, bounds, scope and voice separation now pass. Rejection billing completeness failed before the explicit unknown-dispatch indicator.
- `npm test -- test/persistence/accounting-migration.spec.ts`: initial **3 failed / 1 passed**; green conversion/revision/dry-run tests, plus legacy voice conversion, are included in the final aggregate.
- `npm test -- test/operations/accounting-command.spec.ts`: an initial import-resolution setup failure was corrected to a real **3-test assertion failure** for the absent command before implementation; green gated CLI tests passed. Empty discovery/import failure is not treated as verification.
- `npm test -- test/runtime/accounting-completion.spec.ts`: initial **3 failed**; final tests include genuinely unfinished sealed-result runtime recovery, not only terminal replay.
- `npm test -- test/model/accounting.spec.ts`: new cost-only observation/cached-conflict cases **2 failed / 18 passed** before the shared fix; all **20** later passed in the aggregate.
- `npm test -- test/runtime/accounting-completion.spec.ts test/model/adapter.spec.ts test/persistence/accounting-migration.spec.ts`: **PASS 3 files / 49 tests** after the stronger legacy recovery, empty/multiple delta and voice migration evidence was added.
- The additional BSON fractional-cent reporting/breakdown case exposed scientific-notation handling in the **offline test interpreter**, not a demonstrated MongoDB failure: **1 failed / 6 passed**, then **7 passed** after normalizing BSON decimal formatting before exact fixture arithmetic. Native verification remains skipped; the final aggregate includes this case.

### Intermittent bootstrap investigation

The pre-edit baseline already timed out in the existing owned network-disabled bootstrap fixture. Later aggregate runs also had missing-counter/10-second-bound failures; for example, the 13:59:27 run had **3 failed / 916 passed / 10 skipped**, so it is not labelled passed. Focused bootstrap reruns passed 8/8, and subsequent full aggregates passed (919 and 922 executed tests before the last added case; **923** in the final run).

Investigation read the actual compiled-entry preload, build lifecycle, child IPC/stdout/exit handling, 10-second deadline and all build callers; external build/check activity was kept separate from full-suite runs. Diagnostics now report only exit code/signal, byte counts and static module-load/startup/fatal-runtime flags if fixture counters are absent, never exception text or fixture credentials. No timeout was increased and no assertion/production startup safeguard was removed. Heavy parallel resource contention is a hypothesis, **not a conclusively established root cause**. There is no honest claim that an intermittent environmental/transport fixture problem has been eliminated; the final whole suite did execute and pass, independently of focused reruns.

## Acceptance and compatibility evidence

| Required case | Executed evidence / limitation |
| --- | --- |
| Legacy text/voice equality/readback | Contract, BSON/store and existing voice metadata fixtures pass without optional defaults. Legacy voice readback equals its original object. |
| Decimal `0.1 + 0.2 = 0.3`, fractional cents, zero/null, invalid/conflicting values | Real BSON encode/decode and offline reporting-pipeline interpreter pass; dedicated **real native sum fixture is skipped**, not certified by the interpreter. |
| Known money / unknown tokens | Cost-only response/reconciliation and reporting tests retain known amount with incomplete token indicators. |
| Absolute snapshots, duplicates, finalization | One scoped identity, immutable monetary guard, duplicate-frame checks, repeated reconciliation and repeated runtime/publication replay pass. |
| One request / two charged attempts | Reporting fixture returns one request, two attempts and `0.3`, retaining failed/cancelled charges. |
| Interrupted/cancelled/truncated charges | Provider/runtime/reporting fixtures retain available costs and explicit outcomes; missing money stays unavailable. |
| Cached/reasoning breakdowns | Response and native-generation normalization retain optional detail without parent-token double counting; malformed values stay unavailable. |
| Timing/dispatch/recovery | Empty/error-before-output streams have no first-output timestamp; multiple deltas measure once; definitive rejection adds dispatch count without changing retry rules; recovered missing elapsed values remain null. |
| Voice estimates/units | Exact character-rate estimate and Decimal128 monetary/rate roundtrip; separate socket/response IDs; no invented actual charge or duplicate TTS socket cost. |
| Reporting isolation/ranges/control exclusion | User/UTC `[start,end)`/same-time pagination/invalid-range/cap tests pass; frozen pipeline refuses arbitrary/write/other-collection escape; no payload joins. |
| Maintenance dry run/repeat/conflict/original retention | Offline conditional-store/CLI tests pass, including legacy voice with null pricing. Native checkpoint-byte/control-preservation fixture is prepared but **skipped**. |
| Existing chat/voice/context/concurrency/recovery/ownership | All executed routine tests and 19 deterministic e2e pass. Actual native saver/recovery, backup/restore and rollback drills remain **unverified** without isolated prerequisites. |

The stronger saved-result test interrupts real runtime publication after the graph has sealed and the attempt is still `finalizing`, converts only the in-memory fixture artifact to the historical optional-field-free shape, then calls real runtime `reconcileSession` twice. It confirms one provider fixture POST total, one accepted user message, one assistant, completed durable attempt, and null uncollected dispatch/provider elapsed values. A separate publication test checks repeated legacy JSON saved-result finalization; new saved monetary values are asserted to be strings. Optional completion-write failure leaves terminal success intact and emits only the static bounded warning. These prove deterministic compatibility of domain/saved-result paths, **not** native service durability or old-release rollback.

Old strict schema acceptance/additive rejection is explicitly tested for complete legacy text and voice records. It was also independently checked against the **actual compiled original `e5b33d9` schemas** from the isolated archive: `legacyTextAccepted`, `legacyVoiceAccepted`, `enrichedTextRejected`, and `enrichedVoiceRejected` were all true. Thus rollback instructions do not claim that schema version one or retained numeric fields alone make old builds compatible with new saved graph evidence.

## Remaining limitations and gates

- **Native verification blocked by prerequisites:** no actual database aggregation/query plans, native saver/pending-write recovery, service capability/topology certification, live backup/restore or rollback drill was run. All native e2e files remain unexecuted/excluded except explicit skipped discovery of the new three-test fixture. No latency/index-scan/production-performance number is fabricated.
- **Supplemental typecheck remains failed:** 31 independently established pre-existing test-source errors. Required production/package checks are separately reported, not conflated with that failure.
- **Bootstrap intermittency remains diagnosable, not proven solved:** final aggregates pass; earlier failures and uncertainty remain visible.
- Decimal128 has 34-digit arithmetic bounds and conversion cannot restore upstream/legacy precision. Native legacy numeric string conversion has native formatting precision limits. Reports are bounded live reads/observed subtotals, not invoice matching or cross-page snapshots.
- Timing records local observations including rejection/backoff/consumer overhead, not pure provider-server latency. Historical missing measurements remain unavailable. Missing/rejected HTTP billing and actual voice invoice charges are not assumed zero.
- Legacy TTS socket classification covers the three admitted models; admitting more models requires a versioned unit discriminator first. No speculative provider/rollup architecture is built.
- Public authentication/authorization, Azure admission, production rollout, and paid/provider/staging checks remain separate unresolved gates. Maintenance and rollback require separate operator authority, backups and ownership proof.

No mandatory implementation requirement was silently dropped. These are explicit verification/operational limitations, not implementation approval for live use.

## Documentation consulted

Current Context7 MongoDB driver Decimal128/aggregation documentation and current OpenRouter response usage/native generation schema were consulted, along with installed-version APIs. Sources include [MongoDB monetary data](https://www.mongodb.com/docs/manual/tutorial/model-monetary-data/), [compound indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/), [OpenRouter accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), and [generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation). Only documented cached/reasoning generation fields were added; provider-reported billed cost remains authoritative.
