# Voice Calendar Canvas — Goal

## Approval and workflow

- Date: 11 November 2026.
- Workflow: MAW, maximum **three implementation plans**.
- Product direction approved in conversation; this written specification awaits approval before research or agent dispatch.
- Unified review: **skipped**, per repository instructions. Research, planning, execution, defect correction, and final verification remain required.
- Additional user direction: keep implementation work very simple without simplifying away UI quality; latency is crucial and this feature must not add waiting to voice or text chat.

## Outcome

Make existing calendar capabilities usable during live voice with truthful, attractive visual feedback in Aurvin Canvas. Voice is the primary automatic Canvas experience. Text answers stay in the transcript and expose an explicit button to inspect calendar results in Canvas; text calendar actions must not automatically open Canvas.

This is a mode-specific presentation policy, not a requirement to duplicate Canvas infrastructure. Reuse existing operation authority, renderers, safe formatting, confirmation controls, and panel behavior wherever they fit. The backend remains the authority for calendar facts and write outcomes.

## Mandatory implementation discipline and latency budget

- Choose the smallest working change in the existing flow. No new orchestration framework, generic workflow engine, duplicate state machine, or parallel calendar stack. A rich UI does not justify a complicated implementation.
- Reuse the authorization, proposal expiry, idempotency, schema validation, persistence, and safe-rendering checks already present. Add a check only where this feature introduces a genuinely new trust boundary or uncovered correctness risk; do not add speculative or repeated validations. The safety cases below are behavioral requirements, not instructions to build a new validation subsystem.
- **No added waiting on the voice or text critical path.** Do not add model calls, provider calls, polling, or extra round trips merely to build, validate, narrate, or display Canvas. Use structured data already produced by the calendar operation and push updates through existing event flows.
- Do not wait for Canvas rendering, animation, an acknowledgement, enrichment, or visual persistence before allowing speech or text to stream. Display progress/results as they become available. Reuse required durability boundaries; do not weaken write safety to make the UI faster.
- Keep presentation work bounded and lightweight; avoid heavy synchronous transformations in audio/stream callbacks. Use existing scheduling/batching where needed, not a new job system. Any asynchronous work must remain session-correlated and errors must not become unhandled failures or false write successes.
- Verify this rather than claiming literal zero overhead: compare representative deterministic before/after paths, record added model/provider requests and blocking awaits, and test that delayed/failed visual handling does not gate speech/text streaming or authoritative action completion. No added serial dependency or demonstrated latency regression is acceptable; report noisy/inconclusive measurements honestly.

## Confirmed experience

### Voice: automatic visual workspace

1. A calendar lookup or action opens Canvas when actual calendar work begins, without waiting for a final spoken answer or a model-generated code block.
2. Show a concise, real phase such as checking calendars, awaiting confirmation, or creating an event. Do not invent percentage progress or claim work before it starts.
3. Update the same operation workspace as its state changes rather than opening a new tab for every progress frame.
4. Voice gives a short summary or asks for missing information; Canvas holds the details. Do not read every agenda entry by default. Reading details on explicit request remains possible.
5. Users may dismiss and reopen Canvas without affecting the microphone, playback, pending proposal, or calendar operation. Ordinary updates to an already-dismissed operation do not repeatedly reopen it; a genuinely new calendar request may open it again.

### Lookup results: agenda and details

- Display a polished agenda grouped by day, with clear title, start/end or all-day interval, time zone, and verified calendar label where available.
- Let users expand an event to inspect returned details, such as location, description, attendees, and a validated calendar link. Do not fabricate missing fields or retrieve extra sensitive fields solely to fill a design.
- Handle multi-day and all-day events accurately, including exclusive end dates; preserve existing calendar permissions and disclosure rules.
- Label the requested date range and time zone. Distinguish no events from lookup failure, unavailable calendars, partial coverage, and truncated/paginated results. Bound payloads and rendering; use existing continuation mechanisms where available rather than implying completeness.
- Keep details as ordinary accessible UI, not diagram zoom/pan content. Fit the existing Aurvin design, responsive layout, and reduced-motion behavior.

### Confirmation and execution

