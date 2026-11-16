# Latency Reduction Verification Evidence

**Implementation-start HEAD:** `654935dcc30d20ae978fd4b0591a22472db2af5b`  
**Tracked binary diff at start hash:** `7cca0ab4d36f9f6a2dc3e7e9ac1f47f8598f6509` (via `git hash-object --stdin`)  
**Current HEAD:** `5ec145e`  
**Runtime Environment:** Node v24.18.0 on Windows; MongoDB driver 6.21.0, LangGraph 1.4.19, MongoDB saver 1.4.1.  
**Gates:** D1 approved; D2–D8 gated (D2 identity barrier implemented; D3 plain text pricing verified; D4/D5/D6/D7/D8 gated).  
**Unified Review:** **SKIPPED** (per user instruction `--skip review`, never claimed passed).  

---

## 1. Incremental Verification by Task

### Tasks 0 through 6 (Commit `35eb6e8`)
- **Task 0 & 1:** Database command observer with bounded 128 command history, sanitized allowlists, ALS store separation, phase attribution (`admission`, `attachment`, `context`, `model-observation`, `tool-evidence`, `seal`, `publication`, `release`, `recovery`), and `onOrigin` bracketed ownership commands.
- **Task 2:** `DependencyProbe` dependency-wave and timer models; `calendar-multi-memory.ts` collection-separated in-memory database simulation with projection, aggregation, BSON Decimal128 round-trip, CAS mismatch injection, and independent event emission.
- **Task 3:** Atomic CAS receipts, BSON envelope cloning to preserve Decimal128 prototypes, and bounded dispatch verification (≤8 dispatches) for financial settlement.
- **Task 4:** Short owned phases via `MongoOwnership.runPhase`, `AsyncLocalStorage` phase tokens, control lane serialization blocking handoff during active writes, and bounded `Promise.allSettled` draining.
- **Task 5:** Shared durable admission write phases: concurrent attempt insertion and input append under `acceptance-stage`, receipt verification and `latestTurnId` update under `acceptance-publish`, and generation-incremented lease detachment.
- **Task 6:** Disposable `AdmissionReceiptStore` (128 entries, ≤2 MiB per entry, ≤16 MiB total, 60s TTL, LRU eviction); fast stream attachment via `attachAccepted` consuming receipts to eliminate duplicate initial reads.

### Task 7 — Publication & Finalization Optimization (Commits `e619eec`, `79f0f7d`, `54f31df`)
- Added live-only `LivePublicationEvidence` parameter to `publishResult` (`acceptedInput`, `acceptance`, `baseManifest`, `sourceRecords`, `confirmedSnapshot`, `attemptReceipt`, `accountingReceipt`, `onAttemptConfirmed`). Recovery paths omit it and retain strict `checkedResult`.
- Implemented `transitionConfirmed` (receipt-scoped CAS via `compareAttemptConfirmed`) and `advanceAttempt` carrying the confirmed receipt from `generating -> finalizing -> completed/terminal`.
- Eliminated redundant manifest/message/graph reads in the live publication path; staged provisional assistant append and authoritative accounting in parallel under `publication-stage`.
- `MongoOwnership.finishAttempt` folded activity touch, attempt slot clearing, and lease release into one atomic session CAS with `$max` activity timestamps and generation-checked readbacks.
- Extended `CalendarTurnPublication` with optional `liveEvidence` and `beforeTerminal` callback, passing terminal receipts and avoiding duplicate storage releases.
- Removed redundant awaited `putAccounting(...durableCompletedAt...)` mutation from `publishResult`, routing completion timing through bounded telemetry after durability.

### Task 8 — Supervised Bounded Observation Writer (Commit `2708626`)
- Implemented `createObservationWriter<T>` in `backend/src/model/observation-writer.ts` with a finite queue: 1 in-flight write + at most 1 coalesced latest snapshot.
- Enforced synchronous identity barrier (Gate D2): `generationId` and `callId` are durably acknowledged before any streamed delta is emitted to the client.
- Latched persistence errors to abort provider fetches and reject subsequent work; drain-to-fixed-point on `close()` supervised by `Work.track`.
- Extended `CalendarTurnLedger` and `CalendarDispatchHooks` with `enqueueObservation`, `flushObservations`, and `checkObservations`.
- Tests: `test/model/observation-writer.spec.ts` (8 passed), `test/model/adapter.spec.ts`, `test/model/calendar-adapter.spec.ts`, `test/model/accounting.spec.ts`, `test/runtime/calendar-budget.spec.ts`, `test/runtime/work.spec.ts`, `test/runtime/stream-quiescence.spec.ts`, `test/performance/durable-latency.spec.ts`.

