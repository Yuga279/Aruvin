# Task 2 — shared memory-first foundation

7 November 2026. Implemented as an **unwired foundation**, against source `89e0d4ee94c14f92d383efd1e114a1b8b57463c9`, Node `v24.19.0`, Windows PowerShell, installed Vitest `4.1.11`. No staging or commits. [Task 1 contract](memory-first-task-1-contract.md) and [baseline](memory-first-task-1-baseline.md) remain unchanged.

Only new files:

- [Foundation](../../backend/src/chat-runtime/memory-first-foundation.ts).
- [Offline checks](../../backend/test/performance/memory-first-foundation.spec.ts).
- This evidence/handoff document.

Current runtime, HTTP/UI, voice delivery/proof producers, Calendar effects, repositories, database ownership and shutdown composition remain unchanged. Existing warm production paths still perform database work. No latency or database-work reduction in those paths is claimed. No skills, agents, installs, live providers, native database/service suites, Azure checks, provisioning, deployment or spool were used. Unified review remains skipped.

## Implemented contracts

All exports are in the foundation file; no new wire schema or fake `ConfirmedRecord` is introduced.

| Export | Contract |
| --- | --- |
| `MemoryFirstPolicy` | Required validated count/encoded-byte, concurrency, retry, age, retention and drain limits. No constructor defaults. |
| `MemoryAcceptance` | Server-internal input, request key, text/live mode, pinned config/assets revision, Calendar reply reference, optional expected process epoch, and live voice/socket/provider-turn identity. No client user identity. |
| `MemoryTurn` | Frozen process-owned handle; existing scoped ID recipes, payload hash, message/event IDs, ordered sequence, context version and authority fence. Copies cannot complete the original turn. |
| `MemoryTerminal` | Terminal generated text/status plus optional existing-schema accounting and terminal voice evidence. |
| `TerminalEnvelope` | Deep-frozen, schema-versioned absolute terminal data; input/output, original request/config, accounting, separate delivery, previous/current version, epoch and fence. No callbacks, live leases, effects or persistence receipts. |
| `SaveTerminal` | Injected **save-only** adapter, receiving an envelope and operation/byte ceilings. It must reconcile deterministic IDs/payloads and versions before retry/publication. |
| `SaveOutcome` | Complete qualified `saved` acknowledgement, or explicit `failed` / `partial` / `unknown` with retryability. Partial success never advances the watermark. |
| `SaveState` | Pending/saving/saved/failed/unknown/fenced, independent of the generation outcome. |
| `MemoryFirstFoundation` | One state/writer owner shared by both modes, not a second generation runtime. |

`accept` synchronously reserves one session slot and worst-case terminal capacity before returning a handle. Same-key/same-payload calls return that identical handle, including after completion; mismatched content, mode, Calendar reference or voice identity conflicts. The original configuration stays pinned. A supplied previous process epoch is rejected as unknown after restart. A new session is created only by acceptance, not by an empty-chat action.

`complete` validates and freezes terminal public records and linked evidence, publishes the next memory version, releases the local slot, and schedules storage independently. `result`, `saveState`, `session` and `snapshot` expose separate facts. `context` returns ordered original message records and a versioned manifest for the **existing** context assembler. `deliveries` supplies its metadata read port from memory. The acceptance check promotes an unsaved first answer, accepts the next turn with storage unresolved, and assembles previous user + answer + new input exactly once without a database read.

Voice generated text and terminal heard evidence remain different fields. Live completion requires settled delivery, including explicit unknown delivery, before slot release. The existing assembler projects only spoken text or its existing unknown-hearing marker. This foundation does not implement playback proof, in-progress speech accumulation, media interruption or synthesis; existing `VoiceDelivery` owns those until Task 4 integration. No generated text is fabricated as hearing evidence.

The internal writer retains every distinct envelope, preserves session order, and permits independent sessions up to the global save cap. There is no envelope coalescing or lifecycle-write replay. Failure blocks that session's durable prefix, retains dirty data, and leaves generated success intact. Retry uses the same frozen object, fixed finite backoff and a cumulative attempt cap shared by automatic/explicit `retrySave`. An adapter exception is unknown/nonretryable unless the adapter provides a classified outcome. Visible write timeout retains the raw promise, session order and concurrency slot; no overlapping retry starts. Late acknowledgements advance only the matching epoch/session/version/fence and contiguous prefix.

