# Voice Calendar Canvas — Technical Research

Date: 11 November 2026. Status: research for `docs/voice-calendar-canvas/goal.md`. No source changes, no live/provider calls, no database access. Everything below was traced from the working tree at `main` (`1c75a10`) unless labelled "proposed" or "recommended".

## 1. Executive findings

1. **Text calendar is fully wired; voice calendar is not.** `CalendarLoop` is entered only for accepted text turns in the durable runtime (`!internal` gate, `durable-chat-runtime.ts` around the `calendarWindow` decision and `admitCalendarBudget`), and the live voice adapter never supplies `emitCalendar` (`agent-voice-adapter.ts`, `executeTurn` call). The memory-first runtime can run the Calendar loop for live turns, but drops every non-delta calendar frame because `c.emitCalendar` is absent (`memory-text.ts`, the `resume`/`emitCalendar` wrapper). **The feature's first job is a deliberate, tested voice bridge, not a UI-only addition.**
2. **There is no structured result projection for lookups.** `executeReadV2` persists the tool result in `metadata` (`calendarResultsV2`) and returns to the model; no UI event is emitted. Today Canvas knows only "a create succeeded" (`calendarOperationsByTurn` + `receipt`), synthesised into a calendar artifact from narration regexes. Agenda/lookup Canvas content does not exist.
3. **All-day events are currently discarded.** `projectEvent` in `backend/src/plugins/google-calendar/calendar-api.ts` returns `null` for date-only (`start.date`/`end.date`) events and the list reports `truncated`. Reads are normalised to UTC (`READ_TIME_ZONE = 'Etc/UTC'`). AC5 cannot pass without extending the read projection; this is a real gap, not a UI gap.
4. **The existing calendar-event renderer must not be reused for lookups or proposals.** `CalendarEventRenderer` unconditionally renders "Confirmed on Google Calendar" and a day-schedule mock; it is only truthful for a durable created event. New agenda/review/outcome views are required.
5. **Text auto-open is a single, removable block.** `ChatView.tsx` lines ~178–211 auto-open for succeeded operations and for any unhandled `calendar` artifact. Removing that block (and its seen-set plumbing) implements the text policy; non-calendar Canvas behaviour never auto-opens in text. Voice auto-open is separate (`claimNewAutoOpenArtifactId` + live controller `openCanvasArtifact`).
6. **Confirmation authority is already single-path and race-safe.** Text buttons submit `"yes"`/`"cancel"`/calendar id as a hidden turn with `calendarReplyTo` (`CalendarTurnRegion` → `actions.submitMessage(content, { hideFromTranscript: true })`; `use-chat.ts` adds the reference). The runtime consumes the proposal with CAS, revision, expiry and idempotency. Voice can reuse this exactly by submitting a synthetic voice turn; no second authorization path is needed.
7. **History hydration is currently lost.** `calendarOperationsByTurn` resets on `SELECT_SESSION`/`NEW_CHAT`; `getTurnStatus().calendar` exists but is never dispatched, and `VisibleMessage` excludes calendar state. Even a successful created-event Canvas tab disappears after reload. Voice `canvasArtifacts` are persisted, but calendar turns do not currently use that boundary (`publishCalendarTurn` call omits `assistantFields`).
8. **The latency-critical pieces are already asynchronous where it matters.** Voice sink `event()` is synchronous for both transports (`voice-connection.event` → `socket.send`; `LiveKitControls.send` validates/enqueues and returns). Speech deltas are the only thing that may be awaited. The new visual work is CPU-bounded projection (≤20 events), one additional message field write, and one bounded frame — no model/provider calls, no polling, no new reads.

## 2. Current end-to-end map

### 2.1 Text calendar turn

```
POST /sessions/:id/turns (calendarProtocol: 2)
  -> DurableChatRuntime.submitTurn -> acceptNewTurn -> admitCalendarBudget
  -> executeTurn -> executeOwnedTurn (or memory-first MemoryText.execute)
     -> CalendarLoop graph: decide -> execute -> seal
        decide: model dispatch (calendar model port), tool call / text
        execute: CalendarOperationWriter.executeCreate (single mutating entry)
                 or executeReadV2 (list/get/list_calendars/check_availability)
        emitCalendar frames -> SSE (calendar-progress / calendar-operation / calendar-clarification)
     -> publishCalendarTurn (durable) / finish+archive (memory-first)
```

Key facts:

- One accepted turn performs one model decision at a time; at most one tool call per decision; at most one create per turn.
- `CalendarOperationWriter.executeCreate` is the only write entry (`backend/src/chat-runtime/calendar-operation.ts`). It verifies the accepted message, the consumed proposal, canonical action hash, fresh capability, preflight/availability, charges one logical create, reserves the operation, confirms `planned` + event, transitions to `dispatching`, invokes the provider once, and persists `succeeded`/`definitely-failed`/`unknown`. Never retries a write automatically.
- `projectCalendarTurnStateCompatible` is the single projection of operation state (`backend/src/chat-runtime/calendar-publication.ts`). It only reports `succeeded` when the operation's own v2 event at the same sequence/revision is durable; it only exposes `htmlLink`/`calendarLabel` while the retained source and label expiry permit.
- Proposal authority lives in `backend/src/chat-runtime/calendar-authority.ts`: publish with CAS, identical-proposal dedupe, expiry clamp, single-use consumption, tombstones, revision-bound replies, unique-disclosure proof for bare "yes".
- `calendarActionHash`/`validateCalendarCall` (`plugins/google-calendar/tools-validation.ts`) are the canonical schema/hash authority. Do not re-validate with new layers.

