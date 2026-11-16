# Memory-first conversation contract — Task 1

7 November 2026. Definition complete; implementation absent; deployment latency baseline pending. See [measurement protocol](memory-first-task-1-baseline.md).

## Authority and decisions

Confirmed by the user's current instruction: prioritize responsive text and voice; drastically reduce database work, not merely defer the same mutations; permit crash loss of unsaved conversation and accounting; provide recovery workarounds. Task 1 authorizes specification and safe offline checks only. No skills, agents, runtime edits, staging, commits, paid calls, service tests, or deployment.

This is a deliberate replacement for ordinary conversation's persist-before-inference and durable-before-completed requirements in [Phase 1 goal](../aurvin-phase-1/goal.md), [voice goal](../voice-modes/goal.md), and [earlier performance goal](../chat-performance/goal.md). Those documents and existing code remain unchanged. Later owners must reconcile contracts/tests together; a queued write is never a confirmed persistence receipt. Calendar external effects retain their durable barriers.

Proposed defaults below are implementation guidance, not additional user-confirmed choices: memory-only recovery initially; reject new work at backlog capacity; retain current disconnect cancellation policy; separate save notifications from generation terminal events; no automatic spoken replay. Numeric memory/retry/age/drain limits require operator memory and throughput facts before implementation admission. No millisecond or percentile promises are established.

## Observable contract

All state comes from the trusted backend identity and one authoritative process per database. No overlapping processes during reload/rollout. Process startup/configuration checks are outside turn latency. Keep finite input/context/output/concurrency budgets, attribution, validation, cancellation epochs and context ordering. Do not silently truncate history or duplicate checkpoint-restored input.

| Axis | Meaning |
| --- | --- |
| Generation | accepted → generating → finalizing → completed/truncated, or failed/cancelled/interrupted. Accepted means validated and reserved in server memory; completed means the final public result is committed to authoritative memory. Neither promises remote durability. |
| Save | pending → saving → saved, or failed/unknown. Saved requires acknowledged complete publication through that session version. Failure means known save failure; unknown means a command may have committed. Save failure never changes a generated answer into a model failure. |
| Voice delivery | pending → completed/interrupted/cancelled/unknown, with generated text, synthesis and playback proof distinct. Generated or synthesized is never evidence of hearing. Preserve only the proven heard projection in follow-up context, with existing uncertainty rules. |
| Version | Server session version and durable contiguous watermark, plus process epoch and stable event sequence. Watermark advances only when all dependencies through a version are confirmed. |

Expose these facts consistently in submit/status/stream/history and voice control contracts. Exact wire names/schema versioning belong to the contracts owner; strict existing clients require coordinated compatibility updates. Stream deltas remain provisional generation output until generation terminal; after terminal they may still be unsaved. Persisted readers must not interpret partially published records as saved completion.

Targets for ordinary conversation (including Calendar-connected turns without external effects):

- New-session and warm text/live utterance admission, attachment, context preparation and actual model dispatch await **zero database reads or writes**.
- Model delta → visible text/TTS Speak, PCM handling and playback reports await zero database operations; no per-frame/report persistence.
- Eligible next turn awaits zero prior-save work. Text becomes eligible after final memory result/context publication and execution-slot release. Voice becomes eligible after output stop/settlement or bounded unknown delivery outcome and memory heard projection publication. Barge-in still stops stale output before the next response. Persistence never gates these media boundaries.
- Cold existing history may require bounded hydration of session, selected manifest/messages and voice delivery evidence before dispatch. No zero-read guarantee here; establish the actual query budget from implementation, not a guessed read count. Hydrate once, then overlay newer memory. Cold recovery and external tools are separately measured exceptions.

Dictation remains draft-only until explicit Send, then uses text semantics. Speech socket usage aggregates separately by socket epoch, including unsent dictation. Moving chat writes alone does not remove voice setup accounting waits; the speech owner must remove ordinary socket-ledger waits from setup while preserving in-memory quota admission and terminal usage.

## Identity, retries and UI

Retain a bounded server request ledger beyond acceptance: trusted user, stable request key, payload hash including Calendar reply reference, derived session/turn/attempt/message IDs, original config revision, result/save state and process epoch. Client retains the same key and payload while POST delivery is ambiguous; reconnect/retry of transport uses that key. Same key/different payload conflicts. Live utterance identity retains voice session/socket epoch/provider turn ID. Cross-tab text/live exclusion stays server-owned.

Within the same process, duplicate requests join or retrieve the original outcome; reconnect returns the exact buffered result/status without inference. Explicit regenerate/retry creates a new attempt linked to the original accepted input. Save retry repeats only idempotent persistence. No save failure or reconnect automatically repeats inference or TTS. Proposed default keeps current text disconnect cancellation; continuing detached generation is a separate decision.

After restart, absence from storage does not prove no dispatch or no charge. Old-epoch unresolved requests report unknown-after-restart and require explicit new-attempt authorization; never silently resubmit an ambiguous request. Provider IDs aid accounting reconciliation, not answer reconstruction or exactly-once billing.

