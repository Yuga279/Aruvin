# P2 Persistence Evidence

## Commit set and environment
- Worker commit range starts at `c78d935` (`feat(p2): add bounded scoped persistence record codec`) and includes the following serialized P2 commits on `main`. P1 prerequisite remains `d899e93..db763b6`.
- Node `v24.18.0`, npm `12.0.1`, OS Windows (`win32`).
- Locked versions: `mongodb@6.21.0`, `@langchain/langgraph-checkpoint-mongodb@1.4.1`.
- Isolated native topology: existing local MongoDB listener; tests used `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_` and generated per-run databases that the harness dropped. URI is not recorded here.

## Executed checks
| Command | Target | Outcome | Assertions / measurements |
| --- | --- | --- | --- |
| `npx vitest run test/persistence/records.spec.ts test/persistence/pagination.spec.ts test/compatibility/intersection.spec.ts` | Deterministic P2 specs | **PASS** 9/9 | hashed identities, BSON bounds, cursors, 8 non-unique indexes, driver pins, rejected incompatible partitions |
| `npm test` | Deterministic backend specs | **P2 PASS**; suite **FAIL** on out-of-ownership `test/context/tool-protocol.spec.ts` missing `tool-protocol.fixture.js` | 193 tests passed across 30 files; 1 P3 suite failed; P2 files were not the failure |
| `npm run test:e2e -- test/persistence/archive.native.e2e-spec.ts` | Isolated native DB | **PASS** 5/5 | restart/isolation/order/dedup/CAS, accepted session list, transcript pages, manifests, tied pagination |
| `npm run test:e2e -- test/persistence/ownership.native.e2e-spec.ts` | Isolated native DB | **PASS** 5/5 | single executor, no expiry steal, reservation replay, acceptance, stopped handoff, lease renew |
| `npm run test:e2e -- test/persistence/checkpoints.native.e2e-spec.ts` | Isolated native DB | **PASS** 1/1 | setup/put/pending-write/restart/scope/bounds, setup-error facade |
| `npm run test:e2e -- test/persistence/faults.native.e2e-spec.ts` | Isolated native DB | **PASS** 4/4 | lost-ack upsert/replace reread, pre-write retry, CAS race, bundle ping |
| `npm run build` | backend TypeScript | **PASS** | `dist/persistence/index.js` emitted |
| `npm run lint` | backend src/test | **PASS** for P2 paths | no persistence/compatibility findings; unrelated P3/P4 warnings remain with those owners |
| `npm run test:azure` | no facts/target | **FAIL / blocked** | `Selected-service facts are required; Azure is not certified.` |

## Bounded storage
- Configured limits: document 1,800,000 bytes, message 65,536, manifest 131,072, plus a 256-byte BSON safety reserve. P1 schema maxima still apply.
- Deterministic codec test: a fixture message document measured under 65,536 BSON bytes including envelope/reserve; 24,000 CJK characters exceeded the message budget by UTF-8 BSON size, not JS string length.
- Checkpoint state and pending writes are bounded to 80 writes and the same 1,800,000-byte combined envelope. Native saver test rejected an ~1.8MB channel payload with `STORAGE_BUDGET_EXCEEDED`.
- No TTL indexes or transcript/ID arrays in session documents. Native index inspection confirmed stock saver indexes are non-unique and have no `expireAfterSeconds`.
- Collection-wide maximum BSON bytes on Azure were not measured; actual-service tests remain blocked.

## Supported executor and recovery policy
- One admitted durable executor sentinel; session lease expiry stops writes and does not authorize takeover. Native tests proved a second claim fails with `UNSUPPORTED_TOPOLOGY` and an expired lease cannot be reacquired until `release`.
- Operator stopped-process proof is required for `handoffStoppedExecutor` / `recoverStoppedSession`. Native tests required explicit handoff; elapsed time alone did not transfer a live executor.
- Ambiguous write/repeated primitive recovery is implemented via reread after upsert/CAS. Native fault tests confirmed lost acknowledgments after durable writes, one winner for racing replacements, and retry after pre-write failure. P5 graph finalization remains downstream.

## Actual-service compatibility gate
- Service/API/tier/partition/flags/consistency/backup facts: **missing**. R1 did not identify the actual Azure product.
- Azure test outcome: **blocked**. `npm run test:azure` failed closed on missing `AURVIN_AZURE_TEST_FACTS_JSON` with a sanitized message. This is not an implementation regression and is not an Azure pass.
- Native/intersection results do not certify Azure; AC16 and full P2 exit remain open.

## Handoff and limitations
- P5 primitives: `graphThreadId`; `owner.claimExecutor/assertExecutor/acquire/fence/renew/run/release`; `reserveAttempt`, `allocateSequences`, `confirmAcceptance`, `clearAttempt`, `recoverStoppedSession`; `metadata.compareAttempt`, `getAcceptance/getAccounting/listAttempts`; `sessions.listForRecovery`; `messages.getReferences`; monotonic `memory.put`; `checkpoints.create().bind(lease)` with root namespace and bounded standard saver reads/writes. Keep application writes inside separate guarded `run` calls; never wrap graph/inference or nest guarded calls.
- P8 hooks: bundle `ping`, owner `drain`/`releaseExecutor`, explicit `handoffStoppedExecutor` after proven process stop. `openPersistence` is native-only until R1/P1 activation follow-up; no paid health calls.
- Unified review skipped. No provider billing guarantee, deployment authorization, compaction, or live tools.
- Do not mark runtime/AC12/AC16 complete from these primitives or native tests alone.