### 2.2 Voice turn today

```
LiveKit/WS audio -> STT finalize -> AgentVoiceAdapter.finalized
  -> DurableChatRuntime.submitLiveTurn (internal user message, mode=live, voiceSessionId)
  -> runtime.executeTurn({ signal, emit: no-op, live: {...}, NO emitCalendar })
     -> memory-first: MemoryText.execute
        - calendar loop runs when snapshot.calendar.enabled; non-delta frames are dropped
        - model-authored visuals flow through SpeechProse -> c.live.artifact -> sink
        - calendar narration deltas bypass emitCalendar and are spoken via publish()
     -> durable fallback: executeOwnedTurn
        - admitCalendarBudget is skipped for live turns
        - calendarWindow is null for internal/live input
        - so the turn is ordinary text generation; no calendar tools
```

`AgentVoiceAdapter` (`backend/src/voice/agent/agent-voice-adapter.ts`) already:

- dedupes finalized speech by `(voiceSessionId, providerSocketEpoch, providerTurnId)`;
- serialises turns (`acceptingTurn`/`running`);
- creates `VoiceDelivery` in `live.start`, routes model deltas, forwards accepted Canvas artifacts to `sink.event({ type: 'canvas.artifact', turnId, ...projection })`, dedupes by ordinal, and settles delivery;
- aborts/cancels on interrupt/disconnect without implying a write outcome.

Missing for this feature: an `emitCalendar` implementation, a per-turn calendar frame path to the sink, a `calendar.confirm` control hook, and voice admission of the Calendar loop in the durable fallback.

### 2.3 Canvas today

- `frontend/src/features/canvas/canvas-artifacts.ts` extracts `mermaid`/`chart`/`svg`/`calendar` blocks and voice `canvasArtifacts`; it also synthesises a `calendar` artifact **only** for `calendarOperationsByTurn[turnId].state === 'succeeded'` with a durable receipt, using regex-extracted title/time from narration.
- `ChatView.tsx` builds `textArtifacts` (messages + stream), merges live voice projections, merges calendar-operation synthesis, then opens `CanvasPanel`.
- `CanvasPanel.tsx` is a tabbed, zoom/pan stage for all kinds; the calendar renderer is wrapped in the same `transform` stage and pan handlers. This is wrong for agenda/review content (goal: ordinary accessible UI, no diagram zoom/pan).
- `CalendarEventRenderer` shows a tear-off date, "Confirmed on Google Calendar", mini day schedule, event id, and a validated `htmlLink`. It is a created-event card only.
- Inline text feedback is `CalendarTurnRegion` (`frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx`): progress pill, operation cards, retry boxes, clarification card with candidate/cancel/confirm buttons. It is rendered inside `Transcript` for text mode only; it is not mounted during live voice.
- Live Canvas artifacts: `LiveVoiceState.artifacts` (projections), controller accepts `canvas.artifact`, dedupes by `responseId+ordinal`, calls `openCanvasArtifact` to auto-open. `ChatView` also `claimNewAutoOpenArtifactId(liveProjections, seen)`.

### 2.4 Persistence and hydration today

- Six collections per the root instructions; calendar evidence additionally uses `metadata` for tool results (`calendarResultsV2`) and `calendarProposals`/`calendarOperationsV2` stores.
- `MessageRecord.canvasArtifacts` is **voice-only**: schema requires `role='assistant'`, `visibility='internal'`, `mode='live'`, `voiceSessionId`, and a projection list. Text messages can never carry Canvas projections.
- `VisibleMessage` (`backend/src/contracts/api.ts`) exposes `canvasArtifacts` but not `visibility` or `sourceProvenance`; internal voice message `content` is blanked and replaced with `voiceTranscripts` (`persistence/messages.ts`).
- `publishCalendarTurn` accepts `assistantFields` (`mode`/`visibility`/`voiceSessionId`/`canvasArtifacts`) but the calendar call site does not pass it; a voice calendar turn would persist as an ordinary visible text message and could not carry Canvas projections.
- `getTurnStatus` rejects live turns; `getCalendarTurnState` is not mode-restricted but is only wired into the per-turn status endpoint and the frontend never consumes it.
- On `SELECT_SESSION`, `calendarOperationsByTurn`/`calendarTurnOrder`/`calendarClarification` are reset and never refilled. Created-event Canvas tabs and calendar cards vanish after reload.

## 3. The voice bridge: smallest correct path

### 3.1 Enable the existing Calendar loop for authenticated live turns

Two runtime implementations must be covered because both are reachable:

1. **Memory-first (`memory-text.ts`)** is the production path when a persistent store is configured (`app.service.ts` enables `memoryFirst` unless explicitly disabled or running without a store). It already runs `CalendarLoop` for live turns when the calendar snapshot is enabled and already routes calendar narration deltas into `publish()`/speech.
   Required: pass `emitCalendar` from the adapter, and route non-delta frames to the voice sink. No authority or storage change.
