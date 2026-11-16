# P6 — Conversational Calendar Authority and Pinned Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit ordinary, sufficiently explicit scheduling requests and bounded cross-turn clarifications safely, enforce availability before every first create dispatch, and preserve one immutable external operation through approval, failures, and recovery.

**Architecture:** Extend the existing durable Calendar loop, operation writer, ledger, graph channels, and context builder; use P2's v2 stores, P4's account/capability gate, and P5's real embedded MCP and v2 model port. Accepted user messages—not model flags, cached names, or assistant history—provide intent and approval authority. Persist proposals before disclosing them, reserve operations by originating intent, and reconcile a dispatched operation on its original account/calendar/event ID without another create.

**Tech Stack:** Existing TypeScript/ESM NodeNext, Node crypto/Intl/AbortSignal, Zod, Vitest, LangGraph/checkpointer, native MongoDB persistence ports, and pinned embedded MCP client/server. No dependency, collection, routing service, background agent, live API, or paid action is added.

---

## Execution contract and source reconciliation

Read `goal.md`, `state.md` P6 scope/exit gate and ownership, `research.md` (especially §§6, 10.4, 12–14), root `AGENTS.md`, and the current sources in the file map below before executing. The approved goal overrides preparation-era research suggestions: **do not** always ask for confirmation, silently fall back from an invalid saved default, or treat a transparent event as visible to free/busy. P2/P4/P5 worker completion is recorded; their committed ports, not their plan examples, are authoritative.

This planning artifact is the planner's **only write**. The planner does not stage or commit. Future worker commits below require the orchestrator's explicit serialized commit slot; stage named owned files only. Review is **skipped, not passed**. Defect correction and meaningful tests are not skipped.

**Readiness:** plan written; implementation is partially gated by I1–I7 below. A committed plan alone does not close those owner-interface gates or certify P6 complete.

Run commands from `backend/` unless an explicit repository-root command is shown. Do not load application `.env`, install packages, use operator tokens, invoke Google/OpenRouter/OAuth, or create a database without the separately supplied isolated prerequisites. Routine fixtures reject any URL outside their fake handlers. Keep every new code file's mandatory repository header and `.js` import specifiers; add the header when changing more than 30% of an existing file.

### Existing seams to reuse

| Surface | Actual current interface and implication |
| --- | --- |
| `src/contracts/calendar-authority.ts` | `CalendarProposalStore`, `calendarProposalSchema`, `calendarProposalReplySchema`, `proposalMatchesReply`, tombstone and capability schemas. One pending proposal/session; TTL is **positive and ≤600000 ms**; candidate-specific action hashes matter. |
| `src/contracts/calendar-discovery.ts` | `CalendarAccountBinding` is independent of preferences; `CalendarResolvedTarget` is canonical, account-bound, role/capability-bound, and has `discoveryRevision`. |
| `src/plugins/google-calendar/connection.ts` | `currentAccount()`, `requireAccountCurrent(account, signal)`, `capabilityGate.resolve/requireCurrent`. `resolve` already implements exact ID/name normalization, explicit → saved → primary, and bounded duplicate candidates. Do not copy this resolver into runtime. Both target methods currently perform counted fresh discovery. |
| `src/contracts/calendar-operations.ts` | v2 action must contain canonical `calendarId`; `authorization.canonicalActionHash === requestHash`; `authorization.acceptedTurnId === turnId`. `intentId`, `originatingTurnId`, and `originatingAcceptedMessageId` preserve cross-turn causality separately from the approving turn. |
| `src/persistence/persistence.ts` | Existing single bundle exposes `calendarConnectionsV2`, `calendarOperationsV2`, `calendarDecisionsV2`, `calendarResultsV2`, `calendarAccountingV2`, `calendarProposals`; use these instances, not another store/owner. |
| `src/persistence/calendar-operations.ts` | `getByIntent/reserveByIntent/compareAndSwap` live on `.v2`. v2 **unknown → dispatching is forbidden**, even though the historical v1 adapter has an absent-readback retry path. |
| `src/plugins/google-calendar/tools-validation.ts` | Reuse `validateCalendarCall`, `calendarActionHash`, `calendarEventId`, and `requireCreateAuthority`. Hash only the fully resolved action with canonical ID; never hash model spelling or an unresolved primary alias. |
| `src/contracts/calendar-availability.ts` | Reuse `calendarAvailabilityResultSchema` and `calendarAvailabilityFingerprint`; fingerprint includes busy intervals, calendar-set hash, per-calendar status/reason, coverage, truncation, and limitations, but deliberately excludes observation counters/timestamps. |
| `src/plugins/mcp/calendar-client.ts` | v2 execution overload takes account + nullable trusted target, v2 operation, dispatch attribution, deadline and counted callbacks. Runtime must supply operation authority before create. |
| `src/model/calendar-adapter.ts` | Use `createCalendarModelPortV2`; legacy tool-bearing model dispatch is rejected. No model/provider implementation edit belongs here. |
| `src/model/calendar-repair.ts` | `rebuildCalendarMessages` already accepts v2 complete groups. Preserve matched assistant/tool adjacency and accepted input once. |
| `src/contracts/calendar-wire.ts` | New frames use `calendarMultiStreamEnvelopeSchema` protocol 3, `calendarClarificationWireSchema`, and `calendarTurnStateV2Schema`. Historical protocol-2 frames/receipts remain readable. |

The runtime sources still create v1 operations/dispatches/decisions and require canonical JSON. Those are P6 migrations, **not** permission to re-enable the now-read-only v1 path. The existing native Calendar test proves only a database-name prefix; replace that weak check with authority/recovery behavior in Task 12.