`fence` rejects new work/completions, prevents undispatched stale saves, and ignores stale in-flight acknowledgements. It is a **local fence contract**, not a durable archive/redaction implementation. Already-dispatched operations require storage-side conditional versions/tombstones. Fenced envelopes remain retained; `drain` cannot report them saved. `evictClean` is explicit, refuses dirty/active/fenced state, and preserves completed-request evidence for the retention floor. There is no dirty TTL eviction or silent fallback to old storage state.

`stopAdmission` allows existing producers to finish. `drain` stops admission and waits for all accepted reservations, queued envelopes and raw writes within the configured deadline. Its deadline is timer-based even if the injected state clock stalls. An incomplete drain returns pending/unresolved/active counts and `drained: false`. It never cancels a database command, closes persistence, releases an executor sentinel or claims successful handoff.

## Bounds and proposed fixture policy

The tests explicitly propose: 3 sessions; 64,000 encoded bytes/session; 192,000 total reserved session bytes; 8 retained requests and 8 turns/session; 8 envelopes; 16,000 bytes/envelope; 128,000 reserved backlog bytes; 2,000 encoded input bytes; 4,000 encoded output bytes; 4,000 evidence bytes; 8 adapter operations/save; 2 concurrent saves; 2 total save attempts; 10 ms retry backoff; 50 ms visible write timeout; 1,000 ms dirty age; 100 ms request retention; 20 ms shutdown drain. Individual tests override these to exercise boundaries. **These are fixture values, not deployment-approved defaults or performance targets.**

Each retained session reserves its full session byte allowance globally. Each accepted turn reserves a full envelope's bytes/count until confirmed saved, including while generation is active. Admission checks exact fixed envelope overhead plus maximum output/evidence allowance. Input/output bounds count JSON escaping. Retained request handles and complete envelopes are charged conservatively, including the request's serialized representation again inside the envelope. The queue retains the same frozen envelope reference, rather than copying its text. Results/ledger counts are capped; manifest references cannot exceed the existing 500-reference schema. Context/token limits still belong to the existing assembler; no history is silently truncated.

These are encoded-data ceilings plus bounded object counts, **not a measured V8 heap/RSS ceiling**. Operator memory policy must leave headroom for object/string overhead, temporary encoding/validation, assembler/model copies, audio buffers and the rest of the application. Returned context arrays/manifests are bounded per call; downstream code must not retain unlimited request/context copies. At capacity or excessive dirty age, new paid work is rejected; existing dirty data and duplicate identities remain available. Clean entries also count against capacity until explicitly evicted. Long sessions eventually require an explicit later hydration/selection policy; this task does not add compaction.

## Verification evidence

All commands below ran from `backend`, offline. Test thresholds and historical source files were not edited.

| Command/check | Actual result |
| --- | --- |
| Initial `npm test -- test/performance/memory-first-foundation.spec.ts` | RED: missing implementation import; 1 failed suite, no tests collected. |
| Worst-case reservation regression | RED: 1 failed / 21 passed; admission incorrectly accepted an envelope unable to hold its configured output/evidence. Corrected before GREEN. |
| `... -t "fixed or stalled"` | RED: 1 failed / 26 filtered out; injected-clock stall prevented the drain deadline. Corrected before GREEN. |
| `... -t "before the adapter"` | RED: 1 failed / 27 filtered out; a microtask dispatched a newly fenced save. Corrected before GREEN. |
| Final focused suite | GREEN: **28 passed**, 1 file. Covers unsaved follow-up context, retained dedup/mismatch, forged/stale handles, text/live contention, spoken/unknown context, byte/count admission, oversized terminal fallback, independent session ordering/concurrency, partial/unknown/failed publication, idempotent save-only fixture reconciliation, bounded retries, raw timeout/drain, epochs, fences and dirty age. |
| `npm run build` | Passed initially and after final source changes. |
| `npm run lint` | Final exit 0, 647 warning lines outside the new files. Targeted type-aware lint of both new code files emitted no warnings. |
| Shared deterministic checks (command below) | Final **201 passed**, 18 files, including all 28 foundation tests. |
| `npm test` | Exit 1: **300 passed / 8 failed / 2 skipped files; 2,746 passed / 40 failed / 10 skipped tests**, 143.66 s. This earlier package-wide run included the then-current 22 foundation tests. Final isolated foundation checks cover subsequent local refinements. |
| `npm test -- test/performance/durable-latency.spec.ts test/performance/voice-critical-path.spec.ts` | Exit 1: **44 passed / 19 failed**, 63 tests; 1 passed / 1 failed file; 19.00 s. Matches Task 1's documented standalone totals; voice file passed. |