2. **Durable (`durable-chat-runtime.ts`)** is the fallback (fresh durable history, memory-first promotion failure). It currently excludes live turns from calendar by:
   - skipping `admitCalendarBudget` for live (`if (!live)` at the budget admission);
   - computing `calendarWindow` only for `!internal` (`internal` is true for live voice);
   - requiring `c.emitCalendar` and hard-coding `responseMode: 'text'` in `selectReferences` inside `runCalendarTurn`.
   Required: admit the same calendar budget for live turns, allow the calendar branch for authenticated live/internal input (still never for the public HTTP stream), pass `emitCalendar`, and select context with `responseMode: c.live ? 'voice' : 'text'`.
   This is the riskiest P1 change. If it cannot be made safely within P1, the fallback must fail conversationally ("Calendar needs a new chat") rather than with `NOT_READY`; it must not claim voice calendar works on a path it does not cover.

Do not create a second loop, a voice-only planner, or a new calendar execution port. Reuse `CalendarLoop`, `CalendarOperationWriter`, proposal authority, budget/ledger and projections.

### 3.2 Route calendar frames to voice

Add one optional adapter callback in `live` (or an `emitCalendar` implementation passed to `executeTurn`) that maps a validated calendar envelope to the voice sink:

- `calendar-progress` → `{ type: 'calendar.frame', turnId, attemptId, event }`
- `calendar-operation` → same wrapper
- `calendar-clarification` → same wrapper
- `calendar-view` (new, agenda/outcome/proposal snapshot) → same wrapper
- `delta` → **speech**, not Canvas: `active.delivery.delta(text)` (plus `modelOutput()`); this keeps local narration (created/confirmed/clarification text) spoken on the durable path. Handle the publisher's `reset: true` by skipping the already-generated prefix rather than speaking the durable answer twice.
- `status`/`completed` → ignore for Canvas; `finish()` must be called once after the final narration so TTS flushes and delivery settles. The current durable calendar path never calls `live.finish()`; without it settlement can wait for the deadline.

Voice sink delivery is synchronous in both transports. Never await a calendar frame before returning control to the loop; wrap it in `try/catch` so a visual/transport failure cannot fail the turn or turn into a false write success. The calendar write has already returned authoritative evidence; UI failure is a display failure only.

Keep the dictation mode untouched: reject `calendar.frame` and `calendar.confirm` in `isVoiceServerEvent`/`parseVoiceControl` for `mode === 'dictation'` exactly as `canvas.artifact` is rejected today.

### 3.3 Confirmation through the existing turn path

**Spoken confirmation needs no new mechanism.** A next voice turn containing "yes"/"cancel"/a candidate calendar label is already interpreted by `readCalendarReply` and consumed with the proposal CAS. Once the loop is enabled for voice, spoken accept/reject/selection works.

**Buttons need one client control event** because the live reservation holds the session slot (`ExecutionReservations.assertText` conflicts while a live conversation is bound), so a voice Canvas button cannot use the HTTP text submit path.

Recommended control:

```ts
// live client -> server; envelope sequence/epoch still enforced by the transport
{ type: 'calendar.confirm',
  proposalId: string;
  proposalRevision: number;               // untrusted reference, verified by the runtime
  answer: { kind: 'accept' } | { kind: 'reject' } | { kind: 'select'; calendarId: string };
}
```

Server handling: `LiveFlow.control` → new optional `LiveHooks.calendarControl(context, input, signal)` → `AgentVoiceAdapter` submits a synthetic finalized turn through the same `run`/`submitLiveTurn` path with:

- text `"yes"` / `"cancel"` / the canonical calendar id (server-derived; never arbitrary client speech);
- `providerTurnId = calendar:<proposalId>:<revision>:<answer-kind>` (idempotency key makes double click one turn);
- `calendarReplyTo = { proposalId, revision }` (revision-bound; stale/expired/replaced is rejected by existing checks);
- the current session reservation and `configSnapshot`.

This gives: same server-authorized pending proposal, one write, revision/expiry/session checks, voice/button races resolved by proposal CAS + turn idempotency + `findOwnSessionCreate`. Do not add a direct "execute proposal" endpoint.

## 4. Wire contracts: recommended additions

Prefer additive fields/events on the existing protocol-3 calendar stream and the existing voice protocol. Do not create a parallel calendar protocol.

### 4.1 Calendar view (structured, bounded)

Add a view schema (new `backend/src/contracts/calendar-view.ts`, or a section of `calendar-wire.ts`) that is the only shape Canvas consumes:

```ts
calendarViewSchema =
  | { viewVersion: 1; kind: 'agenda';
      target: { calendarId; calendarLabel: string|null; labelExpiresAt: string|null };
      requested: { timeMin; timeMax; displayTimeZone };
      entries: Array<{
        eventId; summary;
        start; end;              // UTC instant, or YYYY-MM-DD when allDay
        allDay: boolean;
        timeZone: string|null;   // calendar/display zone for all-day
        status: 'confirmed'|'tentative'|'cancelled';
        location?: string; description?: string;
        htmlLink: string|null;
      }>;                         // max 20
      nextPageToken: string|null; // presence is shown as "more available"
      truncated: boolean;
      expiresAt: string;          // link/label usability ceiling
    }
  | { viewVersion: 1; kind: 'proposal';
      proposalId; revision; expiresAt;
      reason: 'target'|'details'|'conflict'|'coverage';
      target: { calendarId; calendarLabel; labelExpiresAt }|null;
      action: CalendarCreateInput|null;   // exact canonical proposal action
      candidates: Array<{ calendarId; label; role }>; // max 20
    }
  | { viewVersion: 1; kind: 'outcome';
      operationId; proposalId: string|null; intentId;
      state: operationStateV2; retryAction;
      receipt: { eventId; htmlLink: string|null; calendarLabel: string|null; expiresAt: string|null }|null;
    };
```