Insert a pending sidebar row on server memory acceptance, including new live conversation linkage through the appropriate text-safe projection. Empty New Chat remains unsaved/unlisted until accepted input. Merge lists, history pages and status with the memory overlay by server IDs/version; stale DB responses cannot remove pending rows, lose unsaved messages, revert rename/pin, or re-enable busy sessions. Preserve pagination and voice visibility policy. No compulsory list refresh after each turn. Display useful pending/failed/unknown save status and retry-save action without backend details. Browser drafts/copies can support display/export, but never become trusted context, effect authority or billing proof after restart.

## Bounded writer and recovery

Use one application-owned tracked async persistence writer, with per-session ordering and bounded global concurrency. Transfer persistence ownership out of request Work/drain: request closure releases generation while process shutdown still sees every raw write promise. Do not fabricate ConfirmedRecord receipts or reuse stale leases.

Reserve capacity before paid dispatch for bounded input, maximum output, accounting, voice evidence and final bookkeeping. Bound dirty sessions, total bytes (including copies), envelopes, per-envelope/flush bytes and operations, in-flight work, retry count, dirty age and shutdown time. Pin dirty state and request identities; clean cache TTL/eviction must never discard them. At capacity/expired backlog, proposed default rejects new work promptly with retryable save/backlog status, preserves current results and drains. No unlimited waiting requests or silent ephemeral fallback. This backpressure exception is distinct from normal next-turn readiness.

Persist terminal absolute snapshots, not a delayed replay of accepted/generating/progress/finalizing writes. Coalesce usage by dispatch and delivery by response/epoch; retain distinct turns/attempts/socket ledgers and effect records. Store final generated and heard evidence separately. Keep existing collection boundaries initially. Consolidation must reduce total driver commands and document mutations; one logical flush does not promise one atomic cross-collection write.

Publish referenced input/output/attempt/accounting/delivery evidence before the manifest and saved-completion watermark. Use deterministic IDs, payload verification and revision conditions for retries; session activity is monotonic and older writes cannot replace newer title/pin/active state. Archive/redaction/revocation fence queued writes. Preserve compatible checkpoints or explicitly reconstruct from final application state without inference; old sync graph durability cannot remain on ordinary dispatch/unlock paths.

Partial save retains dirty memory and the old durable watermark. Classify each batch item, reconcile unknown outcomes by ID/revision, retry confirmed missing projections only; never replay non-idempotent increments. Persisted readers exclude incomplete publications. After crash, finish only surviving sealed results; missing result becomes interrupted/unknown. No surviving receipt means no guarantee of recovery.

Shutdown stops new work, cancels/drains media under existing policy, attempts bounded save drain, and reports remaining dirty/unknown work honestly. Timeout is not write cancellation; track raw promises and retain executor ownership until safe handoff. Forced death may lose all volatile state, as accepted by the user.

## Calendar and deferred spool

Calendar mutations keep durable accepted intent, action hash, original target/connection revisions and authority, operation/event IDs, budget reservation and dispatch evidence **before** external invocation. Keep outcome/readback reconciliation for ambiguous effects; never turn save retry into a second effect. Do not replace these with ordinary volatile conversation state. Local skill disclosure requires no external barrier; Calendar reads retain applicable authority/budget checks and are measured separately.

Optional final-result disk spool is deferred until retained storage/deployment is known. It would replay sealed persistence envelopes only, never inference/TTS; requires exclusive ownership, versioned bounded framing/checksums, flush semantics, safe rotation, disk limits, retention/redaction fences and restart reconciliation. Async append alone cannot claim local durability. It cannot recover unsaved in-progress inference or prove hearing. Current remote mutation journal is not this spool and can add remote writes.

Open operator facts: actual Cosmos/Azure product/API/version/tier/region and limits; backend host/region/process count and rolling overlap; memory budget; retained filesystem and restart behavior; termination grace; isolated service-test permissions and cost/data bounds. Native Mongo evidence does not certify Cosmos. Keep memory-only default pending those facts.

## Later owner handoff

| Owner | Required coordinated change |
| --- | --- |
| Contracts/runtime | Independent state axes, epoch/version/status overlay, stable request ledger, in-memory admission/exclusion/context and terminal readiness. |
| Persistence | Ordered consolidated projections, final voice snapshot path, partial/unknown reconciliation, watermark/read visibility and bounded process-owned writer/drain. |
| Model/voice | Aggregate observations and speech usage; remove ordinary DB barriers; preserve dispatch attribution, delivery proof, quotas and interruption. |
| Frontend | Retained submission identity, optimistic sidebar, overlay merge, separate save UX, correct text/media unlock. |
| Verification | Block writer during dispatch/output/follow-up; assert zero awaited DB plus lower total commands; exercise failure matrix in the protocol. |

Primary inputs: [recovery research](persistence-recovery-workarounds-research-2026-11-07.md), [latency research](../../CONVERSATION_LATENCY_RESEARCHER_2.md). Source anchors and evidence are in the companion protocol; these proposals are not implemented or measured behavior.