The routine failures occur in `assembly/calendar-simplification.built`, `operations/local-guard`, `persistence/local-open`, `performance/calendar-critical-path`, `performance/confirmed-state-cache`, `performance/durable-latency`, `runtime/calendar-recovery-unavailable`, and `integration/plugins/multi-calendar/authority`. Several routine performance cases timed out under package-wide load. No package-wide baseline was supplied: additional failures are **observed/unbaselined**, not asserted to be pre-existing or caused/fixed by Task 2. The documented standalone 19 failures remain unresolved, including historical command caps and unavailable Calendar boundary evidence. The foundation is imported only by its new tests, not by those existing production paths. No service-dependent suite was run. Existing Vite tsconfig-paths deprecation remains nonfatal. Logs were captured outside the repository in the process temporary directory.

Final shared command:

```powershell
npm test -- test/performance/memory-first-foundation.spec.ts test/context/ test/runtime/execution-reservations.spec.ts test/runtime/identity.spec.ts test/runtime/work.spec.ts test/model/observation-writer.spec.ts test/voice/agent/voice-delivery.spec.ts
```

Git verification: all three Task 2 files are `??` (untracked); no tracked-file diff or staged changes. Each new file passed `git diff --no-index --check -- /dev/null <path>`; only the repository's LF-to-CRLF advisory was emitted. Initial four untracked Task 1/research documents were preserved. Document links resolve within the checkout.

## Required integration and operator decisions

1. Select deployment-approved memory, input/output/evidence, operations, retry/timeout/age/retention/drain policies using host resources and throughput evidence. The constructor deliberately has no default. Enforce one application process per database and no overlapping rollout owners.
2. Construct **one** foundation in the existing `AppService` composition after policy/adaptor admission. Do not construct one per request or modality. Its save adapter is still required: validate final-only persistence against existing schemas, write dependencies before visibility, reconcile partial/unknown item outcomes by IDs/revisions, and conditionally advance durable publication. Adapter operation/encoded-write limits must be enforced against actual projections; passing limits here does not count or certify driver commands. No cross-collection atomicity is assumed.
3. Task 3 must migrate ordinary text admission/status/context/replay, graph/checkpoint semantics, reservations, HTTP reads and terminal release together. The foundation currently starts from an empty in-process session; **cold hydration of existing history is not implemented**. Callers must not treat a missing entry as proof of an empty existing conversation or non-dispatch. Add bounded trusted hydration before admitting existing sessions. Explicit generation retry/input linkage and history/navigation overlays also need coordinated runtime contracts. Do not use both this local slot and the current durable reservation system as competing authorities.
4. Task 4 must supply validated settled voice evidence from the existing proof owner, route delivery lookups to memory, and move ordinary speech/model accounting/media waits deliberately. Standalone socket/response usage envelopes, if needed, must extend this same bounded application writer rather than create a parallel runtime. Keep quotas, output epochs, interruption, unknown hearing and the durable Calendar effect boundary.
5. Task 5 must coordinate retained browser request keys, separate save states, version-aware navigation/history overlays and user-facing save failures. These internal errors/contracts are not wire/UI messages.
6. Wire shutdown to stop generation/media admission, settle/cancel producers under existing policy, then drain this owner alongside existing work. Only close persistence/release ownership if **all** existing safety checks and this drain succeed. Fenced/unknown/in-flight work must not be cleared merely to make shutdown pass. Storage adapters must enforce archive/revocation/redaction tombstones and monotonic navigation projections; this local contract alone cannot prevent a remote late write.

No disk spool, generic repository replacement, fake queued success, new model/provider/UI functionality, production policy approval, Azure certification or workflow-completion claim is included.