Rules:

- Bound the whole view to ≤14,336 bytes (envelope cap is 16,384). Trim optional `description`/`location` first, then shorten descriptions, and set an explicit `detailsTrimmed` flag; never fabricate. Keep all events and core fields.
- `allDay` + exclusive `end` is mandatory for AC5. Timed values stay UTC instants; `displayTimeZone` is the server `trustedTimeZone` used for grouping/labels. Do not convert date-only values as timestamps.
- Empty agenda (`entries: []`, success) is distinct from lookup failure (`kind` absent / failure view with a bounded reason) and from truncation/pagination (`truncated`/`nextPageToken`).
- The proposal view carries the exact canonical `action` and target; the card must not parse the human-readable `message` for facts (keep the existing regex parser only as a legacy fallback).
- `htmlLink` is already validated by `safeLink` in the API and by the wire guard; keep `safeCalendarLinkSchema` on the wire and re-check with `resolveSafeCalendarLink` in P2. Hide link/label after `expiresAt`; do not persist an unexpiring label.

### 4.2 SSE/calendar-stream event

Add to `calendarMultiStreamEnvelopeSchema.event`:

```ts
{ type: 'calendar-view'; view: calendarViewSchema }
```

Emission timing:

- **Voice:** emit the view as soon as the structured evidence exists (after a successful read, after proposal publish, at terminal operation outcome) so the workspace opens/updates without waiting for the spoken answer.
- **Text:** emit the view at publication (after narration deltas, before `completed`) for lookups/outcomes, and at clarification time for proposals (the inline card already needs it). Do not add a 14 KB SSE write before the next model dispatch on the text critical path.
- The same view is what gets persisted (section 5), so stream and history cannot disagree.
- The protocol-3 event union is strict: adding `calendar-view` is a coordinated client/server change shipped together, not a rolling-compatible addition. The text publication frame is written to the SSE stream before `completed`; if its drain wait is measurable, enqueue display frames without awaiting drain while preserving order, or attach the view client-side on `completed`. P3 must record which was chosen and the measured effect.

Also extend `calendarClarificationWireSchema` with the proposal view fields (or emit a separate `calendar-view` proposal event instead). Prefer one event: the clarification event keeps `proposalId`/`revision`/`expiresAt`; add `action` and `target` so text and voice render from structure.

Extend `calendarTurnStateV2Schema` with optional `proposalId` and `intentId` copied from the operation record (no extra read). This lets the UI keep one workspace across proposal → confirmation → outcome; otherwise it can only correlate by turn and may open a second card.

### 4.3 Voice wire events

Server payload (both WS and LiveKit; same guard):

```ts
{ type: 'calendar.frame';
  turnId: string;
  attemptId: string;
  event: CalendarProgressEvent | CalendarOperationWireEventV2 | CalendarClarificationWire | CalendarViewEvent;
}
```

Client payload (live mode only):

```ts
{ type: 'calendar.confirm'; proposalId; proposalRevision;
  answer: { kind: 'accept'|'reject' } | { kind: 'select'; calendarId } }
```

Update both mirrors in lockstep: `backend/src/contracts/voice-wire.ts` and `frontend/src/api/voice-protocol.ts` (`serverShapes`, `clientShapes`, mode exclusions, payload unions). The strict `hasExactKeys`/`exact` guards reject unknown fields, so this is a coordinated release change, not a rolling compatible one.

### 4.4 Message field for hydration

Add an optional bounded `calendarView` to `MessageRecord` (`backend/src/contracts/message.ts`) and to `visibleMessageSchema` (`contracts/api.ts`), populated for assistant calendar turns in both text and voice. This is the smallest truthful hydration path:

- same message write (no extra collection/read);
- survives reload/session navigation;
- historical cards are snapshots: P2 renders them read-only and never re-derives authorization;
- voice may additionally keep `canvasArtifacts` for live delivery, but is not required to if P2 synthesises the Canvas artifact from `calendarView`.

Plumbing: `CalendarSeal` v2 optional `view` (checkpointed for recovery), `publishCalendarTurn` writes `seal.view` into the assistant message, `MemoryTerminal`/`terminalEnvelope` carries it for non-promoted memory turns, `bounded()`/memory output-capacity checks include it (≤14,336 bytes). `redactCalendarMessage*` already leaves retrieved calendar details in the transcript, so this is consistent; link/label expiry is enforced by the view's `expiresAt`.

If the planner must cut scope, the fallback is voice-only persistence through `canvasArtifacts` (existing live-only boundary). That satisfies voice continuity but leaves text history without a Canvas button after reload. Record that limitation rather than adding an ad-hoc endpoint.

## 5. Frontend design facts and required changes

### 5.1 Text mode (AC2)

- Remove the calendar auto-open block in `ChatView.tsx` (~178–211), including the "unhandled calendar artifact" fallback and the `seenCalendarArtifactIdsRef` plumbing. Keep the live voice auto-open path (`claimNewAutoOpenArtifactId`) for non-calendar and voice calendar workspaces.
- Keep `CalendarTurnRegion` inline progress/operation/clarification cards. Add a single explicit "View agenda/event in Canvas" button (reuse `CanvasArtifactCard` or a small calendar button) fed by `calendarResultsByTurn`/the persisted `calendarView`.
- Clicking the button dispatches `OPEN_CANVAS_ARTIFACT`; nothing else opens Canvas for calendar in text.
- The legacy `calendar` fenced-block path remains a manual inline card; it no longer auto-opens.
- Update `calendar-canvas.test.ts` / `ChatView` tests that currently assert text auto-open.