### Task 9 — Stock-Saver Bounded Read Facade & Prepare State Passing (Commit `5ec145e`)
- Implemented `createBoundedSaverClient` in `backend/src/persistence/checkpoints.ts` wrapping cursors with chained proxy preservation (`sort`, `limit`, `project` returning the proxy receiver), enforcing `.limit(81)` on pending cursors and pre-decode binary budget checks before `serde.loadsTyped`.
- Exported `PrepareState` (`boundary`, `calendarCursor`, `calendarSeal`) in `backend/src/agent/turn-graph.ts` and passed restored state directly into `hooks.prepare(input, restoredState)`, eliminating redundant `graph.getState(...)` reads inside the node.
- Preserved strict fallback when `enableReadFacade` is false (Gate D5 activation remains gated pending native replica set environment).
- Tests: `test/persistence/checkpoints-bounded.spec.ts` (8 passed), `test/persistence/calendar-checkpoints.spec.ts`, `test/runtime/graph.spec.ts`, `test/runtime/calendar-graph.spec.ts`, `test/performance/durable-latency.spec.ts`.

### Task 11 — Placement Investigation & Comparative Analysis
- Created `docs/latency-reduction/placement-decision.md` providing an on-paper comparative analysis of deployment topologies (Cloud-Colocated Backend Executor vs PC-Bound Local Replica Set vs Status Quo Remote WAN DB).
- Evaluated physical WAN RTT and write quorum propagation delay (`w: "majority"`); demonstrated that colocation reduces database turn latency from ~28s to ~1.4s.
- Formally preserved Gates D6 and D7: no cloud infrastructure was modified or provisioned; external/paid benchmarks remain unrun.

---

## 2. Whole-System Verification Matrix (Task 10)

### Benchmark Comparison: Baseline (Pre-Reduction) vs Final (Post-Reduction)

Measured across modeled dependency-wave profiles (`67/449ms` network latency: 67 ms read / 449 ms majority write):

| Scenario | Baseline Wire Ops (`R/W`) | Final Wire Ops (`R/W`) | Baseline Waves | Final Waves | Baseline Elapsed (ms) | Final Elapsed (ms) | Net Wave Reduction | Net Time Reduction (ms) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `new-text` | `170R/46W` | `142R/46W` | 216 | **180** | 32,044 | **29,632** | **-36 waves** | **-2,412 ms** |
| `follow-up-1` | `170R/42W` | `141R/42W` | 212 | **176** | 30,248 | **27,836** | **-36 waves** | **-2,412 ms** |
| `follow-up-20` | `170R/42W` | `141R/42W` | 212 | **176** | 30,248 | **27,836** | **-36 waves** | **-2,412 ms** |
| `follow-up-38-at-80-msg-ceiling` | `172R/42W` | `143R/42W` | 214 | **178** | 30,382 | **27,970** | **-36 waves** | **-2,412 ms** |
| `follow-up-39` | `172R/42W` | `143R/42W` | 214 | **178** | 30,382 | **27,970** | **-36 waves** | **-2,412 ms** |
| `follow-up-50-test-budget` | `174R/42W` | `145R/42W` | 216 | **179** | 30,516 | **28,037** | **-37 waves** | **-2,479 ms** |
| `calendar-text` | `167R/44W` | `141R/43W` | 211 | **177** | 30,945 | **28,285** | **-34 waves** | **-2,660 ms** |
| `calendar-read` | `228R/61W` | `195R/60W` | 289 | **248** | 42,665 | **39,536** | **-41 waves** | **-3,129 ms** |
| `calendar-create` | `275R/69W` | `241R/68W` | 344 | **302** | 49,406 | **46,210** | **-42 waves** | **-3,196 ms** |
| `calendar-conflict` | `205R/52W` | `178R/51W` | 257 | **222** | 37,083 | **34,356** | **-35 waves** | **-2,727 ms** |
| `calendar-proposal-reply` | `239R/56W` | `212R/55W` | 295 | **261** | 41,157 | **38,497** | **-34 waves** | **-2,660 ms** |
| `rejection-retry` | `166R/41W` | `140R/41W` | 207 | **176** | 29,531 | **27,454** | **-31 waves** | **-2,077 ms** |
| `cancel-before-dispatch` | `76R/21W` | `71R/21W` | 97 | **86** | 14,521 | **13,784** | **-11 waves** | **-737 ms** |
| `cancel-midstream` | `140R/35W` | `131R/36W` | 175 | **159** | 25,095 | **24,405** | **-16 waves** | **-690 ms** |
| `reconnect-finalization-recovery` | `75R/14W` | `67R/12W` | 89 | **77** | 11,311 | **9,743** | **-12 waves** | **-1,568 ms** |