Documentation consulted for graph recovery: [LangGraph graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api) and [durable execution](https://docs.langchain.com/oss/javascript/langgraph/durable-execution), retrieved through Context7 on 24 October 2026. Checkpoints are super-step boundaries; a failed node can run from its beginning. Therefore `invoke(null)` alone never proves a Calendar effect or paid inference cannot repeat. This plan uses saved durable decisions/results/operations and refuses ambiguous replay.

## Interface gaps — report and obtain owner amendments before affected tasks

These are source-observed gaps, **not authorization for P6 to edit another owner's files**. The orchestrator must route each to its owner, serialize the amendments, record their commits, and reconcile the final export names here before consumers import them. Unaffected pure/runtime fixture work may proceed. Do not call the P6 exit gate passed while a required gap remains.

| ID | Evidence, required guarantee, owner, and blocked work |
| --- | --- |
| I1: recovery lookup | `CalendarProposalStore.getCurrent` returns only unexpired pending records. There is no public scoped lookup of a consumed/expired proposal or its exact persisted reply/consumption wrapper. P6 cannot repair consumption→operation or selection→conflict crash windows or explicitly tombstone an expired current record through that port. **P1/P2:** expose a bounded scoped authority lookup by proposal ID, including minimal consumed reply/consumption/authority expiry and tombstone; expose the current slot including expiry for cleanup. Retained action/labels remain expiry/redaction controlled. Block Tasks 4, 6, 9 where they need this lookup. **Ratified 24 Oct 2026:** owner amendment committed as `3679f83` — `CalendarProposalStore.getCurrentSlot(userId, sessionId)` returns the pending proposal including expired records, and `getAuthority(userId, sessionId, proposalId)` returns the pending record, the persisted reply/consumption wrapper with `authorityExpiresAt`, or the tombstone. `getCurrent` keeps hiding expired pending records. |
| I2: v2 operation events | `CalendarOperationStoreV2` has no append/list event methods. The concrete legacy `appendEvent` loads the v1 turn key and v1 state schema, so it cannot confirm a v2 operation, including `failed`/`cancelled`. **P1/P2:** supply v2 event schema and scoped append/list ports, validating against the current v2 intent operation; preserve v1 reads. Block transition/event/publication crash evidence in Tasks 6, 9, 10. Do not silently remove the existing durable-event confirmation rule. **Ratified 24 Oct 2026:** owner amendment committed as `0257aa0` — `operationEventV2Schema` with the distinct kind `calendar-operation-event-v2`, plus `CalendarOperationStoreV2.appendEventV2` (idempotent per event id, validated against the current v2 operation) and `listEventsV2`. v1 reads and writes are unchanged. |
| I3: idempotent logical charge | Budget CAS has counters but no durable logical-tool/create debit identity. A crash after debit but before the execute-node checkpoint cannot safely infer whether the same decision was charged. **P1/P2:** freeze an idempotent debit keyed by accepted turn + model decision ID (logical tool) or intent ID (create); exact reread returns the original debit, differing identity/payload conflicts. Physical HTTP attempts remain separately counted before delivery. Block exact retry/restart debit assertions in Tasks 1, 6, 9, 11. Do not invent a process-local Set as durable evidence. **Ratified 24 Oct 2026:** owner amendment committed as `4063227` — `calendarDebitId(userId, sessionId, turnId, kindOfDebit, id)` with the model decision id for a logical tool and the intent id for a create; the debit entry and the counter change land in one budget CAS, an exact repeat returns `duplicate`, a reused identity with a different payload returns `conflict`, and a lost debit record is rebuilt from the budget entry. |
| I4: stale-tab reply binding | Submit currently carries only content/idempotency/session/`calendarProtocol`. With plain “yes”, a server cannot distinguish a reply to old tab A's superseded disclosure from an affirmative to tab B's new current disclosure. **P1/P2/P7/P8:** add an optional bounded causal reply reference, e.g. `calendarReplyTo: { proposalId, revision }`, to submit and durably bind it to acceptance. It is an untrusted reference, never approval; runtime still matches the current proposal, actual accepted content, identity, expiry, and fingerprint. The UI attaches it automatically; users never copy IDs. A reply without it is allowed only when the server can prove a unique unchanged immediately preceding disclosure; otherwise ask which current proposal they mean, with zero effect. Coordinate this handoff with P7 before implementing reply consumption in Tasks 4/7. **Ratified 25 Oct 2026 (contract + persistence):** owner amendment committed as `d0a13ec` — `submitTurnRequestSchema` gained the optional strict `calendarReplyTo: { proposalId, revision }`, and `CalendarProposalStore.bindReplyReference` / `getReplyReference` bind it durably per accepted attempt (idempotent, `conflict` on a different reference for the same attempt). A reply without the reference stays valid at the contract level. **Remaining for P6 (runtime):** compare the bound reference against the *current* pending proposal and refuse a reference naming a superseded disclosure; accept a reference-free reply only when the server can prove a unique unchanged immediately preceding disclosure; pass `calendarReplyTo` through the submit/retry/retry-cancel body rebuilds in `durable-chat-runtime.ts` (lines 133, 143, 206 drop it today) and bind it next to `putAttempt`; include the reference in the attempt `payloadHash` so a resubmitted idempotency key with a different reference is detected as a payload mismatch. P7 still owns attaching the reference in the UI. |
| I5: incomplete-details representation | `calendarProposalSchema` requires a non-null canonical hash for every non-selection proposal, but missing material details have no complete canonical event to hash. `details` with `action:null` plus a made-up hash is not honest authority; selection also cannot represent an unknown/unavailable target with zero candidates. **P1/P2:** admit an explicitly incomplete details/target variant with null canonical hash, bounded missing-field enum, and ≤8 accepted-message references for deterministic field completion; prohibit consumption until a complete action/target has replaced it. Use existing collection/TTL/CAS and do not store arbitrary model prose. Block multi-turn incomplete-details/unknown-target acceptance in Tasks 2/3/4/7. A simple human clarification may be emitted before this amendment, but that is not the full durable-details exit gate. **Ratified 25 Oct 2026 (contract + persistence):** owner amendment committed as `d0a13ec` — a proposal gained an optional `incomplete: { missing, messageRefs }` declaration with a closed six-value missing-field enum and at most eight distinct accepted-message ids (identifiers only, never prose). A null canonical hash is admitted ONLY with that declaration, and such a proposal carries no action; a selection with zero candidates is admitted only when it declares the target missing. The contract now REFUSES consumption of an incomplete proposal (`consumedBy` refine plus `proposalMatchesReply`), and the store returns `{ outcome: 'rejected', reason: 'incomplete' }` without writing a consumption record, while a cancel/dismiss still works. All pre-existing bounds (candidates ≤ 20, limitations ≤ 8, TTL ≤ 600000 ms, 16 KiB doc) are unchanged, and existing persisted proposals still parse. **Remaining for P6 (runtime):** publish an incomplete proposal with `action: null`, `canonicalActionHash: null` and the declaration when material details are missing; publish a complete proposal that supersedes it before any consumption; map the runtime's existing field vocabulary (`summary`/`date`/`start`/`end`/`timeZone`) onto the enum (`summary → title`, `date → start + end`). |
| I6: compatible runtime transport types | `backend/src/chat-runtime/ports.ts:70,82` still restricts the Calendar emitter/result to protocol-2/v1 types. That generic file is outside P6's granted write set; changing only `durable-chat-runtime.ts` cannot truthfully expose protocol-3 frames or v2 status while compiling against that interface. **P8, with an explicit narrow ownership amendment before P6 integration:** widen the callback and optional Calendar status return to the already-frozen compatible schemas/types; no HTTP behavior change is implied. P1 owns the related accepted command/reference addition under I4. Block Task 7/10 compile/transport exit evidence until the amendment; no `as unknown as` escape. **Ratified 25 Oct 2026:** owner amendment committed as `185b011` — `emitCalendar` now takes `CalendarCompatibleEnvelope` and `getCalendarTurnState` returns `CalendarCompatibleTurnState | null`, both derived with `z.infer` from the P1 `calendarCompatibleEnvelopeSchema` / `calendarCompatibleTurnStateSchema` rather than a hand-written structural type. Protocol 2 stays accepted for the v1 path. `observed-runtime.ts`, `chat-stream.transport.ts`, `chat-http.service.ts`, `chat-runtime/index.ts` and `app.service.ts` needed no change: the telemetry fields, the SSE framing and the already-compatible `turnStatusResponseSchema.calendar` field all accept the widened union, so no cast and no HTTP behaviour change was introduced. |
| I7: older unresolved operation lookup | The v2 port has turn/intent lookup but no bounded session lookup. A newer unrelated accepted text turn can replace latest graph/turn references while an older operation remains unknown. **P1/P2:** provide a scoped bounded unresolved-operation query (including legacy quarantine), returning an explicit overflow/conflict rather than an unbounded scan. Runtime blocks another create while same-session unresolved effects cannot be reconciled; ordinary text remains usable. Block the older-turn recovery/race cases in Tasks 6/9/11 until the port is committed. **Ratified 25 Oct 2026:** owner amendment committed as `c3d0cd4` — `CalendarOperationStoreV2.listUnresolvedBySession({userId, sessionId, limit})` returns the session's unresolved operations (`planned`, `dispatching`, `unknown`, both schema versions so a legacy v1 quarantine is visible) newest-first, reads at most `limit + 1` documents, hard-limits the limit to 50 and refuses an invalid limit, and reports `overflow` so the caller refuses rather than acting on a truncated view. The read is user- and session-scoped, so it never becomes a cross-session scan. No new index and no new document kind. |
| I8: MCP server gate check shape | The MCP server's server-side gate check called `gate.requireCurrent(binding, signal)`, the legacy shape. The v2 capability gate takes `{ target, operation, signal, deadlineAt, consumeRequest, consumeRefreshRequest }`, so every v2 call without a write target was rejected with `CALENDAR_EXECUTION_DENIED` during connect, and the server-owned availability preflight could not run at all. **P4/P8:** make the server-side check mirror the client — a v2 capability gate is rechecked with the v2 input shape only when the binding has a target, and a null-target binding skips the target check. The legacy gate path and the create authorization stay unchanged. **Ratified 24 Oct 2026:** owner amendment committed as `eac927d`, with regression coverage in `backend/test/plugins/mcp/calendar-server.spec.ts`. |
| I10: assembled v2 dependency branch | `backend/src/operations/calendar-assembly.ts` still built the LEGACY v1 runtime bundle, so `isCalendarV2` was false in the deployed app: the durable runtime advertised no Calendar tools, never ran the Calendar graph, and a create call was rejected by the text adapter. **P8:** build the v2 dependency branch (capability gate, v2 connection store, v2 model port) over the SAME single persistence owner, and keep the legacy policy-deadline guarantee. **Ratified 25 Oct 2026:** owner amendment committed as `fdb7eaf` — `createCalendarAssembly` now returns the v2 shape, `GoogleCalendarConnections` receives `storeV2` and `discovery`, `CalendarApiTools` and `EmbeddedCalendarExecution` receive the v2 capability gate, and `app.service.ts` passes a LAZY `storeV2` facade over `this.persistence.calendarConnectionsV2` plus `CalendarDiscoveryApi`. No second runtime and no second persistence owner were introduced. |
| I11: rejected-body socket teardown | The 413 rejection path in `backend/src/admin-config/configure-admin-http.ts` did `res.end()` and then immediately `req.destroy()`, so a client whose body was still uploading read `ECONNRESET` instead of the promised response. **P8/P4:** flush the response, then drain the unread body so the close is a clean FIN, with a bounded teardown for a client that keeps streaming. **Ratified 25 Oct 2026:** owner amendment committed as `fdb7eaf` for the admin-config route, with a deterministic proof test that writes the rejected body in 4 KiB chunks while the server rejects on the headers. The identical helper in `backend/src/plugins/google-calendar/controller-http.ts` carried the same latent race and is routed to the plugin owner. **Ratified 25 Oct 2026:** the plugin owner committed the same flush-then-drain teardown as `41087d1`, with `backend/test/plugins/google-calendar/controller-http-close.spec.ts` as the deterministic proof. |
| I9: budget debit limit ordering | `CalendarAccountingStoreV2.debit` builds the next budget with `turnBudgetRecordSchema.parse(...)` before its own limit check, and the persisted schema caps `logicalTools` at 6, `creates` at 1, `calendarRequests` at 20 and `refreshRequests` at 2. An over-budget debit therefore raised a `ZodError` instead of `STORAGE_BUDGET_EXCEEDED`, and the persisted counter never reached the intended user-facing failure. **P1/P2:** run the limit check before the schema parse, using the same limit set as the ledger, and leave the counters and the debit list unchanged when the limit is exceeded; an exact repeat still returns `duplicate` and a reused identity with a different payload still returns `conflict`. Block the exact retry/restart debit assertions in Tasks 6, 9 and 11. **Ratified 25 Oct 2026:** owner amendment committed as `c6b0703` — the four counters are computed first, the limit check runs against them using the store's own limits, and only a debit inside the limits reaches the persisted parse. The persisted shape, the revision bump, the three-CAS-round retry and the `duplicate`/`conflict`/`confirmed` contract are unchanged. The runtime-side `assertLogicalToolBudget` guard in `calendar-loop.ts` is now redundant and is removed by the Task 6 owner. |

Proposed minimum recovery/debit shapes for owner discussion (these names are **requested interfaces, not existing exports**):

```typescript
type ProposalAuthorityLookup =
  | { state: 'pending'; proposal: CalendarProposalRecord }
  | { state: 'consumed'; proposal: CalendarProposalRecord | null;
      reply: CalendarProposalReply; consumption: CalendarProposalConsumption;
      authorityExpiresAt: string }
  | { state: 'tombstone'; tombstone: CalendarProposalTombstone }
  | { state: 'absent' };

// All identifiers are supplied by the trusted runtime scope, not the model.
interface ProposalRecoveryPort {
  getAuthority(userId: string, sessionId: string, proposalId: string): Promise<ProposalAuthorityLookup>;
  getCurrentSlot(userId: string, sessionId: string): Promise<CalendarProposalRecord | null>;
}
interface CalendarDebitPort {
  debit(input: { userId: string; sessionId: string; turnId: string;
    debitId: string; kind: 'logical-tool' | 'create'; payloadHash: string }):
    Promise<'confirmed' | 'existing' | 'conflict' | 'uncertain'>;
}
```

Owners choose the final schema/port placement and meaningful storage checks. P6 must not assert that these requested methods exist merely because this plan lists them. Any changed authority/bound must return to goal/state reconciliation first. P4's repeated discovery refresh can change `discoveryRevision` without a material calendar change; compare fresh material evidence, not revision equality alone, when deciding whether to re-ask. Preserve the original disclosed revisions in the consumed evidence.

## File map and public runtime interfaces

### P6 write set

| Exact file | Responsibility |
| --- | --- |
| Modify `backend/src/chat-runtime/calendar-ports.ts` | Explicit v2 runtime dependency branch; compatibility-only legacy branch; type aliases for existing v2 stores and reference-only continuation state. |
| Modify `backend/src/chat-runtime/calendar-budget.ts` | v2 dispatch records, persistent per-turn limits, serialized **increment** helpers, owner-ratified idempotent logical/create debits. |
| Create `backend/src/chat-runtime/calendar-intent.ts` | Bounded accepted-message intent/selector/reply interpretation; no provider, fuzzy search, aliases, or authority from model flags. |
| Create `backend/src/chat-runtime/calendar-authority.ts` | Pending proposal construction, current-slot/reply checks, single consumption/tombstoning, causal intent identity and expiry. |
| Create `backend/src/chat-runtime/calendar-preflight.ts` | Server-owned availability execution and material-condition comparison; no direct credential access or duplicate Google REST adapter. |
| Modify `backend/src/chat-runtime/calendar-operation.ts` | One shared canonical action/admission/transition seam for direct creates and proposal replies; v2 immutable intent operation. |
| Modify `backend/src/chat-runtime/calendar-loop.ts` | Resolve targets for all three event tools, run preflight, seal clarifications, persist complete v2 groups, restore saved boundaries before dispatch. |
| Modify `backend/src/chat-runtime/calendar-recovery.ts` | Evidence-based continuation and original-target/account/event readback; no automatic insert/model replay. |
| Modify `backend/src/chat-runtime/calendar-publication.ts` | Compatible v1/v2 operation projection and truthful, expiring durable calendar badge despite narration failure. |
| Modify `backend/src/chat-runtime/durable-chat-runtime.ts` | Only Calendar admission/run/sealed-publication/reconciliation integration; keep text/live/voice/canvas paths and ownership unchanged. |
| Modify `backend/src/agent/state.ts`, `backend/src/agent/turn-graph.ts` | v2 reference-only Calendar cursor/refs/seal and validated restore routing; decode legacy without resuming its tools. |
| Modify `backend/src/context/calendar-context.ts` | Complete v2 groups, source identity/expiry checks, accepted input once, bounded proposal data as untrusted data. |
| Modify `backend/test/runtime/calendar-runtime.fixture.ts` | Existing end-to-end scripted model/fake Google fixture, upgraded to actual P2 v2 adapters and real embedded MCP. |
| Create `backend/test/runtime/calendar-multi-fixture.ts` | Small reusable parsed v2 event/target/availability/accepted-message factories and test controls, not another persistence implementation. |
| Create `backend/test/runtime/calendar-intent.spec.ts`, `calendar-authority.spec.ts`, `calendar-preflight.spec.ts`, `calendar-targeting.spec.ts`, `calendar-multi-recovery.spec.ts`, `calendar-multi-concurrency.spec.ts`, `calendar-graph.spec.ts` | Focused new P6 checks described in tasks. |
| Modify `backend/test/runtime/calendar-operation.spec.ts`, `calendar-loop.spec.ts`, `calendar-logical-tools.spec.ts`, `calendar-budget.spec.ts`, `calendar-lifecycle.spec.ts`, `calendar-recovery.spec.ts`, `calendar-recovery-unavailable.spec.ts`, `calendar-publication.spec.ts`, `calendar-recovery.native.e2e-spec.ts` | Migrate active runtime expectations to v2 while retaining historical compatibility cases. |
| Modify `backend/test/context/calendar-context.spec.ts` | Preserve all existing bounds and add v2 cross-turn/source grouping checks. |

No writes to contracts, persistence, connection/discovery/model/MCP implementations, fixed instructions, `app.service.ts`, HTTP/config/operations, frontend, generic native harness, or reserved integration paths. P8 must replace its existing legacy assembly with the v2 dependency branch and expose protocol-3 events; P6 tests provide that branch without editing P8 files.

Runtime-local types/functions introduced by the tasks:

```typescript
type AcceptedCalendarIntent = {
  intentId: string; originatingTurnId: string; originatingAcceptedMessageId: string;
  originatingAttemptId: string; action: CalendarCreateInput; selector: string | null;
};
type IntentInterpretation =
  | { outcome: 'complete'; intent: AcceptedCalendarIntent }
  | { outcome: 'details'; missing: readonly ('summary' | 'date' | 'start' | 'end' | 'timeZone' | 'target')[] }
  | { outcome: 'not-authorized' };
type ReplyInterpretation =
  | { decision: 'accept' | 'cancel'; choiceCalendarId: null }
  | { decision: 'select'; choiceCalendarId: string }
  | { decision: 'edit' | 'unrelated' | 'ambiguous'; choiceCalendarId: null };

// calendar-intent.ts: pure accepted-content interpretation; candidate is untrusted.
readCalendarIntent(message: MessageRecord, attempt: AttemptRecord,
  candidate: CalendarCreateInput, trustedTimeZone: string): IntentInterpretation;
readCalendarReply(content: string, proposal: CalendarProposalRecord): ReplyInterpretation;

// calendar-operation.ts: used by every create caller, not just CalendarLoop.
canonicalCalendarAction(action: CalendarCreateInput, target: CalendarResolvedTarget): CalendarCreateInput;

// calendar-authority.ts: existing dependencies plus ratified I1/I4/I5 ports.
class CalendarAuthority {
  current(): Promise<CalendarProposalRecord | null>;
  publish(input: { intent: AcceptedCalendarIntent; target: CalendarResolvedTarget | null;
    candidates: readonly CalendarResolvedTarget[]; availability: CalendarAvailabilityResult | null;
    source: CalendarSourceReferenceV2 | null; purpose: 'selection' | 'conflict' }):
    Promise<CalendarProposalRecord>;
  interpret(message: MessageRecord, proposal: CalendarProposalRecord): ReplyInterpretation;
  consume(proposal: CalendarProposalRecord, message: MessageRecord,
    action: CalendarCreateInput, target: CalendarResolvedTarget): Promise<CalendarProposalConsumeResult>;
  close(proposal: CalendarProposalRecord, reason: 'cancelled' | 'superseded' | 'expired'): Promise<void>;
}

// calendar-preflight.ts: actual v2 execution port, no model logical-tool debit.
class CalendarPreflight {
  check(input: { action: CalendarCreateInput; target: CalendarResolvedTarget;
    intentId: string; decisionId: string; stage: 'initial' | 'dispatch' }):
    Promise<{ result: CalendarAvailabilityResult; source: CalendarSourceReferenceV2 }>;
}
```

Implement the dependency constructors inside each owned file with the existing ledger, lease-fenced `write`, injected clock/job, account, v2 execution/capability ports, and existing stores. Do not create a generic service framework. The requested details/recovery/debit additions above are incorporated only after their owner commits.

### Authority and dispatch order (invariant, not advisory prompt text)

1. Confirm durable acceptance; interpret the actual accepted user input/current reply and fix its originating intent ID. No source/calendar/event text, model Boolean, or arbitrary history provides consent.
2. Resolve explicit selector (including a human name) through P4; otherwise saved default then canonical primary. An explicit selector from the accepted request cannot be erased by a model-omitted selector. Compare any model selector against the accepted selection; never promote a different model target.
3. Canonicalize and validate the complete event; hash it including canonical target ID. Resolve details/selection through one durable current proposal if needed. Do not reserve the immutable operation yet.
4. Run a server-owned initial preflight across the **entire discovered set**, even if the model never checked availability or checked only a subset. Conflict/incomplete → persist and disclose a bounded proposal; zero create effect.
5. On actual accepted approval, verify current unexpired proposal, causal reference, session/account/connection, material event/target, and fresh rights. Recheck availability immediately before undispatched create. Unchanged disclosed condition does not ask again; materially changed condition publishes a new proposal and requires a new reply.
6. Confirm final consumption and remaining original-turn budgets; reserve **one operation by originating intent**; persist/confirm `planned`, then `dispatching` and its event before Google. The approving turn owns dispatch accounting; originating fields retain earlier turns.
7. Invoke one non-retryable create using the operation's fixed target/event ID, then confirm receipt and succeeded event before saying created. Create result becomes a complete model call/result group before narration.
8. Once `dispatching` exists, skip new preflight/re-targeting/create. Read back the original operation if necessary; unknown/absent/mismatch never becomes permission for a second insert. A genuinely new accepted complete request gets a new intent ID, not a text-similarity match.

## Task 1: Move runtime ports, ledger records, and fixtures onto the explicit v2 path

**Files:** modify `backend/src/chat-runtime/calendar-ports.ts`, `calendar-budget.ts`, necessary Calendar sections of `durable-chat-runtime.ts`; modify `backend/test/runtime/calendar-runtime.fixture.ts`, `calendar-budget.spec.ts`; create `backend/test/runtime/calendar-multi-fixture.ts`.

- [ ] **Write the failing fixture/ledger test.** Keep the existing `calendarFixture()` API. Add fixture controls `clock`, `setDiscovery`, `setDefault`, `setAvailability`, `setRole`, `replaceAccount`, `currentProposal`, `operationFor`, `requestKinds`, and `advance(ms)`. `operationFor(ids)` reads `calendarOperationsV2.getByTurn`; `currentProposal(sessionId)` reads the actual proposal store; none infers state from prose.

```typescript
it('writes v2 dispatch evidence and retains the accepted turn deadline', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Hello Aurvin');
    h.modelWires.push(textWire('Hello.'));
    await h.execute(ids);
    const first = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    const rows = await h.p.calendarAccountingV2.listDispatches(h.identity.userId, ids.turnId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ schemaVersion: 2, schemaRevision: 'google-calendar.v2',
      openRouterUser: h.identity.userId });
    expect(rows[0].startedAt >= first!.createdAt).toBe(true);
    expect(h.modelBodies[0].user).toBe(h.identity.userId);
    await h.restart();
    expect((await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId))?.deadlineAt)
      .toBe(first!.deadlineAt);
  } finally { await h.dispose(); }
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-budget.spec.ts -t "writes v2 dispatch evidence"`. Expected: current runtime's v1 model dispatch is rejected, or the test exposes the missing v2 fixture ports; do not fix this by weakening P5 validation.
- [ ] **Implement the smallest v2 dependency branch.** Retain the existing shape as `LegacyCalendarRuntimeDependencies` solely for compilation/history; the executable branch is distinguished by `capabilities`, not a guessed tool revision. It carries `connection.currentAccount/requireAccountCurrent`, `capabilities: CalendarCapabilityGate`, `execution: CalendarExecutionPortV2`, `createModelPort: typeof createCalendarModelPortV2`, existing permission/timezone/audit policy, and no credentials. `isCalendarV2` checks `'capabilities' in dependency`. Only that branch admits Calendar budgets/runs tools. Legacy assembly remains ordinary text until P8 rewires it; report this integration gate rather than emitting v1 tools.

```typescript
export type CalendarRuntimeV2Dependencies = {
  connection: {
    currentAccount(): Promise<CalendarAccountBinding>;
    requireAccountCurrent(account: CalendarAccountBinding, signal: AbortSignal): Promise<unknown>;
  };
  capabilities: CalendarCapabilityGate;
  execution: CalendarExecutionPortV2;
  createModelPort: typeof createCalendarModelPortV2;
  trustedTimeZone: string;
  permission: { content: 'volatile' | 'retained'; minimalEvidenceAllowed: boolean; policyId: string };
  auditDeadlineAt?: string;
};
export type CalendarRuntimeDependencies = LegacyCalendarRuntimeDependencies | CalendarRuntimeV2Dependencies;

export function isCalendarV2(value: CalendarRuntimeDependencies): value is CalendarRuntimeV2Dependencies {
  return 'capabilities' in value;
}

// Replacement reservation object in CalendarTurnLedger.reserveDispatch:
const reserved = modelDispatchV2Schema.parse({
  schemaVersion: 2, kind: 'calendar-model-dispatch',
  userId: this.o.identity.userId, sessionId: this.o.identity.sessionId,
  turnId: this.o.identity.turnId, attemptId: this.o.identity.attemptId,
  dispatchId, decisionId, dispatchIndex, reason,
  repairedDecisionId: repair?.rejectedDecisionId ?? null,
  requestedModel: this.o.modelId, reportedModel: null, reportedProvider: null,
  openRouterUser: this.o.identity.openRouterUser, configRevision: this.o.configRevision,
  connectionId: this.o.connection.connectionId, connectionRevision: this.o.connection.connectionRevision,
  schemaRevision: CALENDAR_TOOL_REVISION, generationId: null, providerRequestId: null,
  status: 'reserved', startedAt: this.nowIso(), endedAt: null, firstOutputAt: null,
  promptTokens: null, completionTokens: null, cachedPromptTokens: null, cacheWriteTokens: null,
  reasoningOutputTokens: null, money: unavailableMoney(true), pricing: this.o.pricing,
  reservationUsd, reservationStatus: 'held', failure: null,
});
```

Keep the existing reservation variable derivation and claim/confirmation logic at `calendar-budget.ts:160–186`. Switch dispatch read/parse/update types consistently to v2; leave `turnBudgetRecordSchema` and aggregate schema at their actual version 1. Use `calendarAccountingV2` plus the existing concrete `reconcileReservations/listAttemptAccounting` helpers. Branch and reject v1 dispatch rows for new inference; never cast them to v2.

- [ ] **Upgrade the fixture composition, not production assembly.** Reuse `calendarMemory` from `test/persistence/calendar-multi-memory.ts` and actual `MongoCalendarConnections`, `MongoCalendarProposals`, `MongoCalendarOperations`, `MongoCalendarDecisions`, `MongoCalendarResults`, `MongoCalendarAccounting`, and `MongoCalendarRetention`. Seed a parsed v2 connection for `aurvin-dev-user` with primary `personal@example.test`, shared writer `team@example.test` named Work, and reader `read@example.test`. Instantiate `CalendarApiTools`' v2 overload and `EmbeddedCalendarExecution` with their real account gate. Reuse existing `textConfigFixture`, scripted model wires, failure injector, restart and isolated storage. Extend the fake fetcher for calendar-list/freeBusy/event routes; throw on every unexpected URL. `setRole/default/discovery` persist through the same adapters; replacement changes account/connection, not just a display label. Keep timestamps derived from one injected clock, offsetting inert factory times together so tests do not expire after the calendar date changes.
- [ ] **Fix request increments in the shared ledger.** Add `chargeCalendarRequest(kind)` and `chargeRefreshRequest()`; read/increment/CAS inside the existing `consumeQueue`, not outside it. Record bounded request category evidence via the ratified port; no unbounded ledger array. Otherwise two parallel ≤50-calendar batches can read the same counter and lose one debit. After I3, `chargeLogicalTool(decisionId, hash)` and `chargeCreate(intentId, hash)` use durable debit IDs; an existing identical debit returns without another increment. Every caller uses these methods.

```typescript
async chargeCalendarRequest(_kind: CalendarRequestKindV2): Promise<void> {
  const run = this.consumeQueue.then(async () => {
    const current = await this.budget();
    await this.consumeNow({ calendarRequests: current.calendarRequests + 1 });
  });
  this.consumeQueue = run.then(() => undefined, () => undefined);
  await run;
}
```

The request kind is preserved at every callback; the fixture observes it with a scoped spy on `chargeCalendarRequest`, while admission totals persist through the existing budget CAS. This optional observation is not authority. If stronger persistent request-category evidence is needed beyond the frozen totals/dispatch provenance, route that to P1/P2; do not invent a storage write in this ledger. I3 still gates persistent logical/create debit identity.
- [ ] **Run green:** `npm test -- test/runtime/calendar-budget.spec.ts`. Include simultaneous increments (two deliveries → counter 2), lower limits, exact spend ceiling, and account replacement before dispatch. Expected: v2 provider attribution and original deadline pass; no real network.
- [ ] **Commit when assigned the commit slot:** stage only these task files; `git commit -m "refactor(calendar): select v2 runtime ports and persistent ledger"`.

## Task 2: Interpret accepted scheduling intent and canonicalize the action safely

**Files:** create `backend/src/chat-runtime/calendar-intent.ts`; modify `backend/src/chat-runtime/calendar-operation.ts`; create `backend/test/runtime/calendar-intent.spec.ts`; modify factories in `backend/test/runtime/calendar-multi-fixture.ts`.

- [ ] **Write failing tests for ordinary requests and adversarial non-requests.** Factory `accepted(content)` returns a parsed visible user `MessageRecord` with `completionStatus:'accepted'`, matching `attempt.causal.userMessageId`, fixed session/turn and actual accepted metadata. Factory `event()` returns `{ summary:'Planning', start:'2026-11-03T10:00:00+00:00', end:'2026-11-03T11:00:00+00:00', timeZone:'Etc/UTC' }` parsed through `calendarInputSchemas.calendar_create_event`. `target()` is the parsed Work writer target described in Task 1.

```typescript
it.each([
  'Schedule Planning on 2026-11-03 from 10:00 to 11:00 in Etc/UTC on my Work calendar.',
  'Please add Planning to my Work calendar on 2026-11-03, 10:00–11:00 Etc/UTC.',
  'Create an event called Planning on 2026-11-03 from 10:00 until 11:00 Etc/UTC in the Work calendar.',
])('uses accepted natural language without a JSON echo: %s', content => {
  const { message, attempt } = accepted(content);
  const parsed = readCalendarIntent(message, attempt, event(), 'Etc/UTC');
  expect(parsed).toMatchObject({ outcome: 'complete', intent: {
    originatingTurnId: message.turnId, originatingAcceptedMessageId: message.messageId, selector: 'Work',
  } });
  if (parsed.outcome !== 'complete') throw new Error('expected complete accepted intent');
  const action = canonicalCalendarAction(parsed.intent.action, target());
  expect(action.calendarId).toBe('team@example.test');
  expect(calendarActionHash(action)).not.toBe(calendarActionHash({ ...action, calendarId: 'personal@example.test' }));
});

it.each([
  'Do not create Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
  'Would Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC be free?',
  'Explain this text: "Create Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC"',
  'The calendar description says create Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
])('does not let a create tool manufacture consent: %s', content => {
  const { message, attempt } = accepted(content);
  expect(readCalendarIntent(message, attempt, event(), 'Etc/UTC').outcome).not.toBe('complete');
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-intent.spec.ts`. Expected: missing pure helpers/old JSON-only behavior.
- [ ] **Implement bounded extraction and accepted-message checks.** Before content interpretation require visible user, accepted status, same user/session/turn and `attempt.causal.userMessageId`, and confirmed acceptance loaded by the caller. Use one anchored imperative matcher for `please`/`can you`/`could you` followed by schedule/create/add/book/put, exclude questions about possibility and quoted/reported/negated instructions, and require the parsed event's material fields to be supported by accepted text. Split title/date/time/zone/target using named bounded captures, not fuzzy search. Support the three tested ordinary forms plus the same forms without a named calendar. Normalize case/spacing only for calendar selection; preserve title/description/location exactly. Date support is unambiguous ISO civil date or explicit RFC3339 range; accept explicit IANA zone or the trusted configured zone only when the request clearly uses that zone. Add common written month + day + four-digit year and 12-hour AM/PM forms as deterministic token variants; never guess `11/03`, DST fold/gap, an omitted end, or unspecified relative time. Unsupported/ambiguous phrases return a concise details clarification, not a fabricated event or a JSON-copy request. Keep existing timezone/DST validator authoritative; no second date-conversion library.

Use this bounded matching core in `calendar-intent.ts`; the existing validated candidate supplies the instant/offset, and the server checks it against **all** accepted wall-clock fields. This does not implement another timezone conversion algorithm. Imports are the actual types from `contracts/attempt.ts`, `message.ts`, `calendar-tools.ts`, `key` from `persistence/records.ts`, and `parseCalendarTimestamp/validateCalendarCall` from `plugins/google-calendar/tools-validation.ts`.

```typescript
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const DATE = '(?:\\d{4}-\\d{2}-\\d{2}|[A-Za-z]+ \\d{1,2},? \\d{4})';
const TIME = '\\d{1,2}(?::\\d{2})?(?:\\s*[ap]m)?';
const ZONE = '(?:[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+|my configured time zone)';
const STAMP = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})';
const VERB = '(?:(?:please|can you|could you)(?: please)?\\s+)?(?:schedule|create|add|book|put)\\s+';
const TITLE = '(?:an? event (?:called|named) )?(?<summary>.+?)';
const CLOCKS = `(?<start>${TIME})\\s*(?:to|until|[-–])\\s*(?<end>${TIME})`;
const FIELDS = '(?:; description "(?<description>[^"\\r\\n]{1,2000})")?'
  + '(?:; location "(?<location>[^"\\r\\n]{1,500})")?';
const patterns = [
  new RegExp(`^${VERB}${TITLE} on (?<date>${DATE}) (?:from )?${CLOCKS} (?:in )?(?<zone>${ZONE})`
    + `(?: (?:on|in) (?:my |the )?(?<selector>.+?) calendar)?${FIELDS}[.!?]?$`, 'iu'),
  new RegExp(`^${VERB}${TITLE} to (?:my |the )?(?<selector>.+?) calendar on (?<date>${DATE}),? `
    + `(?:from )?${CLOCKS} (?:in )?(?<zone>${ZONE})${FIELDS}[.!?]?$`, 'iu'),
  new RegExp(`^${VERB}${TITLE} from (?<startStamp>${STAMP}) (?:to|until) (?<endStamp>${STAMP})`
    + ` (?:in )?(?<zone>${ZONE})(?: (?:on|in) (?:my |the )?(?<selector>.+?) calendar)?${FIELDS}[.!?]?$`, 'iu'),
  new RegExp(`^${VERB}${TITLE} on (?<startDate>${DATE}) from (?<start>${TIME}) (?:to|until) `
    + `(?<endDate>${DATE}) (?<end>${TIME}) (?:in )?(?<zone>${ZONE})`
    + `(?: (?:on|in) (?:my |the )?(?<selector>.+?) calendar)?${FIELDS}[.!?]?$`, 'iu'),
];

function civilDate(text: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text;
  const match = /^([A-Za-z]+) (\d{1,2}),? (\d{4})$/u.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLocaleLowerCase('en-US')) + 1;
  return month ? `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}` : null;
}

function wallTime(text: string): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/iu.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function hasFold(value: NonNullable<ReturnType<typeof parseCalendarTimestamp>>, zone: string): boolean {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const wall = (at: number) => {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(at))
      .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const utc = new Date(0);
    utc.setUTCFullYear(fields.year, fields.month - 1, fields.day);
    utc.setUTCHours(fields.hour, fields.minute, fields.second, 0);
    return utc.getTime();
  };
  const at = Number(value.epochSeconds * 1000n);
  const requestedWall = wall(at);
  // ponytail: at most 2879 minute-offset candidates per endpoint (the admitted
  // RFC3339 offset range); use a verified timezone-transition primitive if profiling requires it.
  for (let minutes = -1439; minutes <= 1439; minutes += 1) {
    const alternate = requestedWall - minutes * 60000;
    if (alternate !== at && wall(alternate) === requestedWall) return true;
  }
  return false;
}

export function readCalendarIntent(message: MessageRecord, attempt: AttemptRecord,
  candidate: CalendarCreateInput, trustedTimeZone: string): IntentInterpretation {
  if (message.role !== 'user' || message.visibility === 'internal' || message.completionStatus !== 'accepted'
    || message.userId !== attempt.userId || message.sessionId !== attempt.sessionId
    || message.turnId !== attempt.turnId || message.messageId !== attempt.causal.userMessageId) {
    return { outcome: 'not-authorized' };
  }
  const content = message.content.trim();
  const match = patterns.map(pattern => pattern.exec(content)).find(Boolean);
  if (!match?.groups) return { outcome: 'not-authorized' };
  const fields = match.groups;
  const title = fields.summary.replace(/^"([^"]+)"$/u, '$1');
  if (fields.selector && fields.selector.length > 1024) return { outcome: 'details', missing: ['target'] };
  // Reject unsupported requested effects rather than silently dropping them.
  if (/\b(?:with attendees|invite attendees|recurring|every (?:day|week|month)|all[- ]day)\b/iu.test(content)) {
    return { outcome: 'not-authorized' };
  }
  try { validateCalendarCall({ name: 'calendar_create_event', arguments: candidate }); }
  catch { return { outcome: 'details', missing: ['date', 'start', 'end', 'timeZone'] }; }
  const start = parseCalendarTimestamp(candidate.start);
  const end = parseCalendarTimestamp(candidate.end);
  const date = fields.date ? civilDate(fields.date) : null;
  const civil = (value: NonNullable<typeof start>) => `${String(value.year).padStart(4, '0')}`
    + `-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
  const time = (value: NonNullable<typeof start>) => `${String(value.hour).padStart(2, '0')}`
    + `:${String(value.minute).padStart(2, '0')}`;
  const zone = fields.zone.toLocaleLowerCase('en-US') === 'my configured time zone'
    ? trustedTimeZone : fields.zone;
  if (zone !== candidate.timeZone) return { outcome: 'details', missing: ['timeZone'] };
  const explicitStart = fields.startStamp ? parseCalendarTimestamp(fields.startStamp) : null;
  const explicitEnd = fields.endStamp ? parseCalendarTimestamp(fields.endStamp) : null;
  const timesMatch = start !== null && end !== null && (fields.startStamp
    ? explicitStart !== null && explicitEnd !== null
      && compareCalendarTimes(explicitStart, start) === 0 && compareCalendarTimes(explicitEnd, end) === 0
    : civil(start) === (fields.startDate ? civilDate(fields.startDate) : date)
      && civil(end) === (fields.endDate ? civilDate(fields.endDate) : date)
      && time(start) === wallTime(fields.start) && time(end) === wallTime(fields.end)
      && start.second === 0 && end.second === 0 && /^0*$/u.test(start.fraction) && /^0*$/u.test(end.fraction)
      && !hasFold(start, zone) && !hasFold(end, zone));
  if (!timesMatch || zone !== candidate.timeZone || title !== candidate.summary
    || (fields.description ?? undefined) !== candidate.description
    || (fields.location ?? undefined) !== candidate.location) {
    return { outcome: 'details', missing: ['summary', 'date', 'start', 'end', 'timeZone'] };
  }
  const { calendarId: untrustedSelector, ...action } = candidate;
  void untrustedSelector;
  return { outcome: 'complete', intent: {
    intentId: key('calendar-intent', message.userId, message.sessionId, message.messageId),
    originatingTurnId: message.turnId, originatingAcceptedMessageId: message.messageId,
    originatingAttemptId: attempt.attemptId, action, selector: fields.selector?.trim() ?? null,
  } };
}
```

Also import the existing `compareCalendarTimes`. Cover explicit RFC3339 fractions/offsets, equivalent zero fractions, and two-explicit-date overnight forms with tests. Local minute-precision forms reject DST folds rather than trusting the model's chosen offset; explicit RFC3339 offsets can disambiguate them. The fold search uses the exact finite minute-offset range already admitted by `parseCalendarTimestamp`, not a one-hour assumption (include Lord Howe's half-hour fold). Missing/unsupported wording falls back to a bounded human details question (using I5 when continuing across turns), not a statement that the user already approved the candidate. Do not add language-model confidence, fuzzy aliases or inferred fields to widen this gate.

```typescript
export function canonicalCalendarAction(action: CalendarCreateInput,
  target: CalendarResolvedTarget): CalendarCreateInput {
  if (action.calendarId !== undefined && action.calendarId !== target.calendarId) {
    throw new AppError('INVALID_REQUEST', 'The calendar selection needs clarification.', false);
  }
  const canonical = calendarInputSchemas.calendar_create_event.parse({ ...action, calendarId: target.calendarId });
  validateCalendarCall({ name: 'calendar_create_event', arguments: canonical });
  return canonical;
}
```

For named selectors, call this helper **after** comparing/resolving the model selector to the accepted selector and replacing it with the canonical ID. A name or `'primary'` is not passed here as though it were already canonical. Missing description/location in accepted intent means absent, not model-invented. An explicit unsupported attendee/recurrence/all-day/invitation/update/delete request is denied/clarified as unsupported; do not silently create a simpler event. Add the bounded-parser ceiling comment: `ponytail: deterministic scheduling grammar only; unrecognized wording clarifies, upgrade through a separately approved intent contract rather than inferred consent.`

- [ ] **Preserve identity without similarity deduplication.** Compute `intentId = key('calendar-intent', userId, sessionId, message.messageId)` and deterministic operation ID from that intent. Retry of the accepted message reuses it; identical text in a new accepted message does not. Do not use `attemptId` as originating intent identity because retry creates another attempt. Keep originating attempt as provenance only. For an active details proposal after I5, merge only explicitly supplied missing fields from its bounded accepted-message references; reject contradictory/repeated values, keep omitted fields missing, validate complete action before hashing, and never revive an expired proposal from transcript text.
- [ ] **Run green:** `npm test -- test/runtime/calendar-intent.spec.ts`. Add internal/live/assistant input rejection, mismatched causal ID, altered summary/time/zone/location, unknown explicit target, two dates/times, nonexistent date, absent duration, ambiguous timezone/DST and unsupported features. Add new-accepted-identical-text → different intent and retry → same intent assertions.
- [ ] **Commit:** `git commit -m "feat(calendar): bind natural scheduling intent to canonical actions"` with only Task 2 files staged.

## Task 3: Resolve action targets through the current capability gate and clarify honestly

**Files:** modify `backend/src/chat-runtime/calendar-loop.ts`, `calendar-operation.ts`; create `backend/test/runtime/calendar-targeting.spec.ts`; extend `backend/test/runtime/calendar-multi-fixture.ts` and existing runtime fixture controls.

- [ ] **Write failing precedence and no-fallback tests.** Fixture `runCreate(h, content, action)` is exactly `const ids = await h.submit(content); h.modelWires.push(createWire(action,'create-one'),textWire('Created.')); await h.execute(ids); return ids;` in this spec; seed complete-clear availability through the fake provider before running.

```typescript
it('uses explicit target before saved default and primary', async () => {
  const h = calendarFixture();
  try {
    await h.setDefault('personal@example.test');
    const ids = await runCreate(h,
      'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.', event());
    expect(await h.operationFor(ids)).toMatchObject({ calendarId: 'team@example.test',
      action: { calendarId: 'team@example.test' } });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('does not replace an unknown explicit target or a lost default with primary', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Missing calendar.');
    h.modelWires.push(createWire(event(), 'create-one'));
    await h.execute(ids);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    expect(await h.operationFor(ids)).toBeNull();
    expect(h.frames.some(frame => frame.event.type === 'calendar-clarification')).toBe(true);
  } finally { await h.dispose(); }
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-targeting.spec.ts`. Expected: old pinned binding/JSON gate or absent clarification cannot satisfy these assertions.
- [ ] **Implement one runtime resolution seam.** Use `calendar.capabilities.resolve({ account, selector: intent.selector, operation:'create', signal, deadlineAt:budget.deadlineAt, consumeRequest:kind=>ledger.chargeCalendarRequest(kind), consumeRefreshRequest:()=>ledger.chargeRefreshRequest() })`. For read tools use `operation:'read'`, preserving the actual accepted explicit selector or a validated current proposal; do not use create rights as read rights. A model calendar ID is a selector within the current account, never identity. If both model and user name/ID resolve, require equal canonical IDs before invoking. If user explicitly names a calendar but the model omits it, preserve the user's selector. If user has no selector but the model invents one, resolve server default/primary and reject a differing invented target.

```typescript
const resolved = await this.ctx.calendar.capabilities.resolve({
  account: this.ctx.account,
  selector,
  operation,
  signal: this.ctx.job.signal,
  deadlineAt: (await this.ctx.ledger.ensureBudget()).deadlineAt,
  consumeRequest: kind => this.ctx.ledger.chargeCalendarRequest(kind),
  consumeRefreshRequest: () => this.ctx.ledger.chargeRefreshRequest(),
});
```

This replaces target selection based on `ctx.binding.calendarId`; `ctx.account` is captured by `currentAccount()` and checked with `requireAccountCurrent`. It does not remove the per-dispatch account fence. Resolved `selectedBy` is provenance; after a valid choice, keep its canonical target with `selectedBy:'proposal'`.
- [ ] **Add bounded safe clarification rendering.** Unique normalized exact names resolve directly; duplicate names display ≤20 candidates with role and safe account-local canonical ID distinguishing identical labels. Strip control characters for display, treat labels as untrusted data, use no raw provider errors, HTML, credentials, connection IDs, revisions or operation IDs in prose. Unknown/fuzzy/partial matches ask for the actual calendar name; do not guess aliases. Denied/read-only explicit target and invalid saved default produce a useful choose/reset question, not an overridable warning. Missing primary asks; multiplicity alone does not. If candidates exceed byte/message caps, return fewer displayed choices with an explicit bounded-list limitation; never consume a choice not actually disclosed. Task 4 persists selection candidates before any protocol-3 clarification frame.
- [ ] **Run green:** `npm test -- test/runtime/calendar-targeting.spec.ts`. Add primary default without override; valid saved override; clear override; 100 calendars; duplicate Work labels; unknown/fuzzy name; normalized case/space/ordinary “my … calendar” wording; primary alias canonicalization after email rename; partial snapshot with no primary; hidden/deleted/read-only target; reader read allowed/freeBusyReader details denied; model ID cannot erase an explicit missing target. Assert no create/credentials on denial, no JSON-copy prompt, and no calendar-choice question for an otherwise clear default request.
- [ ] **Commit:** `git commit -m "feat(calendar): resolve conversational targets without silent fallback"` with named Task 3 files.

## Task 4: Persist bounded proposals and derive replies only from accepted user content

**Files:** create `backend/src/chat-runtime/calendar-authority.ts`; create `backend/test/runtime/calendar-authority.spec.ts`; modify `backend/test/runtime/calendar-multi-fixture.ts`, runtime fixture. **Prerequisite:** I1/I4/I5 owner amendments for their affected cases.

- [ ] **Write the failing expiry/selection/replay tests.** Fixture helper `disclose(h, content, action)` submits content, scripts one create tool, executes to a completed clarification, and returns `{ids, proposal: await h.currentProposal(ids.sessionId)}` with a non-null check. `h.reply(proposal, text, sessionId)` calls normal submit with the automatically attached ratified causal proposal reference, never an approval Boolean. It does not inject authority into model arguments.

```typescript
it('binds a natural choice to one current proposal and its originating intent', async () => {
  const h = calendarFixture();
  try {
    await h.setDiscovery({ duplicateWorkNames: true });
    const first = await disclose(h,
      'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.', event());
    expect(first.proposal).toMatchObject({ purpose: 'selection', state: 'pending',
      originatingTurnId: first.ids.turnId, originatingAcceptedMessageId: first.ids.userMessageId });
    expect(Date.parse(first.proposal.expiresAt) - Date.parse(first.proposal.createdAt)).toBeLessThanOrEqual(600000);
    const reply = await h.reply(first.proposal, 'Use the second one', first.ids.sessionId);
    h.modelWires.push(textWire('Created on the selected calendar.'));
    await h.execute(reply);
    const op = await h.operationFor(reply);
    expect(op).toMatchObject({ intentId: first.proposal.intentId,
      originatingAcceptedMessageId: first.ids.userMessageId, turnId: reply.turnId,
      authorization: { acceptedUserMessageId: reply.userMessageId, basis: 'proposal-selection' } });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('cannot reconstruct an expired proposal from a later yes or transcript', async () => {
  const h = calendarFixture();
  try {
    await h.setDiscovery({ duplicateWorkNames: true });
    const first = await disclose(h,
      'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.', event());
    h.advance(600000);
    const reply = await h.reply(first.proposal, 'Yes, use the second one', first.ids.sessionId);
    await h.execute(reply);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    expect((await h.proposalAuthority(first.proposal)).state).toBe('tombstone');
  } finally { await h.dispose(); }
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-authority.spec.ts`. Expected: missing durable runtime authority; an interface-gap failure stays blocked until the owning amendment, not a mocked passing consumer.
- [ ] **Implement publication with the existing schemas and CAS.** Every proposal carries account/connection/subject, session, deterministic intent, origin accepted-message/turn/attempt, target or disclosed candidates, canonical complete action and candidate-specific hashes, discovery/availability revisions, fingerprint and disclosed limitations, retention policy/content expiry. Use the actual persisted discovery revision P4 returned. Hash candidate actions with each candidate's canonical ID; selection root hash stays null and root action omits calendar ID. Conflict has a target, complete canonical action, non-null hash/fingerprint and availability revision. Details use the ratified explicitly incomplete variant, not a fake canonical hash.

```typescript
const nowMs = clock();
const createdAt = new Date(nowMs).toISOString();
const contentExpiresAt = new Date(Math.min(discoveryRetentionAt,
  source ? Date.parse(source.expiresAt) : discoveryRetentionAt,
  auditDeadlineAt ? Date.parse(auditDeadlineAt) : Number.POSITIVE_INFINITY)).toISOString();
const previousExpiryAt = previous?.intentId === intent.intentId
  ? Date.parse(previous.expiresAt) : Number.POSITIVE_INFINITY;
const expiry = Math.min(nowMs + Math.min(limits.proposalLifetimeMs, 600000),
  Date.parse(contentExpiresAt), previousExpiryAt);
if (expiry <= nowMs) throw new AppError('NOT_READY', 'Calendar confirmation cannot be retained safely.', false);
const expiresAt = new Date(expiry).toISOString();
```

`previous` is the actual prior same-intent pending/consumed proposal loaded through I1, not an arbitrary caller timestamp. A source with volatile/expired/redacted content cannot create a durable content-bearing conflict proposal; fail closed with “Please refresh and try again” and zero effect, without silently persisting private event data. Disclosure may not extend the source/cache/privacy expiry. Reuse a pending identical proposal without extending `createdAt/expiresAt`; replacing a material event/target/condition gets a new deterministic proposal ID, original lifetime ceiling, and CAS supersession. Same-intent multi-stage selection/conflict proposals share one fixed operation identity and do not silently restart that authority clock. A newly accepted explicit materially edited event is a **new intent**, linked through the accepted transcript; old proposal is superseded, never patched into authority for different parameters.
- [ ] **Implement `readCalendarReply` as bounded deterministic interpretation.** Normalize surrounding whitespace/case and terminal punctuation. Accept affirmative phrases only in the unique current conflict/details-complete context (`yes`, `yes please`, `go ahead`, `create it anyway`, `I accept the conflict`, `I accept the incomplete coverage`). Cancellation recognizes `no`, `cancel`, `don't create it`, `stop`. Selection recognizes an exact disclosed unique label/ID or ordinal (`the second one`, `use 2`); a generic yes cannot choose between duplicate calendars. Mixed “yes, but make it 11”/different target/time/summary is an edit, not acceptance. Quoted affirmation, event content, system/model text and model flags never become a reply. “Yes” to a coverage proposal is usable only when the durable displayed question explicitly asks whether to accept that exact limitation; no default affirmative guessed from sentiment.

```typescript
const normalized = content.trim().toLocaleLowerCase('en-US').replace(/[.!?]+$/u, '').trim();
if (/^(?:no|cancel|stop|do not create it|don't create it)$/u.test(normalized)) {
  return { decision: 'cancel', choiceCalendarId: null };
}
if (proposal.purpose !== 'selection'
  && /^(?:yes(?:,? (?:please|go ahead))?|go ahead|create it anyway|i accept the conflict|i accept the incomplete coverage)$/u.test(normalized)) {
  return { decision: 'accept', choiceCalendarId: null };
}
```

Keep select/ambiguous/edit/unrelated returns explicit. Test punctuation variants do not accidentally turn a question/conditional into approval. Short replies with no valid current causal proposal reference ask, never dispatch. Check the expected proposal ID/revision against current slot **before** reading reply content as authority; server-generated accepted-message/turn/time populate `CalendarProposalReply`, not request-provided identity/timestamps/hash.
- [ ] **Implement consumption/tombstones.** Recheck current account and same scoped accepted-message causal binding, read the proposal under the held session lease, reject `now >= min(expiresAt,contentExpiresAt)`, and load actual accepted origin/reply records. Build trusted reply from parsed choice/hash/fingerprint; use `proposalMatchesReply` and `calendarProposals.consume`. Only `consumed` or a matching `existing` supplies the one fixed operation ID; `uncertain` halts with zero create, `rejected` clarifies. Cancellation/expiry/supersession calls `tombstone` with expected revision, retains minimal causal deduplication and unresolved operation ID/hash, never deletes evidence or reconstructs expired consent. After consume-before-operation crash use I1 exact persisted reply/consumption, not latest “yes” from history. Never renew authority from an `existing` consumption returned after expiry.
- [ ] **Run green:** `npm test -- test/runtime/calendar-authority.spec.ts`. Add 600001-ms rejection, exact expiry, lower configured TTL, multibyte 16-KiB cap, source deadline earlier than TTL, same-session wrong proposal/revision, cross-session, cross-account/reconnect, two competing choices, stale-tab superseded yes, replay after consumption/tombstone, malformed client reference, no reference ambiguity, ≥9 details references, model `confirmed:true` schema denial, edit supersession and no raw provider errors/secrets. Assert one pending/session and one operation/intent.
- [ ] **Commit:** `git commit -m "feat(calendar): persist single-use cross-turn proposal authority"` with only Task 4 files.

## Task 5: Enforce server preflight and compare disclosed conflicts plus coverage

**Files:** create `backend/src/chat-runtime/calendar-preflight.ts`, `backend/test/runtime/calendar-preflight.spec.ts`; modify `calendar-operation.ts`, `calendar-authority.ts` and the runtime fixture for the preflight controls.

- [ ] **Write failing direct-create bypass and material recheck tests.** `busy(start,end)` in the fixture produces a schema-valid provider freeBusy interval; `setAvailability` controls the provider response, not an approval flag. `clearAvailability()` restores complete discovery + per-calendar ok coverage.

```typescript
it('pauses direct model create on incomplete coverage even with no availability tool call', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ calendarErrors: { 'read@example.test': 'notFound' }, busy: [] });
    const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
    h.modelWires.push(createWire(event(), 'direct-create'));
    await h.execute(ids);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
    expect(await h.currentProposal(ids.sessionId)).toMatchObject({ purpose: 'conflict',
      disclosedLimitations: expect.arrayContaining(['calendar-error']) });
    expect(h.requestKinds).toContain('preflight');
    const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ logicalTools: 1, creates: 0 });
  } finally { await h.dispose(); }
});

it('accepts an unchanged disclosed condition but re-asks for a new coverage limitation', async () => {
  const first = availability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
  const reread = availability({ ...first, availabilityRevision: first.availabilityRevision + 1,
    discoveryRevision: first.discoveryRevision + 1, checkedAt: '2026-10-24T10:01:00.000Z',
    expiresAt: '2026-10-24T10:06:00.000Z' });
  expect(calendarAvailabilityFingerprint(reread)).toBe(calendarAvailabilityFingerprint(first));
  const changed = availability({ ...reread, coverage: 'incomplete', free: [],
    calendars: reread.calendars.map((entry, index) => index ? entry : { ...entry, status: 'error', reason: 'not-found' }),
    limitations: ['calendar-error'] });
  expect(calendarAvailabilityFingerprint(changed)).not.toBe(calendarAvailabilityFingerprint(first));
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-preflight.spec.ts`. Expected: current admission reaches create without mandatory availability or does not produce the durable proposal.
- [ ] **Implement preflight through existing v2 MCP execution.** For the exact canonical event range invoke `calendar_check_availability` with **no `calendarIds` selector**, server account, null target/operation, linked 20-second/remaining-total signal, stable server-internal tool call ID, same decision/attempt/user/deadline attribution, and counted callbacks. This is a real internal server check, not another model-requested tool: do not increment `logicalTools`, modelDispatches, repairs, or creates. Reclassify its availability deliveries as `preflight`; preserve discovery/capability/readback categories. Persist its source/result in v2 evidence with `operationId:null`, and link source to the originating decision/proposal; do not fabricate a native model tool call for it.

```typescript
const checked = await execution.invoke({
  binding: { ...account, target: null, operation: null, sessionId, turnId, attemptId,
    decisionId: input.decisionId,
    toolCallId: key('calendar-preflight', input.intentId, turnId, input.stage),
    schemaRevision: CALENDAR_TOOL_REVISION, trustedNow: now(), trustedTimeZone,
    deadlineAt: (await ledger.ensureBudget()).deadlineAt },
  call: { name: 'calendar_check_availability', arguments: {
    timeMin: input.action.start, timeMax: input.action.end, timeZone: input.action.timeZone,
  } },
  signal: job.signal,
  consumeRequest: kind => ledger.chargeCalendarRequest(kind === 'availability' ? 'preflight' : kind),
  consumeRefreshRequest: () => ledger.chargeRefreshRequest(),
});
if (checked.outcome !== 'success' || checked.result.tool !== 'calendar_check_availability') {
  throw new AppError('NOT_READY', 'Calendar availability could not be verified.', false);
}
const result = calendarAvailabilityResultSchema.parse(checked.result);
```

The internal result ID is used once for the specified accepted-turn stage. A failed/uncertain stage is not silently re-invoked with that identity; recovery loads saved evidence or interrupts under Task 9. If an owner amendment provides a stronger persistent availability revision, use it; never invent an in-memory monotonic counter. Validate result/source account revision, actual range/timezone, calendar-set/discovery/availability provenance, expiry and target membership before using it. A failed tool does not mean free. For bounded provider incomplete results, persist/disclose their limitations; for no usable bounded result, explain availability unavailable and make zero creates, not a manufactured all-clear/fingerprint.
- [ ] **Add material acceptance comparison.** `requiresAcceptance = result.conflict !== 'clear' || result.coverage !== 'complete' || result.truncated || result.limitations.length > 0`. Fingerprint via the existing helper, with the constant semantics disclosed in the question: Google opaque busy only; transparent events (including common all-day entries), declined/cancelled events, working hours/nights/weekends are not covered. These intrinsic semantics do not falsely convert every complete scan into incomplete coverage; dynamic missing calendars/errors/limits do. Compare canonical event hash + target/account identity + calendar-set hash + coverage/conflict fingerprint. Mere discovery/availability revision, checkedAt, ordering or label refresh does not require another approval. New busy interval, changed error/reason/limit, newly discovered/removed calendar, different target/time/zone/account, expiry or rights loss does. If accepted conflict disappears and coverage is complete, it is safe to proceed without asking again; if coverage/conflict **changes to another warning**, renew the proposal. Never use acceptance to override missing create rights.

```typescript
const currentFingerprint = calendarAvailabilityFingerprint(result);
const sameApprovedCondition = proposal !== null
  && proposal.canonicalActionHash === calendarActionHash(action)
  && proposal.target?.calendarId === target.calendarId
  && proposal.connectionId === target.connectionId
  && proposal.connectionRevision === target.connectionRevision
  && proposal.googleSubjectId === target.googleSubjectId
  && proposal.conditionFingerprint === currentFingerprint;
```

- [ ] **Require a fresh final check inside the shared operation writer before an undispatched create.** Inject `CalendarPreflight` into `CalendarOperationWriter`; its create entry point itself invokes the final check, so a caller cannot bypass it by handing the writer a schema-valid but invented availability object. Initial loop checks are disclosure evidence, not a substitute. Revalidate target with exact canonical ID/current capability gate; never resolve the latest default for an already selected proposal. Run final availability after selection/approval, using the remaining same accepted-turn deadline/request budget. No human approval exists for a changed final condition: persist/emit a replacement proposal and halt. If an existing operation is `dispatching/unknown/succeeded`, return its recovery/publication path **before** new capability/preflight work that could trigger a new write. Google's read/insert gap remains non-atomic; do not claim reservation or clash prevention.

For a **direct, still-unresolved** implicit saved-default/primary request that has no durable selected proposal or operation, resolve with `selector:null` again before final preflight and compare canonical target/current capabilities. If the effective default changed, clarify and disclose the target instead of silently writing the old or new calendar. Once a current user-selected/disclosed proposal or operation pins a concrete target, default changes affect future unresolved requests only; recheck that pinned ID's rights without consulting the new preference. Add both sides of this distinction to the race tests.
- [ ] **Run green:** `npm test -- test/runtime/calendar-preflight.spec.ts`. Add fresh clear → create, direct-create omission, model subset scan ignored, conflict → zero effect, incomplete clear-looking HTTP-200 errors → zero effect, unchanged approval → one create, changed busy/set/error/limit → new proposal, warning disappears → create, no automatic retry on unavailable result, stale/revoked target never overridable, 51/100 calendars counted in ≤2 ≤50 batches, lower request/deadline budget blocks before request, interval/byte truncation never all-clear, transparent event semantic disclosure and no private title leakage.
- [ ] **Commit:** `git commit -m "feat(calendar): enforce preflight and material conflict rechecks"` with only Task 5 files.

## Task 6: Admit one immutable v2 operation per accepted intent

**Files:** modify `backend/src/chat-runtime/calendar-operation.ts`, `calendar-authority.ts`, `calendar-budget.ts`; modify `backend/test/runtime/calendar-operation.spec.ts`, add admission cases to `calendar-authority.spec.ts`. **Prerequisite:** I1/I2/I3 ratified/committed.

- [ ] **Write the failing causal-operation and race tests.** Replace the old “only canonical self-contained request” expectation; retain a negative test proving action mismatch still fails.

```typescript
it('links a conflict reply to the original accepted intent and one operation', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
    const first = await disclose(h, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', event());
    const reply = await h.reply(first.proposal, 'Yes, go ahead', first.ids.sessionId);
    h.modelWires.push(textWire('Created despite the disclosed conflict.'));
    await h.execute(reply);
    const op = await h.operationFor(reply);
    expect(op).toMatchObject({ schemaVersion: 2, intentId: first.proposal.intentId,
      originatingTurnId: first.ids.turnId, originatingAcceptedMessageId: first.ids.userMessageId,
      turnId: reply.turnId, state: 'succeeded', authorization: { basis: 'conflict-acceptance',
        acceptedTurnId: reply.turnId, acceptedUserMessageId: reply.userMessageId,
        canonicalActionHash: op!.requestHash, conditionFingerprint: first.proposal.conditionFingerprint } });
    expect(op!.googleEventId).toBe(calendarEventId(op!.operationId));
    expect(h.order.indexOf('operation-dispatch-event')).toBeLessThan(h.order.indexOf('google-create'));
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-operation.spec.ts`. Expected: v1/turn-only writer or missing durable consumption linkage fails.
- [ ] **Replace the shared `authorizeCreate` seam, tracing every caller.** Repository-root search: `rg "authorizeCreate|canonicalCreateRequest|admitCreate|\.invoke\(" backend/src/chat-runtime backend/test/runtime`. Remove canonical-JSON-only authorization from active runtime and update its runtime tests; do not keep an alternate public writer method that bypasses intent/preflight. Expose one `CalendarOperationWriter.executeCreate` entry point receiving validated accepted intent + resolved target + actual accepted message + final consumed proposal evidence (or null for an actual explicit no-warning request). Make admission/low-level create invoke private; this entry point itself calls fresh capability/preflight checks, reserves/confirms dispatch, invokes once, and returns either clarification, the newly completed execution result, or an existing/unknown operation for recovery/publication. It independently verifies accepted message identity/content, complete canonical action hash and minimal-evidence permission; neither a direct caller nor a model `confirmed` flag bypasses those checks. The private invoke is reached only after this invocation newly wins and confirms the dispatch CAS/event, under the held lease/fence and current same account. Returning an existing dispatching record is **never** a fresh dispatch permit. A process crash loses any local permission to invoke; recovery must inspect durable state and reconcile. Runtime fixed instructions belong to P8, not this task.
- [ ] **Construct the v2 operation correctly.** Fix operation ID from original intent and canonical event ID from that operation ID. Set `turnId` to the accepted direct/approval turn, `authorization.acceptedTurnId` to the same turn, retain original turn/message/attempt provenance separately, and keep `schemaRevision:CALENDAR_TOOL_REVISION`, `proofRevision:CALENDAR_PROOF_REVISION`. Store canonical `action.calendarId`, full canonical hash and fresh discovery revision. Use `basis:'explicit-request'`/`'proposal-selection'`/`'conflict-acceptance'` and exact consumed proposal ID/fingerprint as applicable. No operation reservation follows an initial selection until any required final conflict acceptance is known. Default changes do not edit a reserved action or connection revision.

```typescript
const operationId = key('calendar-operation', identity.userId, identity.sessionId, intent.intentId);
const requestHash = calendarActionHash(action);
const authority = {
  acceptedUserMessageId: accepted.messageId,
  acceptedTurnId: accepted.turnId,
  canonicalActionHash: requestHash,
  approvedAt: accepted.createdAt,
  basis,
  proposalId: proposal?.proposalId ?? null,
  conditionFingerprint: basis === 'conflict-acceptance' ? proposal!.conditionFingerprint : null,
};
```

`basis` is derived by the writer from verified evidence, not passed from the model. An operation label needs valid retained supporting `actionSources` that contain that calendar label and expire after the label deadline. If no such source exists, write `calendarLabel:null,labelExpiresAt:null`; do not fabricate provenance simply to show a badge. Clamp audit to configured source/30-day limit; unresolved deduplication survives content expiry.

For a direct request with no pending proposal, also require `clock() < Date.parse(accepted.createdAt) + Math.min(limits.proposalLifetimeMs, 600000)` and the original turn deadline. This does not add a redundant user confirmation; it prevents unusually delayed execution from turning an old accepted sentence into indefinite authority.
- [ ] **Reserve/transition with confirmed evidence only.** Read `getByIntent` before charging/reserving; exact existing operation returns its state and never dispatches again merely because it was returned as “authorized”. Verify all immutable authority, including account/target/hash. Charge logical create once through I3, `reserveByIntent({operation,consumption})`, confirm planned/event, final lease/account/deadline check, CAS to dispatching and append/confirm v2 event, then allow one invoke. Ambiguous CAS/event ACK requires exact reread; unavailable confirmation → halt. The transition helper uses v2 CAS and ratified v2 event ports and preserves immutable authority. Do not swallow receipt/event persistence errors as model failures.
- [ ] **Classify outcomes without replay.** Success requires matching durable receipt then succeeded event. A pre-dispatch rejection can be failed/cancelled with useful user failure. Post-dispatch transport/persistence/cancel uncertainty is `unknown`; preserve original action/target/event and quarantine. In this phase no automatic v2 insert retry is introduced, including the old delivery-same-ID runtime path; Google create remains non-retryable. Known terminal provider rejection becomes definitely-failed only with definite evidence. Do not imply cancellation prevented billing/effect.
- [ ] **Run green:** `npm test -- test/runtime/calendar-operation.spec.ts test/runtime/calendar-authority.spec.ts`. Include direct explicit natural request/no JSON prompt; wrong hash/target/event/account/intent; selection→conflict same operation ID; consumed ACK loss; competing reserve; repeated same approval; new accepted identical text new intent; denial before operation; event-ACK loss blocks dispatch; no `unknown→dispatching`; no operation before final consent; right/setting changes during reserve and target-label retention limits.
- [ ] **Commit:** `git commit -m "feat(calendar): reserve intent-pinned v2 operations after authority checks"` with named Task 6 files.

## Task 7: Integrate reply/clarification flows and complete tool groups into the loop

**Files:** modify `backend/src/chat-runtime/calendar-loop.ts`, necessary Calendar sections of `durable-chat-runtime.ts`, `calendar-ports.ts`; modify `backend/test/runtime/calendar-loop.spec.ts`, `calendar-logical-tools.spec.ts`, `calendar-lifecycle.spec.ts`, `calendar-targeting.spec.ts`.

- [ ] **Write the failing no-extra-model/complete-group tests.** An accepted short reply is resolved from stored proposal, not by asking the model to reproduce event details. Fixtures must not silently queue a second create for the reply.

```typescript
it('uses the stored event on yes and returns a matched create result before narration', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
    const first = await disclose(h, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', event());
    const priorDispatches = h.modelBodies.length;
    const reply = await h.reply(first.proposal, 'Go ahead', first.ids.sessionId);
    h.modelWires.push(textWire('Created despite the disclosed conflict.'));
    await h.execute(reply);
    expect(h.modelBodies).toHaveLength(priorDispatches + 1);
    const messages = h.modelBodies.at(-1)!.messages as NativeCalendarModelMessage[];
    expect(messages.filter(m => m.role === 'user' && m.content === 'Go ahead')).toHaveLength(1);
    expect(messages.some(m => m.role === 'tool' && m.name === 'calendar_create_event')).toBe(true);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-loop.spec.ts test/runtime/calendar-logical-tools.spec.ts`. Expected: no cross-turn handler and no matched create tool group in the current loop.
- [ ] **Prepare a reply before fresh inference.** Load the unique current/accepted causal proposal in `runCalendarTurn` under the existing session lease after durable acceptance. `CalendarLoop.prepare` interprets it, restores stored action/candidates, and routes selection/conflict/details/cancel accordingly. A yes never authorizes a different new model call. An unrelated message produces ordinary Calendar-capable text with no effect; it cannot consume the proposal. Material edits supersede, keep original causal evidence, and use new accepted intent. Missing details can progress using I5 bounded accepted-message references without copying old user input into context again. Keep one active attempt/session and local executor ownership.
- [ ] **Persist/emit clarification before sealing.** Publish proposal CAS first, validate protocol-3 `calendar-clarification`, then seal a concise assistant message from the exact saved proposal. Prompt ≤1000 chars shows target (or distinct candidates), event summary/date/time/timezone, busy intervals or exact incomplete coverage reason, and explicit proceed/change-time choice. No operation ID/credential/internal revision/JSON-copy instructions. If result interval/list text exceeds the cap, render a bounded explicit summary without omitting that coverage is incomplete. The persisted proposal retains the exact fingerprint of the disclosed bounded condition. If proposal persistence/terminal publication fails, it is not an accepted confirmation question; retry/recovery republishes exact saved evidence without Google/model replay.
- [ ] **Integrate event reads/list/get with target authority.** Resolve/read rights independently per call, including `get_event.calendarId`, build v2 execution binding with trusted target, and keep cursor/event provenance matched. Unknown/ambiguous/unauthorized selectors return useful bounded clarification rather than `PROVIDER_ERROR`. Do not persist create-style approval for ordinary reads or turn a prior successful read into approval. Calendar names/results stay untrusted data.
- [ ] **Always add a matched result group for model-requested calls.** Reuse one private `recordResult(decision, invoked)` helper in `calendar-loop.ts` for list/get/discovery/availability and **create**. Persist v2 source + resultRef, register retention, then append `completeToolGroupV2Schema` with the original assistant call, matching result/tool ID/name and sources. Retained results may restore; volatile results exist only in current loop and store references, never content. Internal preflight is evidence, not a fake model-requested group. For server-resumed create on a valid accepted proposal, load the original saved create decision: list ≤8 original-turn dispatches through the existing accounting port, load their decisions, and require exactly one v2 create matching the stored proposal's material event. Keep its original decision/tool-call identity and origin as causal evidence; do not rewrite its saved turn/attempt or fabricate a new paid model dispatch. Execute using the approving turn/attempt/operation binding and validated canonical target; store the actual result under the original call ID with the approving turn's execution attribution, then supply the original matched assistant/result pair to narration. I3 debits this continuation once in the approving turn, keyed by original decision plus intent. If original decision evidence is missing/expired, preserve pending intent/receipt but stop—no new create synthesized from a naked yes. If upstream validation disallows this explicit lineage, report a P1/P2 interface gap rather than casting or impersonating a new model decision.

```typescript
const group = completeToolGroupV2Schema.parse({
  assistant: { role: 'assistant', content: null, tool_calls: [{ id: decision.toolCallId,
    type: 'function', function: { name: decision.call.name, arguments: JSON.stringify(decision.call.arguments) } }] },
  result: { role: 'tool', tool_call_id: decision.toolCallId, name: decision.call.name,
    content: JSON.stringify(invoked.result) },
  sources: [invoked.source],
});
```

Use v2 decision/result schemas, constant revision, intent/proposal/operation refs and actual source IDs. Never pass new v2 source data through the legacy group schema. For a clarification with no effect do not invent a success result; seal the real clarification and record its pending proposal reference. Structural repair still uses the last valid complete boundary, never repaired target/account/approval authority. All attempted model calls remain attributed/charged under the same budget.
- [ ] **Run green:** `npm test -- test/runtime/calendar-loop.spec.ts test/runtime/calendar-logical-tools.spec.ts test/runtime/calendar-lifecycle.spec.ts test/runtime/calendar-targeting.spec.ts`. Cover five tools; all three event target selectors; create result adjacency; short selection/yes/cancel; missing details completion; no JSON echo; source failure; malformed/forged flags; repair exhaustion; accepted input once across repair; no live-voice tools; ordinary text unaffected during Calendar outage. Assert exact logical count: server preflight/rechecks are HTTP counts, not additional model tools; a server-resumed single create still occupies exactly one logical action in its accepted approval turn under the ratified debit semantics.
- [ ] **Commit:** `git commit -m "feat(calendar): integrate durable replies and complete v2 tool groups"` with only Task 7 files.

## Task 8: Keep graph/context state reference-only and restore saved boundaries safely

**Files:** modify `backend/src/agent/state.ts`, `turn-graph.ts`, `backend/src/context/calendar-context.ts`, `backend/src/chat-runtime/calendar-ports.ts`, `calendar-loop.ts`; create `backend/test/runtime/calendar-graph.spec.ts`; modify `backend/test/context/calendar-context.spec.ts`.

- [ ] **Write failing checkpoint/context tests.** Add an explicit Calendar graph suite rather than editing unrelated generic graph tests.

```typescript
it('keeps v2 checkpoints reference-only and scoped to the accepted attempt', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde in my Work calendar');
    h.modelWires.push(nativeWire('{"eventId":"abcde","calendarId":"team@example.test"}'), textWire('Found it.'));
    await h.execute(ids);
    const saved = await h.calendarGraphState(ids.sessionId);
    expect(saved.values.calendarRefs).toMatchObject({ version: 2, userId: h.identity.userId,
      sessionId: ids.sessionId, turnId: ids.turnId, schemaRevision: 'google-calendar.v2' });
    expect(JSON.stringify(saved.values.calendarCursor)).not.toContain('Planning');
    expect(JSON.stringify(saved.values.calendarRefs)).not.toMatch(/accessToken|refreshToken|tool_calls/u);
  } finally { await h.dispose(); }
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-graph.spec.ts test/context/calendar-context.spec.ts`. Expected: v1-only cursor/refs and group parser fail v2 assertions.
- [ ] **Implement v2 reference channels, preserving legacy decode.** Keep existing v1 cursor/seal decoders read-only; add v2 runtime cursor with account fence, original total deadline/config revision, next state, pending decision/tool/operation/intent/proposal references and bounded repair reference. Remove default-dependent `targetRevision` from the account cursor authority; concrete target evidence lives in proposal/operation, not a latest-setting cursor. `calendarRefs` uses existing compatible checkpoint union, writes P1's `calendarCheckpointRefsV2Schema`. No event payloads, model tool calls, names, raw accepted text, availability arrays, tokens or private reasoning enter cursor/refs. Define the v2 seal's required narration reference now, instead of retaining an always-required fake final decision ID for a server clarification:

```typescript
export const calendarSealV2Schema = z.object({
  version: z.literal(2), input: graphInputSchema, base: boundarySchema,
  target: agentMemoryManifestSchema,
  narrationRef: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text-decision'), decisionId: idSchema }).strict(),
    z.object({ kind: z.literal('proposal-message'), proposalId: idSchema,
      proposalRevision: z.number().int().positive() }).strict(),
  ]),
  dispatchIds: z.array(idSchema).max(8).refine(ids => new Set(ids).size === ids.length),
  operationId: idSchema.nullable(), outcome: z.enum(['completed', 'truncated']),
  assistantCreatedAt: isoDateSchema,
}).strict();
```

Seal content is recoverable from saved retained decision/proposal evidence, not an in-memory `lastText`. Missing/expired narration evidence interrupts publication without losing a durable receipt or authorizing new inference. A no-effect cancellation uses the same saved proposal-message path with its confirmed cancellation state; a replay of a consumed proposal is not a new disclosure or a new action. Keep existing v1 seal schema in the compatible decoder; only v2 new writes execute.
- [ ] **Validate routing by cursor, not a new loop's default.** `prepare` routes a supplied verified `next:'execute'` to execute, `next:'seal'` to seal, otherwise decide; it does not always call `calendar_decide`. Pass restored cursor/refs into loop state, restore groups from persisted matching decisions/results before continuation, validate attempt/user/session/turn/config/account/versions and ensure source lifetime. A v1 pending tool is refused with legacy disposition, not converted to a v2 call. A sealed v2 matching accepted attempt goes straight to publication; never overwrite it by invoking a fresh initial Calendar state. Preserve ordinary text graph behavior and rebase ownership.

```typescript
.addConditionalEdges('prepare', state => {
  const cursor = state.calendarCursor ? calendarCursorSchema.parse(state.calendarCursor) : null;
  if (!cursor) return 'generate';
  if (cursor.version !== 2) throw new AppError('NOT_READY', 'Calendar work needs a fresh request.', false);
  return cursor.next === 'execute' ? 'calendar_execute'
    : cursor.next === 'seal' ? 'seal' : 'calendar_decide';
})
```

Here `calendarCursorSchema` becomes the compatible v1/v2 decoder; only version 2 is executable. Validate `calendarSeal.input.attempt.attemptId === state.input.attempt.attemptId` at the seal node, as the text seal already does. Preserve unique/bounded decision/tool refs and correct non-null operation ID; the current loop's always-null operation refs are not sufficient.
- [ ] **Migrate context groups without dropping history.** `CalendarContextInput.binding` becomes account authority; v2 groups use `completeToolGroupV2Schema`, verify all source account revisions and source targets versus result provenance, duplicate IDs, byte/message/token caps and expiry. Keep v1 groups only in explicit historical compatibility, never new execution. Reuse `rebuildCalendarMessages`; accepted current user occurs once, prior accepted input is already in selected transcript and is not appended again from a proposal. If adding bounded proposal data to model context, put a server statement distinguishing verified authority from JSON-encoded **untrusted** labels/event data; proposal data never grants new tool authority. Expired/redacted content and volatile results unavailable after restart interrupt instead of being re-fetched silently. Include whole groups or fail context budget—never drop half a pair or silently discard transcript.
- [ ] **Run green:** `npm test -- test/runtime/calendar-graph.spec.ts test/context/calendar-context.spec.ts`. Cover restored decide/execute/seal paths, mismatched attempt seal, v1 read-only checkpoint, forged account/proposal refs, >8 dispatch/>6 model-call refs, source expiry/volatile restore, v2 target provenance, duplicate call IDs, byte boundary/multibyte overflow, repaired groups, one accepted input, no orphan tool result, no private payload/credentials in graph and no silent history slicing.
- [ ] **Commit:** `git commit -m "feat(calendar): restore reference-only v2 graph and context boundaries"` with named Task 8 files.

## Task 9: Recover original decisions/results/operations without paid or write replay

**Files:** modify `backend/src/chat-runtime/calendar-recovery.ts`, `calendar-operation.ts`, `calendar-loop.ts`, necessary Calendar recovery/publication integration in `durable-chat-runtime.ts`; modify `backend/test/runtime/calendar-recovery.spec.ts`, `calendar-recovery-unavailable.spec.ts`; create `backend/test/runtime/calendar-multi-recovery.spec.ts`.

- [ ] **Write failing crash-window tests before implementation.** Extend failure injector with `proposal-save`, `proposal-consume`, `preflight-save`, `logical-debit`, `create-debit` and accepted-reply/dispatch-event windows, with before/after-commit modes. Each injection is one-shot and preserves store data across restart.

```typescript
it.each(['receipt-save', 'operation-event', 'checkpoint-seal', 'archive-save', 'manifest-save', 'terminal-cas'] as const)
('never inserts again after create around %s', async point => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.');
    h.modelWires.push(createWire(event(), 'create-one'), textWire('Created.'));
    if (point === 'operation-event') h.failOperationEvent('succeeded');
    else h.failOnce(point);
    await expect(h.execute(ids)).rejects.toBeDefined();
    const before = await h.operationFor(ids);
    const modelCount = h.modelBodies.length;
    const createCount = h.effects.filter(e => e.kind === 'create').length;
    await h.setDefault('personal@example.test');
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    expect(h.modelBodies).toHaveLength(modelCount);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(createCount);
    expect((await h.operationFor(ids))?.googleEventId).toBe(before?.googleEventId);
    expect(h.effects.filter(e => e.kind === 'readback').every(e => e.calendarId === 'team@example.test')).toBe(true);
  } finally { await h.dispose(); }
});
```

Add `failOperationEvent(state)` as a fixture control that selects the named durable transition event. Some other injected points occur before an actual create; test those with separate expected counts per point rather than claiming every injection reaches Google.

- [ ] **Run red:** `npm test -- test/runtime/calendar-multi-recovery.spec.ts test/runtime/calendar-recovery.spec.ts`. Expected: current reconciliation uses v1/default binding, no-op request accounting, or ignores Calendar seals.
- [ ] **Implement an explicit continuation classifier from durable evidence.** Decision saved and no tool effect → reuse exact decision under original remaining budget; saved complete retained result → rebuild group without re-invoking tool/model; consumed proposal and no operation → repair from exact I1 consumption only while its original authority remains live; planned operation → require same complete authority and fresh final capability/preflight before first dispatch, otherwise interrupt/clarify without changing immutable authorization; dispatching/unknown → original readback only; succeeded → receipt/group/publication; sealed → publication only. A model dispatch marked dispatched without saved terminal decision is inference-outcome-unknown: interrupt, do not regenerate automatically. Volatile/expired/missing result or lost consumption confirmation also interrupts, never reconstructs from free-form history.
- [ ] **Pin readback and charge it.** Build v2 account/target from the original operation and a freshly verified **explicit original ID** under the same subject/connection. Resolve no new default and never bind replacement account. If current role/account/connection unavailable, leave unknown with useful reconnect/reconciliation state while ordinary text recovery succeeds. Preserve original targetRevision/event/hash; current names are not durable receipt evidence. Use the original accepted turn's persisted budget/deadline and counted readback/refresh callbacks—replace the existing `async()=>undefined`. A later recovery job cannot extend deadline/reset counters; expired request budget yields unknown/unrun readback, not a hidden new allowance.

```typescript
if (operation.schemaVersion === 2 && ['dispatching', 'unknown'].includes(operation.state)) {
  // No availability/preflight/default selection or insert is reachable here.
  const outcome = await execution.readback({
    binding: originalBinding,
    operation,
    signal: job.signal,
    consumeRequest: kind => ledger.chargeCalendarRequest(kind),
    consumeRefreshRequest: () => ledger.chargeRefreshRequest(),
  }).catch(() => ({ outcome: 'unknown' as const }));
  if (outcome.outcome === 'matched') await writer.succeed(operation, outcome.receipt);
  else await writer.markUnknown(operation, outcome.outcome);
}
```

`originalBinding` is a parsed `calendarExecutionBindingV2Schema` built from the operation's exact identity, current same-ID capability proof and original turn/attempt attribution; `markUnknown` is a new writer method using the same confirmed v2 transition helper, recording bounded reconciliation outcome without replay permission. `absent/mismatch/unknown` are not success. Unknown stays unknown; never apply the v1 absent-readback retry state machine.
- [ ] **Repair nontransactional windows safely.** On reserve/transition/event ACK loss exact reread with immutable comparison decides whether progress happened. No evidence → no effect. If operation CAS succeeded but event append failed, append the same deterministic event after confirming exact current operation; only then project terminal receipt. If original operation is succeeded and create result persistence failed, reconstruct a matched result only from still-retained operation action + matched receipt/source/decision; otherwise preserve receipt and stop narration. After consumption/operation exists, repeated approval does not charge/create again. A crash before final consumption cannot invent acceptance; republish/question as needed. Determine pending operation from current graph intent/operation refs and scoped store lookup, not solely `session.latestTurnId`, since an unrelated later text reply must not hide an earlier unknown effect. If bounded session lookup is unavailable, report P2 port gap rather than scanning raw collections from runtime.
- [ ] **Keep v1 quarantine honest.** Decode old completed receipts as v1. Encountered nonterminal v1 operation/decision/checkpoint gets the frozen legacy disposition via P2, never a new v2 create or grant fabrication. Readback of a historically dispatched v1 operation is allowed only through the original legacy read-only path on the matching old account if available; otherwise unknown/quarantined. Keep unavailable Calendar from aborting text/session recovery.
- [ ] **Run green:** `npm test -- test/runtime/calendar-multi-recovery.spec.ts test/runtime/calendar-recovery.spec.ts test/runtime/calendar-recovery-unavailable.spec.ts`. Matrix: before/after acceptance, debit, paid dispatch, decision, proposal publish/consume/wrapper, preflight, reserve, planned event, dispatch CAS/event, before/after Google, result, receipt, succeeded event, seal, archive, manifest, terminal CAS. Assert fixed operation ID/hash/calendar/account; no second model/create, no fresh preflight after dispatch, counted readback/refresh, unchanged original deadline/reservations, matched vs absent/mismatch/unknown, account replacement/disconnect, default change, missing/expired/volatile evidence, old pending refs, cancellation/drain and subsequent ordinary chat.
- [ ] **Commit:** `git commit -m "fix(calendar): recover pinned evidence without model or create replay"` with named Task 9 files.

## Task 10: Project durable v2 receipts and clarification/narration outcomes truthfully

**Files:** modify `backend/src/chat-runtime/calendar-publication.ts`, necessary Calendar-only `durable-chat-runtime.ts` return/emitter types; modify `backend/test/runtime/calendar-publication.spec.ts`, `calendar-lifecycle.spec.ts`.

- [ ] **Write the failing narration-failure/default-switch test.**

```typescript
it('retains the original durable calendar receipt when narration fails and default changes', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.');
    h.modelWires.push(createWire(event(), 'create-one'), brokenTextWire());
    await expect(h.execute(ids)).rejects.toBeDefined();
    await h.setDefault('personal@example.test');
    const state = await h.runtime.getCalendarTurnState(h.identity.userId, ids.sessionId, ids.turnId);
    expect(state).toMatchObject({ schemaVersion: 2, state: 'succeeded', narration: 'failed',
      receipt: { durable: true, calendarLabel: 'Work' }, retryAction: 'none' });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-publication.spec.ts -t "retains the original durable calendar receipt"`. Expected: v1-only lookup/projection or missing durable label/narration distinction fails.
- [ ] **Implement compatible projection and protocol-3 emission.** Branch on actual operation schema; v2 uses compatible store and ratified v2 event confirmation. Never infer state/calendar from assistant prose/latest default. Return succeeded only after exact succeeded operation+event confirmed; before confirmation project dispatching/unknown without a receipt. For succeeded operation, durable event ID remains even when narration fails/interrupted or content expires; link/label only while source retained, unredacted, unexpired and label-specific expiry permits. Validate safe Google link. `retryAction` is none for succeeded, resume-reconciliation for unknown, clarify for unconsumed clarification (via its separate frame), blocked-expired for evidence-expired, reconnect where actual current account gate requires it. Do not fabricate an operation receipt for a pending proposal. Legacy receipt projection remains unchanged.

```typescript
const contentUsable = source.permission.content === 'retained' && source.redactedAt === null
  && Date.parse(source.expiresAt) > now;
const labelUsable = contentUsable && operation.labelExpiresAt !== null
  && Date.parse(operation.labelExpiresAt) > now;
const receipt = {
  durable: true as const,
  eventId: operation.googleEventId,
  htmlLink: contentUsable && safeCalendarLinkSchema.safeParse(operation.receipt!.htmlLink).success
    ? operation.receipt!.htmlLink : null,
  expiresAt: contentUsable ? source.expiresAt : null,
  calendarLabel: labelUsable ? operation.calendarLabel : null,
};
```

- [ ] **Publish from saved seals, not in-memory narration.** Factor a Calendar-specific publication function within owned `calendar-publication.ts`, taking saved v2 seal and exact retained decision/proposal evidence. Reuse durable message append/update, manifest CAS and attempt finalization order already used in `runCalendarTurn`; do not create another runtime. A saved exact assistant message is idempotent; missing/expired narration evidence leaves an incomplete narration with receipt intact. Use `calendarMultiStreamEnvelopeSchema` for new frame sequence, clarification/operation/status/completed events; do not reset sequence back to zero midway through the same emitter. P8 owns outer HTTP/transport callback types if they still only accept protocol 2—report the handoff, do not edit HTTP. A protocol-2 client must not receive silent unsupported protocol-3 Calendar mutation; its new mutation path stays unavailable/ordinary text until proper protocol negotiation is wired by P8.
- [ ] **Run green:** `npm test -- test/runtime/calendar-publication.spec.ts test/runtime/calendar-lifecycle.spec.ts`. Cover no provisional success, receipt/event ACK loss, narrated success/failure/interruption, unknown vs failed, default/account change after success, label/source expiry/redaction/disconnect, invalid link, v1 history, finalization-only recovery, bounded protocol-3 frames and sequence monotonicity. No private provider detail/credential/connection ID leaks.
- [ ] **Commit:** `git commit -m "feat(calendar): publish durable target receipts independently of narration"` with named Task 10 files.

## Task 11: Close concurrency, budget, lifecycle, and cross-turn safety regressions

**Files:** create `backend/test/runtime/calendar-multi-concurrency.spec.ts`; modify `backend/test/runtime/calendar-budget.spec.ts`, `calendar-logical-tools.spec.ts`, `calendar-lifecycle.spec.ts`, `calendar-multi-recovery.spec.ts`; minimal fixes only in the P6-owned shared seams established above.

- [ ] **Write failing concurrent-submission and exact-debit tests.** Use controlled deferred fixture hooks around capability/preflight/dispatch rather than sleeps.

```typescript
it('admits one reply across tabs and does not reset its budget on retry', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
    const first = await disclose(h, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', event());
    const results = await Promise.allSettled([
      h.reply(first.proposal, 'Yes', first.ids.sessionId),
      h.reply(first.proposal, 'Go ahead', first.ids.sessionId),
    ]);
    const acceptedReplies = results.filter((result): result is PromiseFulfilledResult<SubmitTurnResponse> => result.status === 'fulfilled');
    expect(acceptedReplies).toHaveLength(1);
    h.modelWires.push(textWire('Created.'));
    await h.execute(acceptedReplies[0].value);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId,
      first.ids.sessionId, acceptedReplies[0].value.turnId);
    expect(budget).toMatchObject({ creates: 1, logicalTools: 1 });
  } finally { await h.dispose(); }
});
```

- [ ] **Run red:** `npm test -- test/runtime/calendar-multi-concurrency.spec.ts`. The test must initially expose a real missing behavior/race or be added at the task where the corresponding missing guard exists; never remove a guard just to manufacture red evidence. Record the failing assertion before the minimal owned fix.
- [ ] **Fix only the shared root cause revealed by the tests.** Session attempt acceptance remains the existing owner/lease path; proposal consumption remains P2 CAS, not a new runtime mutex. All create callers use the same writer/authority/preflight. Enforce deadline/fence/account immediately before every paid/provider dispatch and after asynchronous rights checks, with one linked cancellation signal. Stop drain/cancel before dispatch; after dispatch preserve unknown/receipt, not a new proposal that could replay. Distinguish user cancellation, client disconnect, provider rejection, persistence uncertainty and budget exhaustion with bounded user messages. No hidden health calls, no live tools in internal/voice turns.

```typescript
job.check();
if (!(await fence())) throw new AppError('INTERRUPTED', 'Execution ownership was lost.', false);
await connection.requireAccountCurrent(account, job.signal);
const remaining = Date.parse((await ledger.ensureBudget()).deadlineAt) - clock();
if (remaining <= 0) throw new AppError('TIMEOUT', 'The Calendar turn deadline has passed.', false);
```

- [ ] **Exercise the finite-limit matrix.** 8 dispatches; 2 repairs; 6 model logical tools; one create; 20 physical Calendar deliveries; 2 token refreshes; no create delivery retry; 31-day range; 20 returned events; 16-KiB arguments/results; 20-second tool timeout; original 180-second/default total deadline; ≤USD1 estimated admission. Every lower configured limit wins. Include 100 calendars/two batches, discovery ≤2 in-turn deliveries, 2000 ingestion/16-KiB output, ≤5-minute discovery freshness, ≤10-minute proposal lifetime. Verify simultaneous request increments, failed deliveries/retries/refresh/rechecks counted, create debit only once, no tool/model counter charged for internal preflight, and persisted counters/reserved money survive restart. A genuinely new approval turn has its own bounded turn budget; retry of that accepted turn never resets it and its one originating intent still maps to one operation.
- [ ] **Exercise authority-race matrix.** Same accepted submit retry; competing selection replies; old-tab yes after supersession; cross-session/cross-account; changed default before unresolved resolution; default switch after proposal/dispatch; rights loss/role masking; disconnect/reconnect/account replacement between every async check; expired source/proposal; materially edited reply; repeated approval after success/unknown; new accepted identical request. Inspect actual stored revisions/hash/causal IDs and effect log, not narration text alone. Upstream storage/connection/schema failures go back to their owners with reproducer; do not patch their files.
- [ ] **Run green:** `npm test -- test/runtime/calendar-multi-concurrency.spec.ts test/runtime/calendar-budget.spec.ts test/runtime/calendar-logical-tools.spec.ts test/runtime/calendar-lifecycle.spec.ts test/runtime/calendar-multi-recovery.spec.ts`. Expected: all deterministic checks pass, no skips, zero network. Record exact counts and remaining upstream/assembly gates.
- [ ] **Commit:** `git commit -m "test(calendar): verify concurrent approvals and persistent runtime limits"` with named Task 11 tests and only demonstrated owned fixes.

## Task 12: Prove isolated-native authority/recovery behavior and finish sequential verification

**Files:** modify `backend/test/runtime/calendar-recovery.native.e2e-spec.ts`; minimal owned fixture helpers only in `backend/test/runtime/calendar-multi-fixture.ts`. No generic native harness or persistence source edit.

- [ ] **Replace the prefix-only assertion with a behavior test.** Keep the exact prerequisite guard `Boolean(process.env.AURVIN_TEST_MONGODB_URI) && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_'`. Reuse read-only `nativeHarness`/`nativeDatabase` generated database and actual existing persistence bundle; configure only deterministic Google/model fetches from the runtime fixture. Do not read `.env`, print URI/credentials, or run the suite when prerequisites are absent. A passed prefix assertion alone is not evidence.

```typescript
describe.skipIf(!configured)('Calendar v2 isolated native authority and recovery', () => {
  it('persists one consumed intent across restart and reconciles only the original target', async () => {
    const h = await nativeCalendarFixture();
    try {
      h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
      const first = await disclose(h, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.', event());
      const reply = await h.reply(first.proposal, 'Go ahead', first.ids.sessionId);
      h.failOnce('receipt-save');
      await expect(h.execute(reply)).rejects.toBeDefined();
      const original = await h.operationFor(reply);
      await h.setDefault('personal@example.test');
      await h.restartStoppedExecutor();
      await h.runtime.reconcileSession(h.identity.userId, reply.sessionId);
      expect(await h.operationFor(reply)).toMatchObject({ operationId: original!.operationId,
        calendarId: 'team@example.test', googleEventId: original!.googleEventId, state: 'succeeded' });
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
      expect(h.effects.filter(e => e.kind === 'readback')).toHaveLength(1);
    } finally { await h.dispose(); }
  }, 30000);
});
```

`nativeCalendarFixture()` is the same Calendar fixture dependency composition using the supplied real native bundle instead of the test memory store. Define it in the owned `calendar-multi-fixture.ts`, using `nativeHarness()` and existing runtime constructor; it exposes the exact Task 1 controls and the supplied isolated store. `restartStoppedExecutor()` stops work, drains/releases the fixture's actual executor, proves it is stopped, and reopens the **same generated database** through existing ownership/recovery APIs; never delete a sentinel or assume an expired lease grants takeover. `dispose` closes only this fixture and drops only its generated database through the existing harness. Add native competing consume/reserve and exact-debit ACK-loss cases. No live Google/model traffic occurs.

- [ ] **Run red only if authorized isolated prerequisites exist:** `npm run test:e2e -- test/runtime/calendar-recovery.native.e2e-spec.ts`. Expected initially: meaningful behavior failure, not merely prefix success. If absent, record **skipped: isolated-native prerequisites absent**, do not provision or borrow application data. A native-only failure routes to the owning source worker before acceptance.
- [ ] **Implement only native fixture wiring or demonstrated P6 fixes.** Use actual persisted proposal/consumption/operation/event/debit records and graph checks; do not swap these for memory mocks to get green. Keep deterministic provider counters spanning the stopped-executor restart so an accidental replay is observable.
- [ ] **Run green isolated check under the same prerequisite rule**, then run package checks **one at a time**, waiting for each to finish before starting the next:

```powershell
# Working directory: backend. Run each line separately, never in parallel.
npm test -- test/runtime/calendar-intent.spec.ts test/runtime/calendar-authority.spec.ts test/runtime/calendar-preflight.spec.ts test/runtime/calendar-targeting.spec.ts test/runtime/calendar-operation.spec.ts test/runtime/calendar-loop.spec.ts test/runtime/calendar-logical-tools.spec.ts test/runtime/calendar-budget.spec.ts test/runtime/calendar-lifecycle.spec.ts test/runtime/calendar-recovery.spec.ts test/runtime/calendar-recovery-unavailable.spec.ts test/runtime/calendar-multi-recovery.spec.ts test/runtime/calendar-multi-concurrency.spec.ts test/runtime/calendar-graph.spec.ts test/runtime/calendar-publication.spec.ts test/context/calendar-context.spec.ts
npm test -- test/plugins/mcp test/plugins/google-calendar test/model/calendar-policy.spec.ts test/model/calendar-adapter.spec.ts
npm run build
npm run lint
npm test
npm run test:e2e
```

Confirm actual matching model test paths with `glob` before execution; the repository currently has `test/model/calendar-policy.spec.ts` and `calendar-adapter.spec.ts`, and no nonexistent/empty selection counts as a pass. Native e2e suites may skip independently; report exact skip names/counts and missing prerequisite. `test:azure`/`test:behavior` empty exit-0 is not P6 evidence. The known backend build/bootstrap-test race prohibits parallel build and tests. Frontend/package/browser assembly remains P7/P8/P9 evidence; do not edit their files or claim these backend checks certify live ACLs, consent or Google behavior.

- [ ] **Commit:** `git commit -m "test(calendar): exercise native proposal authority and pinned recovery"` with only the named Task 12 files and owned fixes, once given the commit slot.

## Self-check and handoff checklist

- [ ] Goal/state P6 acceptance coverage: AC04/05 → Tasks 2–4/7; AC06/07 → Tasks 4–6; AC08/10 → Tasks 1/3/5/7/8/11; AC09/12 → Tasks 6/8–10/12; AC11/13 → Tasks 4/7/10/11; AC14 → Task 12 and exact handoff. No fixed-asset, connection/model/storage/contract/HTTP/frontend ownership crossing.
- [ ] Every new executable nontrivial helper has a meaningful failing test demonstrated before implementation and a green focused rerun. Runtime assertions exercise actual store/embedded MCP/provider-fixture boundaries, not flags naming the desired behavior.
- [ ] Proposal lifetime remains **≤10 minutes**, also bounded by source/privacy expiry; origin intent/account/connection/target/canonical action/discovery/availability revisions are stored. Conflict fingerprint includes per-calendar coverage/error/limit changes and disclosed opaque-only semantics. Single consumption/expiry/tombstone and unresolved-operation deduplication survive restart.
- [ ] Same unchanged accepted condition does not re-prompt just because observations/revisions refreshed. Changed material warning or expired authority does. Missing write rights are never overridable. A model omission, Boolean or selector cannot bypass server preflight or accepted intent.
- [ ] Logical debit/request attribution, context whole groups, accepted input once, immutable operation identity, no replay, unknown quarantine, cancellation/drain and durable receipt despite narration failure have observed test evidence.
- [ ] Reconcile I1–I7 plus any source-observed continuation-lineage gap with exact owner commits before declaring affected tasks executable/passed. Do not replace a gap with a cast, raw Mongo access, fake model dispatch, made-up action hash, or an unbounded scan.
- [ ] Placeholder/type/path scan of this plan and implementation; `git diff --check`; confirm named files/imports and no `.env`, `.openchamber/`, dependencies, generated files or foreign owner changes. The requested owner-interface examples are explicitly gated, not claimed as implemented exports.
- [ ] Return a concise worker summary: exact commits/files, red/green command evidence and counts, native executed/skipped status, remaining interface/assembly/live gates, review **skipped**, and defects routed to owners. Do not write P9 final evidence artifacts or mark the workflow complete.

### P7/P8 consumer handoff

P7: clarification is a durable protocol-3 frame (`proposalId`, expiry, reason, safe bounded message/candidates); reply authority remains server-side. Coordinate I4 automatic causal reply reference and preserve a typed reply's draft/focus. Receipts use the saved operation calendar label subject to expiry, never picker/default state; created-with-narration-failed is not a retry-create affordance.

P8: provide the explicit v2 runtime dependency branch with P4 account/capability gate, P5 v2 embedded execution/model factory and the existing single persistence bundle; wire protocol-3 callback/negotiation and any ratified accepted reply reference. Fixed instructions must remove the JSON-echo requirement and state precedence/conflict/coverage behavior; they are guidance, never authority. Keep text healthy when Calendar is degraded and live-voice tools disabled. Central wiring, fixed assets and transport are **not implemented by P6**.

P9: run assembled natural-language→target→preflight→MCP→durable receipt fixtures, stale-tab/selection→conflict/unknown recovery scenarios, browser rendering, and isolated-native checks separately. Live owned/shared-calendar/OAuth/quota/policy gates remain explicitly unrun without exact authorization. Fixture success is not service acceptance or deployment permission.