### 5.2 Voice mode (AC1, AC3, AC4)

- Add a live calendar workspace slice (in `LiveVoiceState` or a small dedicated state) keyed by `proposalId`/`operationId`/`intentId` from the frames. One workspace per calendar request: proposal → executing progress → outcome.
- On a `calendar.frame`, dispatch only when the frame belongs to the current voice conversation (pass the bound conversation id in the live controller binding; ignore when the user navigated). The transport already enforces voice-session identity/sequence.
- Auto-open the workspace once per new workspace id (`calendar:${proposalId ?? operationId ?? turnId}`). Do not reopen on updates after the user closes it; a new request gets a new id and may open again. Closing Canvas only dispatches `CLOSE_CANVAS`; it must not touch the voice controller, microphone, playback, or proposal.
- Workspace artifact ID must be stable across updates and must not collide with persisted projections. Deduplicate the live workspace against the persisted `calendarView` artifact for the same turn when the message arrives (prefer one, do not show two tabs).
- Map phases truthfully: `calendar-progress` → "Checking your calendars"/"Working on your calendar"; clarification → "Awaiting confirmation"; operation `succeeded` → created; `unknown`/`definitely-failed`/`failed`/`evidence-expired` → distinct outcomes. No percentages. P1 moves the backend's `executing` emission to the start of the actual tool execution (after `activate_skill` and argument validation), so schema loading does not open a false workspace.
- Controls: Confirm/Cancel/candidate buttons call `liveVoice.confirmCalendar(...)`, which sends `calendar.confirm` through `run.client.control(...)`. Disable while `agent === 'thinking'`/input busy; disable after `expiresAt`; label the target and exact time. A historical/reloaded proposal is read-only.
- Do not read every agenda entry. P1 adds a short voice-mode calendar instruction to `backend/src/instructions/system.md` (currently says "Live voice has no Calendar tools" and "No ... all-day events"): lookups are summarised (count/first event/range), details live in Canvas, do not emit calendar fenced blocks for structured calendar results, only a durable receipt confirms a write.
- Keep the LiveVoicePanel Canvas toggle; count includes the calendar workspace.

### 5.3 Canvas rendering (AC5, AC7)

- Branch `CanvasPanel` for `kind === 'calendar'`: bypass the pan/zoom transform, wheel/drag handlers, and zoom controls. Render a normal scrollable, responsive body. Keep copy/download optional; do not expose raw code as the primary experience.
- New renderers:
  - `CalendarAgendaView`: day groups in `displayTimeZone`, all-day section per day, multi-day intervals, title/time/tz/label/link, expandable details (location/description), explicit empty vs failed vs truncated/paginated messaging. Missing fields are omitted, not invented; no attendees (the read projection does not fetch them).
  - `CalendarProposalReviewCard`: exact action, target, conflict/coverage reason text, expiry, confirm/cancel/candidates; buttons only in the live workspace.
  - `CalendarOutcomeCard`: created receipt (link/label only while usable), failed, unknown, expired, cancelled, retry guidance.
- Keep legacy `CalendarEventRenderer` for created-event snapshots without a view, but never label a lookup/planned/proposal as confirmed.
- Accessibility: buttons with accessible names, `aria-expanded` details, day headings, keyboard focus on confirm controls, `role="region"` labels, no new animation or respect `prefers-reduced-motion` (existing `prefersReducedCanvasMotion`). Description/link rendering stays text/validated URL only.

## 6. Persistence and hydration rules

- Live frames are presentation only; they never grant authority. A historical proposal card is read-only even if `expiresAt` has not passed (no live server session/proposal revalidation).
- The persisted view is written with the assistant message after the durable narration/ops evidence; it is a snapshot, not a reactivation.
- On session load, P2 synthesises one Canvas artifact per assistant message with `calendarView` (`artifactId = ${messageId}::canvas::calendar`, `kind='calendar'`, `subType='Agenda'|'Confirmation'|'Calendar event'`), and feeds the inline button. No replay, no confirmation, no write.
- `calendarOperationsByTurn` in-memory synthesis remains a fallback for older messages and the active turn; deduplicate by turn so the persisted view and the live workspace do not create two tabs.
- Expiry: render link/label only while `view.expiresAt` permits; after expiry show the event facts without the link/label. Never extend a label beyond the source/label expiry.
- Isolation: frames carry voice session identity; the live binding must also carry the chat conversation id so navigation cannot leak frames into another chat. Text SSE already scopes by session/turn/attempt and the reducer drops mismatched turns.
- Recovery: `publishCalendarTurn` reuses a saved assistant message with the exact content; the view must be part of the same first write so recovery does not need to reconstruct it. If an older message has no view, do not invent one.

## 7. Latency and simplicity discipline

### 7.1 Critical-path audit