*Note: In the unbatched initial prototype, `new-text` required 227 waves and ~38.6s. Cumulative optimization achieved a total reduction of **47 waves and ~9.0 seconds**.*

---

## 3. Full Test Suite Execution Results

All full application suites were executed sequentially and passed with zero errors:

| Suite / Command | Directory | Tests Result | Files Result | Exit Code | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `npm run build` | `backend` | — | — | **0** | Clean NestJS build; dist emitted |
| `npm run lint` | `backend` | — | 562 files | **0** | 0 errors, 514 warnings |
| `npm test -- --maxWorkers=1` | `backend` | **2,145 passed**, 10 skipped, 0 failed | **258 passed**, 2 skipped (260) | **0** | Comprehensive unit & integration suite |
| `npm run test:e2e` | `backend` | **22 passed**, 129 skipped native, 0 failed | **4 passed**, 40 skipped native (44) | **0** | Diagnostic & mock e2e passed |
| `npm run build` | `frontend` | — | 86 modules | **0** | Clean Vite production build |
| `npm run lint` | `frontend` | — | — | **0** | 0 errors, 46 warnings |
| `npm test` | `frontend` | **495 passed**, 0 failed | **68 passed** (68) | **0** | Full frontend Vitest suite |

---

## 4. Truthful Reporting on Native Database Certification (Task 10.3 / Gate D4)

`AURVIN_TEST_MONGODB_URI` was **unset** in the execution environment. Per the project rules and plan specifications:
- **Native Certification Status:** **BLOCKED / 0 native tests executed**.
- No native MongoDB replica set certification or cloud service compatibility (T10.3–10.6) is claimed.
- Gate D5 saver-facade default activation remains gated pending an isolated replica set test run.
- All verification evidence presented in this document is derived strictly from deterministic offline fixtures (`calendar-multi-memory.ts`, `DependencyProbe`, and isolated synthetic mocks).

---

## 5. Implementation Diff and Commit Audit

| Commit | Summary | Tasks Addressed |
| :--- | :--- | :--- |
| `35eb6e8` | `feat(perf): implement latency reduction phases 0-6 and performance optimizations` | Tasks 0, 1, 2, 3, 4, 5, 6 |
| `e619eec` | `feat(perf): pipeline finalization publication, add latency benchmarks, and optimize live runtime` | Task 7 (Part 1) |
| `79f0f7d` | `docs(latency): record Task 7 publication and finalization evidence` | Task 7 (Documentation) |
| `54f31df` | `feat(perf): carry confirmed receipts through Calendar publication and release` | Task 7 (Part 2) |
| `2708626` | `feat(perf): add supervised bounded observation writer for streaming updates` | Task 8 |
| `5ec145e` | `feat(perf): stock-saver bounded read facade and prepare state passing` | Task 9 |

---

## 6. Final Status of Gates

- **Gate D1 (Performance Initiative Scope):** **APPROVED**.
- **Gate D2 (Synchronous Identity Barrier):** **IMPLEMENTED & VERIFIED** (generation ID confirmed before stream output).
- **Gate D3 (Plain-Text Pricing & Budgets):** **VERIFIED** (preserves token/retry bounds without fictional USD caps).
- **Gate D4 (Native Storage Testing):** **GATED / BLOCKED** (operator test URI unset; 0 native tests run).
- **Gate D5 (Stock Saver Read Facade Default Activation):** **GATED** (conformance verified offline; production activation gated pending D4).
- **Gate D6 (Infrastructure Placement Changes):** **GATED** (on-paper analysis completed in `docs/latency-reduction/placement-decision.md`; no live changes).
- **Gate D7 (External/Paid Benchmarks):** **GATED** (unrun; zero external charges incurred).
- **Gate D8 (Stored Schemas & Graph Node Topology):** **PRESERVED** (all 6 collection roles and graph topology unchanged).
- **Unified Review:** **SKIPPED** (per user instruction `--skip review`, recorded as skipped, never passed).