- In voice, use an inline Canvas review card rather than a blocking confirmation modal. Show the exact proposed action, target calendar, event details, and consequences exposed by the existing supported action.
- Support explicit spoken confirmation/rejection and accessible confirm/cancel buttons. Both paths resolve the **same server-authorized pending proposal**, not parallel execution paths.
- A spoken confirmation is valid only for one unambiguous, current proposal in the correct user/session. Bind it to the proposal identity/revision and existing expiry/authorization rules. An ambiguous, expired, replaced, or already-resolved proposal cannot authorize a write.
- Changing proposal details invalidates the previous confirmation. Double clicks, duplicated speech events, and voice/button races must not execute a second write.
- Transition that card through awaiting confirmation, execution, and the actual terminal outcome. Show success only from durable authoritative evidence; keep failed and uncertain outcomes visibly different. Never silently retry an uncertain write.
- Closing Canvas is not rejection. Interrupting speech is not confirmation, cancellation of a committed write, or proof that no charge/write occurred. Reuse existing operation cancellation semantics and explain the result truthfully.
- Text retains inline calendar feedback and its confirmation interaction. Calendar results include an explicit Canvas button, and only clicking it opens the panel. This deliberately supersedes the existing text calendar-success auto-open behavior; unrelated diagram/chart behavior is unchanged.

### Continuity and isolation

- Retain completed lookup/result artifacts and authoritative action outcomes in conversation history using established storage boundaries, so leaving voice or reloading does not erase the visual result.
- Historical cards are snapshots, not live authorization. Reopening history never replays an action or reactivates an expired proposal; resume a live proposal only if server revalidation supports it.
- Correlate projections by user/session/turn/operation/proposal as appropriate. Ignore stale or unrelated frames; navigation, reconnect, and mode switches must not leak another session's results or show a stale success.
- Preserve existing voice transcript, Canvas artifacts, normal calendar text behavior, and supported voice transports.

## Scope boundaries

- Enable and present calendar operations already implemented and authorized in Aurvin. A shared LLM alone is not proof that the voice runtime can execute them; research must trace the actual path.
- Do not add new calendar providers, unsupported update/delete actions, a full calendar application, drag-and-drop scheduling, or broader agent tool execution.
- No new dependency unless an existing capability demonstrably cannot cover the requirement and the need is reported.
- No public deployment, external provisioning, credential changes, paid/live provider tests, or changes to calendar data. Routine verification uses deterministic fixtures. Any live checks require separate explicit authorization.

## Architecture and alternatives

Chosen: extend existing calendar operation events/projections and Canvas with voice-specific automatic presentation and explicit text entry points. Calendar views are derived from structured results, not model prose or generated chart syntax.

Alternatives not selected:
- A separate voice-only calendar backend/UI would duplicate authority and create confirmation drift.
- Model-authored visual blocks alone cannot reliably express pending authorization, real progress, or durable outcomes.

## Acceptance criteria

- **AC1 — Voice lookup:** actual lookup activity automatically opens a loading workspace, then an accurate day-grouped agenda; voice summarizes rather than enumerating by default.
- **AC2 — Text behavior:** lookup details remain readable inline with an explicit Canvas entry point; no calendar operation/result automatically opens Canvas in text mode. Existing non-calendar Canvas behavior is unchanged.
- **AC3 — Confirmation:** exact proposal details appear in voice Canvas; explicit speech or buttons authorize the same proposal once, with revision/expiry/session checks and safe race handling.
- **AC4 — Truthful lifecycle:** progress, clarification, cancellation/rejection, success, failure, and unknown outcomes reflect backend state. Dismissal and barge-in do not imply operation cancellation or approval.
- **AC5 — Agenda integrity:** empty, partial, unavailable, bounded/paginated, timed, all-day, multi-day, time-zone/DST, and missing-field cases are represented without invented facts or false completeness.
- **AC6 — Continuity:** dismiss/reopen, mode switch, reconnect/reload, historical reopening, and session navigation preserve results without replaying writes or leaking/sticking stale state.
- **AC7 — Accessible presentation:** keyboard/screen-reader usable controls, responsive desktop/mobile layout, safe description/link rendering, and reduced-motion support; existing voice playback and artifacts remain usable.
- **AC8 — Evidence:** deterministic unit and integration checks cover the above; both packages' build/lint/test commands and backend e2e are run and reported honestly, with baseline failures and prerequisite skips separated. No source-only claim of completion.
- **AC9 — Minimal work, latency preserved:** reuse existing flows and safeguards, add no display-only model/provider calls or blocking round trips, and demonstrate that slow/failed Canvas handling cannot delay voice/text output. Record a representative before/after comparison without pretending noisy timings prove zero overhead.

## Three-plan boundary

1. **P1 — Calendar authority and voice bridge:** structured lifecycle/results, existing runtime integration, safe proposal confirmation, durable result projections, backend/wire tests.
2. **P2 — Voice-first Canvas and text entry points:** agenda/review/outcome views, auto-open/dismiss policy, voice state/controls, text buttons, persistence hydration and frontend tests.
3. **P3 — Integrated verification and completion:** fixture-driven cross-layer scenarios, latency/non-blocking evidence, browser interaction evidence where available, compatibility/regression checks, test-discovered corrections routed to the owning worker, and final evidence/report.

Research may refine file ownership and interfaces, not increase the plan count or expand product scope without approval.