- **No new model/provider calls.** The calendar loop already performs its model decision and provider call. The view is derived from `invoked.result`, the proposal record and the operation projection, which are already in memory.
- **No new storage reads.** The view is built from in-memory records and written inside the existing assistant message. Proposal/operation projections already read their stores once after the write; do not add a pre-dispatch projection read.
- **No new serial waits.** Voice frames are synchronous sink calls; never await them. Text emits the view at publication (after prose streaming), not before the next model dispatch. Progress emission moves to the actual tool start, not earlier.
- **Bounded CPU.** O(≤20 events) projection with a fixed byte cap; P2 parses/memoises once per view, not per audio callback or per token.
- **No polling/timers.** Expiry rendering uses the existing deadline timer pattern (`CalendarTurnRegion`) or a single computed timestamp; no intervals.
- **Do not weaken writes.** The one-write path, proposal CAS, idempotency, expiry and recovery are untouched. Presentation failures are caught and never converted into success/failure claims.
- **Durable narration in voice.** Handle the publisher's `reset` delta by speaking only the unpublished suffix. Call `finish()` once for the live calendar path so TTS flushes and delivery settles; otherwise settlement can hang to its deadline.
- **Move `executing`** from the top of `CalendarLoop.execute` to the start of `executeCreateV2`/`executeReadV2` (after schema activation/validation) so Canvas does not claim calendar work for a schema load or a rejected call.

### 7.2 Deterministic before/after measurement

Reuse the offline harness rather than inventing a new benchmark:

- `backend/test/performance/latency-runtime-fixture.ts` + `dependency-probe.ts`: `logicalReads/writes`, `wireReads/writes`, `waves`, `elapsedMs`, `milestones`, `phases`. `calendar-critical-path.spec.ts` already measures calendar confirmation with/without a proposal reference.
- Add a lookup turn (`activate_skill` + `calendar_list_events`) and record: `modelCalls`, `requestKinds`, storage command counts, waves, first delta/terminal milestones, frame count. The "after" must have the same model/provider request counts and the same storage reads/writes as "before"; only a bounded CPU projection and one frame are allowed.
- Compare a voice-style execution with a sink that records frames synchronously vs. a sink that throws/never resolves (if any await is accidentally introduced, the test fails). Assert the turn still completes and the authoritative operation state is unchanged.
- Report noisy measurements honestly. The probe models storage waves, not CPU; record the projection as a bounded CPU step with an informational timing (not a hard CI gate) and state that no absolute zero overhead is claimed.

### 7.3 Test hooks

- `CalendarLoop` frame sink is already injectable (`emitCalendar`); use it to assert frame order and to inject failures/delays.
- Adapter tests can construct `AgentVoiceAdapter` with a recording `VoiceSink` (see `backend/test/voice/agent/submission.spec.ts`) and assert `calendar.frame`/delta routing and that no calendar frame awaits.
- Frontend controller tests already inject `client.control`; use them for `calendar.confirm` and frame routing.
- A `calendar.confirm` idempotency test is the smallest proof of double-click safety.

## 8. Reuse inventory (do not duplicate)

| Concern | Existing authority |
| --- | --- |
| Create write / idempotency / unknown outcomes | `CalendarOperationWriter.executeCreate`, `CalendarOperationStoreV2`, operation events |
| Proposal publish/consume/expiry/tombstone/revision | `calendar-authority.ts`, `calendarProposalSchema`, `resolveReplyTarget`, `consumeOrTombstoneProposal` |
| Reply interpretation ("yes"/"cancel"/calendar choice) | `readCalendarReply` in `calendar-intent.ts` |
| Target/capability/preflight/availability | `cal.capabilities.resolve`, `requiresAcceptance`, `describeAvailabilityCondition`, `CalendarOperationWriter` capability/preflight hooks |
| Tool schema/validation/hash | `calendarInputSchemas`, `validateCalendarCall`, `calendarActionHash` |
| Operation projection / receipt truth | `projectCalendarTurnStateCompatible`, `calendarTurnStateV2Schema` |
| Safe link validation | `safeCalendarLinkSchema`, `safeLink` in the API, `resolveSafeCalendarLink` |
| Progress/operation/clarification text mapping | `describeCalendarProgress`, `describeOperationState`, `describeCalendarRetryAction`, `resolveSafeReceiptLink`, `resolveReceiptCalendarLabel` |
| Text confirmation UI + hidden reply | `CalendarTurnRegion`, `actions.submitMessage(content, { hideFromTranscript: true })`, `calendarReplyTo` |
| Canvas open/close/focus/reduced motion | `CanvasPanel`, `restoreCanvasCloseFocus`, `prefersReducedCanvasMotion`, `chat-reducer` `OPEN_CANVAS_ARTIFACT`/`CLOSE_CANVAS` |
| Voice sink/transports/control framing | `VoiceSink`, `voice-connection.ts`, `LiveKitControls`, `encodeVoiceControlPackets`, strict `voice-wire` guards |
| Voice speech/delivery | `VoiceDelivery`, `AgentVoiceAdapter`, `SpeechProse` |

## 9. File ownership recommendations

### P1 — Calendar authority and voice bridge

Backend source:

- `backend/src/contracts/calendar-wire.ts` (or a new `calendar-view.ts`): view schemas, `calendar-view` event, clarification structured fields, operation `proposalId`/`intentId`.
- `backend/src/contracts/calendar-tools.ts` + `backend/src/plugins/google-calendar/calendar-api.ts`: all-day read representation (optional `allDay`, date-only start/exclusive end), calendar/display time zone for agenda, trim/no-fabrication rules. Do not add attendees.
- `backend/src/contracts/message.ts`, `backend/src/contracts/api.ts`: optional `calendarView`; `backend/src/contracts/canvas-artifact.ts` only if voice also persists a projection.
- `backend/src/agent/state.ts`: `CalendarSeal` v2 optional view.
- `backend/src/chat-runtime/calendar-loop.ts`: build the view from in-memory results/proposals/operation; emit at the correct time; move `executing` to the real tool start; write the view into the seal.
- `backend/src/chat-runtime/calendar-publication.ts`: persist the view on the assistant message; pass `assistantFields` (mode/visibility/voiceSessionId) for voice; emit the view at text publication.
- `backend/src/chat-runtime/durable-chat-runtime.ts`: admit calendar for live/authenticated turns, pass `emitCalendar`, `responseMode: c.live ? 'voice' : 'text'`, ensure `live.finish()`.
- `backend/src/chat-runtime/memory-text.ts` + `memory-first-foundation.ts`: pass `emitCalendar`, persist the view in terminal envelopes/archive, output-capacity accounting, promoted publication.
- `backend/src/voice/agent/agent-voice-adapter.ts`: `emitCalendar` → sink `calendar.frame`, delta → speech (reset prefix rule), `finish()`, `calendarControl` implementation.
- `backend/src/voice/session/live-flow.ts` + `voice-session.options.ts`: `calendar.confirm` control → optional hook with signal/epoch.
- `backend/src/contracts/voice-wire.ts`: `calendar.frame` server payload and `calendar.confirm` client payload, dictation exclusions, size guards.
- `backend/src/instructions/system.md`: remove "Live voice has no Calendar tools"; add concise voice calendar behavior; allow all-day read display (create still unsupported).

Backend tests (P1-owned): `backend/test/contracts/calendar-wire.spec.ts`, `backend/test/contracts/calendar-tools.spec.ts`, `backend/test/plugins/google-calendar/calendar-api*.spec.ts` (all-day/trim), `backend/test/runtime/calendar-loop*.spec.ts`, `backend/test/runtime/calendar-confirmation.spec.ts` (synthetic voice confirm can be unit-level), `backend/test/runtime/calendar-publication.spec.ts`, `backend/test/persistence/voice-messages.spec.ts`, `backend/test/voice/agent/submission.spec.ts` (new confirm/frame tests), `backend/test/voice/transport/livekit-control.spec.ts`.

Deliverable: stable handoff describing the exact wire shapes, view schema, control event and voice execution conditions for P2/P3.

### P2 — Voice-first Canvas and text entry points

- `frontend/src/api/voice-protocol.ts` (mirror server/client events), `frontend/src/api/calendar-protocol.ts` (`calendar-view` guard/type, structured clarification), `frontend/src/api/protocol.ts` (`VisibleMessage.calendarView`).
- `frontend/src/features/voice/state/live-voice-controller.ts`, `live-voice-reducer.ts`, `useLiveVoice.ts`: accept `calendar.frame`, route to the live calendar slice, expose `confirmCalendar`, gate by conversation; `App.tsx` binding.
- `frontend/src/features/chat/ChatView.tsx`: remove text calendar auto-open; add voice workspace auto-open/sticky dismissal; merge/dedupe live, persisted and legacy artifacts; keep non-calendar behaviour.
- `frontend/src/features/canvas/canvas-artifacts.ts`, `canvas-types.ts`, `CanvasPanel.tsx`: view→artifact synthesis, calendar mode without pan/zoom, tab identity/dedupe.
- New renderers under `frontend/src/features/canvas/renderers/`: agenda, proposal review, outcome. Reuse `CalendarEventRenderer` only for a confirmed created event.
- `frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx`: inline result button (manual opening), keep confirmation/expiry semantics; reuse exported helpers.
- `frontend/src/styles/chat.css` / `calendar-plugin.css`: responsive, reduced-motion-safe calendar Canvas layouts.
- Tests: `frontend/src/features/canvas/calendar-canvas.test.ts` (update auto-open), new agenda/review/outcome SSR tests, `ChatView.voice.test.ts`, `live-voice-controller.test.ts`, `calendar-chat-state.test.ts`, `calendar-turn-region.test.ts`, `api/voice-protocol.test.ts`, `api/calendar-protocol.test.ts`, `components/MessageItem.test.ts`/`VoiceTranscriptModal.test.ts` for hydrated cards.

### P3 — Integrated verification and completion

- `backend/test/voice/integration/`: new `calendar-voice.spec.ts` (and extend `integrated-fixture.ts` with calendar deps). Use the real `AgentVoiceAdapter`/`LiveFlow`/offline LiveKit and WS peers. Cover: lookup progress → agenda auto-open; proposal → spoken confirm and button confirm; duplicate click; voice/button race; expired/replaced proposal; failure/unknown; mode switch/reconnect/reload; no second write; frame correlation.
- `backend/test/http/calendar-stream.spec.ts` or a new spec: text view emitted at publication; no calendar auto-open semantics are frontend-only.
- `backend/test/performance/calendar-critical-path.spec.ts` / new `calendar-voice-latency.spec.ts`: deterministic lookup before/after, model/provider request counts, storage counts, waves, milestones; delayed/throwing visual sink does not gate speech/text or terminal authority.
- `frontend/src/features/voice/integration-tests/calendar-canvas.test.ts` (new): controller + live reducer + Canvas artifact state + confirm control; dismissal/auto-open; session navigation isolation.
- `docs/voice-calendar-canvas/verification.md`: commands, results, skips, limitations, measured comparison. P3 does not edit P1/P2 source; defects route back.

## 10. Test and verification plan

- Backend routine: `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e` in `backend/`. Offline fixtures: `calendarFixture`, `calendarMemory`, `voiceRuntimeHarness`, `integratedFixture`; no `AURVIN_TEST_MONGODB_URI` needed for these. Native suites skip without the operator URI — report skips separately.
- Frontend: `npm run build`, `npm run lint`, `npm test` in `frontend/`. Tests run in a Node environment; follow the existing `renderToStaticMarkup` pattern for UI assertions, not a DOM.
- Focused commands: `npm test -- <relative-test-path> -t "<test-name>"`.
- Deterministic coverage must include: proposal revision/expiry/stale reference; duplicate confirm; voice/button race; one provider create; unknown outcome never retried; all-day/exclusive-end, multi-day, empty vs failure, truncation/pagination, missing fields, expired link/label; dismissal/reopen, navigation, reload hydration, historical read-only; dictation unchanged; no calendar tool exposure in dictation.
- Latency evidence: same model/provider request counts and storage reads/writes before/after; one bounded CPU projection + one frame; a delayed/throwing visual handler cannot delay speech/text or change terminal authority. Record probe metrics and noise honestly.
- No live Google/OpenRouter/LiveKit/paid checks without separate authorization. No database inspection/mutation.

## 11. Risks, unknowns and limitations

- **Durable live calendar admission** is the largest change. It must preserve the public HTTP stream's text-only rule, the reservation/topology rules, and all write safety. If not proven, degrade conversationally rather than claiming support.
- **`reset` narration in voice.** The publisher's text-oriented reset can double-speak durable narration unless the prefix rule is implemented; this is a UX bug, not an authority bug. Test it with local narration (clarification/failure) and model-streamed narration.
- **All-day schema change** touches the model-visible tool result and the frozen read schema. Additive optional fields are the smallest path; verify contract tests and the model's comprehension. If the provider read fields cannot carry `date` without changing the fields mask, this needs a deliberate, documented schema revision rather than a UI-only guess.
- **View size vs. limits.** A maximum 16 KB tool result plus envelope can exceed the 16 KB frame cap. The trim policy must be deterministic and visibly honest (`truncated`/`detailsTrimmed`), and the 8 KB legacy artifact limit is why the view should not be forced into `canvasArtifacts.rawSource` for large agendas.
- **Message schema change** (`calendarView`) is a durable-format change. It is additive/optional, but every strict message parse (message, visible message, archive, redaction, recovery) must be updated and round-tripped in tests.
- **Proposal → operation correlation** is ambiguous without `proposalId`/`intentId` on the operation projection; if the planners decline those fields, P2 must accept a turn-based workspace heuristic and document it.
- **Accessibility of a changing workspace.** Auto-open and live updates must not steal focus from the voice surface or the composer; keep focus on the voice panel, announce state via existing `role="status"`/`aria-live`, and do not animate under reduced motion.
- **No external certification.** This research is code-level only. It does not authorize or establish Google Calendar, LiveKit, OpenRouter, MongoDB/Azure, or staging verification.

## 12. Compatibility notes traced from current code

- Calendar stream protocol is 3 for v2 operations (`calendarMultiStreamEnvelopeSchema`, 16 KB frame cap); protocol 2 is legacy and must remain parseable where it already is.
- `calendarCompatibleTurnStateSchema` is a v1/v2 union; new fields must stay optional or live only in v2.
- `canvasArtifacts` remain voice-only; do not relax that guard for text.
- Dictation (`mode === 'dictation'`) excludes conversation-bound/voice-state/audio/canvas events; the new calendar events must follow the same exclusion.
- Text submissions require `calendarProtocol: 2` when calendar is enabled (`chat-http.service.ts`); voice submissions are internal and do not go through that HTTP validator.
- `messageRecordSchema` is strict; `visibleMessageSchema` is strict and already omits `visibility`/`sourceProvenance`. Any new field must be added to both the record and the visible projection (and the frontend type/guard) or it will be dropped.
- Existing `CalendarTurnRegion` helpers (`parseCalendarConfirmationDetails`, `resolveSafeReceiptLink`, `resolveReceiptCalendarLabel`, `describeCalendarProgress`, `describeOperationState`, `describeCalendarRetryAction`) are exported and should be reused rather than re-implemented.

## 13. Recommended plan handoff summary

- **P1:** voice admission of the existing Calendar loop (memory-first and durable fallback), `emitCalendar` → voice sink frames, `calendar.confirm` control via synthetic voice turn + `calendarReplyTo`, structured `calendar-view` with all-day/exclusive-end support, message `calendarView` persistence, and no new provider/storage work on the critical path. Update the fixed instructions. Unit tests for wire/projection/confirm/races and voice frame routing.
- **P2:** text manual-only calendar Canvas, voice auto-open/sticky dismissal and one workspace per request, agenda/review/outcome renderers without pan/zoom, confirm buttons through the live control, hydration/dedupe from `calendarView`, accessibility/reduced-motion, frontend tests.
- **P3:** fixture-driven voice lookup/confirm/outcome/reload scenarios, duplicate/race/stale-frame checks, deterministic before/after request/storage/latency comparison, delayed/throwing visual-sink non-blocking proof, package checks and honest skips/limitations in `verification.md`/`final_report.md`.

Nothing in this research expands beyond the three plans or the approved goal.
