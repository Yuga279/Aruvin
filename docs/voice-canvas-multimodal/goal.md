# Goal: Multimodal live voice Canvas

## Status and authority

- Source: [approved PRD v1.0.0](../voice-canvas-multimodal-prd.md), dated 2 November 2026.
- This goal translates that baseline into repository-specific boundaries. The clarifications below require review of this written goal; PRD approval is not approval of an implementation that silently relaxes its acceptance criteria.
- Current authorization: **write this goal and a fully constructed state/DAG only**. Do not create implementation plans, dispatch agents, implement, or run live/service checks in this session.
- Future workflow: MAW, exactly three implementation plans, `--skip research,review`. Planning, execution, defect correction, and final verification remain mandatory after explicit authorization to resume.

## Outcome

During a live voice call, Aurvin can explain a concept aloud and produce a silent Canvas visual. A complete visual opens alongside the call, can be dismissed and reopened without disturbing media, survives interruption, and remains available with its associated explanation after exit and reload.

Reuse the existing voice runtime, delivery accounting, Canvas parsers/renderers, message archive, and session ownership. Do not create a second inference, runtime, media session, or visual storage service.

## Design choice and alternatives

1. **Recommended: one generation, separate speech and artifact channels.** Incrementally filter model output into clean speech and bounded visual descriptors; save visuals with their originating assistant message. Preserve the existing equality between assistant speech content and voice delivery `textGenerated`. Reuse Canvas for both live and archived visuals.
2. Store raw Markdown in assistant `content` and filter only at TTS. This appears smaller, but breaks current heard-prefix, reconciliation, and context assumptions unless those paths are redesigned; do not choose it merely to save a schema addition.
3. Generate the visual with a second model request or build a synchronized media scheduler. This adds cost, latency, and lifecycle complexity; outside this goal. If strict timing cannot be met without it, return with measurements and request a scope decision.

## Functional design

### G1 — Mode instructions and response choreography

- Change only the live-voice restrictions in the shared instructions; preserve text mode, request-scoped mode selection, security rules, and the existing absence of live Calendar tools.
- For a visual answer, instruct the model to emit: **spoken concept explanation → spoken visual walkthrough → terminal silent Canvas block(s)**. No spoken prose may follow the visual suffix.
- Support existing Mermaid, chart, and graph syntax, including backtick/tilde fences and supported `<aurvin-canvas>` wrappers. `graph` source maps to the existing `chart` kind; do not invent a fourth renderer kind.
- Nonvisual answers remain natural speech without mandatory filler. Unsupported code, hidden tags, raw JSON outside recognized visuals, and unsafe markup stay silent.
- The streaming filter must enforce silence after the visual suffix begins even if the model violates the ordering instruction. No syntax, trailing model commentary, or partial fence/tag may leak into speech at any chunk boundary.

### G2 — Bounded extraction and live delivery

- Extend the existing incremental speech filter rather than adding a second token consumer. Capture only fully closed supported visual blocks; never emit a partial source as a complete artifact.
- Add the PRD server payload `canvas.artifact` with `turnId`, `responseId`, `kind: 'mermaid' | 'chart' | 'svg'`, `subType`, `title`, and `rawSource`, inside the existing voice envelope. Preserve protocol version 1 and deploy matching client/server contracts together; do not claim interoperability with an old client that rejects the new event.
- Update both portable wire definitions and their runtime guards. Accept this event only in live mode; reject malformed shapes, unknown kinds, invalid identifiers, and over-budget control messages. Keep the existing 131072-byte serialized control ceiling.
- P1 must freeze numeric source/title/subtype/per-response-count limits before its plan commits. These must fit the existing answer, message-document, and serialized control budgets, including UTF-8 and JSON overhead. No unbounded buffers, arrays, replay caches, or increased global audio queues.
- Emit each closed, structurally accepted artifact promptly through the active response sink; do not wait for all audio to drain or for the user to exit. Renderer-specific validation remains in the existing Canvas path and must fail without crashing the call.
- Use stable turn/response association and a deterministic block ordinal to deduplicate live events and reconcile their durable equivalents. Event sequence, connection epoch, conversation binding, and cancellation fencing remain authoritative. An artifact may arrive before `audio.start`; do not treat the audio event as the only proof of valid visual ownership.
- Stop collecting/emitting new artifacts once a response is invalidated. Already accepted complete artifacts remain available. Unsupported, malformed, unterminated, oversized, and interrupted partial blocks produce neither TTS syntax nor a broken live card.

### G3 — Durable messages, recovery, and visual follow-ups

- Keep assistant `content` and `VoiceDeliveryRecord` speech fields as clean speech; never append code to `textGenerated`, `textSpoken`, or `textRemaining`.
- Add backward-compatible, optional, bounded artifact metadata/source to the existing originating assistant message and visible-message projection. Preserve turn, attempt, and message linkage; do not add a collection or a whole-call transcript blob. Old messages with no artifacts continue to load unchanged.
- Include artifacts in the existing checkpoint result, finalization, cancellation-prefix publication, and recovery paths where applicable. A completed artifact retained during barge-in must not disappear merely because speech was cancelled. Never regenerate a visual or repeat paid inference to repair publication.
- Save accepted complete artifacts during the turn's durable lifecycle, not by relying on an exit-only client upload. Exit and subsequent archive reload recover the same artifacts without duplicates. A live event is provisional until persistence succeeds; failed durability must remain an honest failed/unknown outcome, not a claimed permanent save.
- Preserve speech delivery truth, including unknown/unheard portions. Project retained visual source separately into current-session follow-up context so a user can ask about a visible node after interruption; do not label it as heard speech or assert that a browser displayed it without evidence. Apply normal context budgets and avoid duplicating checkpoint-restored content.
- Post-call text chat must expose the associated assistant explanation and an inline Canvas card in the main transcript, not only inside the existing call-transcript modal. Retain call duration/transcript access, but do not let current voice grouping hide artifacts or duplicate the response. UI dismissal is not deletion of durable content.
- “Accessible indefinitely” means through ordinary durable archive reload subject to existing retention, deletion, and session access policies, not a new promise of infinite retention.

### G4 — Canvas and live-call UI

- Remove the voice-only exclusion from Canvas visibility. Compose `CanvasPanel` and `LiveVoicePanel` in the existing layout and use one session artifact list merging archived and accepted live artifacts.
- Auto-open a newly accepted complete artifact once; unrelated media updates, event replay, and archive refresh must not undo a user's dismissal. A later new artifact may open the panel again.
- Use the existing selection/open/closed-tab state. A tab close retains normal tab semantics; closing the last tab or the panel closes the panel. Both keep artifacts available through the toggle. A non-last tab close need not close the entire panel.
- Add a keyboard-accessible Canvas toggle with expanded state and a count of unique current-conversation artifacts, including archived and live artifacts. Disable it or omit it when no artifact is available. It works while audio is paused as well as while speaking.
- Enter from the right and exit to the right with a 300–350 ms cubic-bezier transition. Keep the panel mounted through exit animation without leaving hidden content focusable. Respect reduced-motion preferences and restore focus to a useful control.
- On desktop, reserve a right panel from approximately 380 px up to 50vw when space permits; shrink the call region without remounting its media controller. On narrow screens use the existing responsive Canvas pattern without horizontal overflow or inaccessible call controls.
- Toggle, tab, panel, and layout actions must never stop/restart microphone capture, replace the socket, clear audio, or alter mute state.
- Barge-in and “Stop speaking” retain immediate local audio interruption, targeting **under 250 ms**, while accepted visuals remain mounted and usable. Ensure the existing optional interrupt action has an accessible UI path.

### G5 — Timing requirements and honest evidence

The PRD's desired experience remains: no artifact-generation-induced playback gap, Canvas visible within five seconds of turn start, and the visual visible before the spoken walkthrough references it. The ordering instruction is necessary but **not proof** of those timing properties.

- The repository currently configures a 2000 ms output queue, not the illustrative 20-second playback buffer. Token generation speed, synthesized-audio backlog, transport backpressure, and audible playback are distinct. Do not increase queue limits or claim 20 seconds are queued from prose length alone.
- Measure user-turn start, first audible audio, complete artifact receipt, first rendered visual, audible walkthrough reference, any artifact-associated queue underrun, and local interruption completion. Report the clock definition and test environment.
- Deterministic fixtures must cover normal rates and delayed/slow visual generation; report timing misses, not just successful event order. Do not pad answers, replay audio, or hide pauses with fabricated content.
- A prompt-only design cannot universally guarantee zero silence, a five-second deadline, or visual-before-walkthrough under arbitrary model/provider/browser delays. This is an explicit baseline clarification requiring approval with this goal, not a waiver of AC-1–AC-3. Retain those criteria as measured gates. If they fail in the agreed scenario, report the failure and obtain a scope/acceptance decision rather than declaring success.
- Real provider/browser certification requires separately authorized, bounded-cost checks. Offline fixture success is not proof of production latency or audible synchronization. If live checks remain unauthorized, mark those gates unverified and the overall workflow blocked for full acceptance, rather than complete.

## Acceptance coverage

| PRD criterion | Required evidence | Primary owner |
| --- | --- | --- |
| AC-1; REQ-1–3 | Full concept/walkthrough speech in order; every fence/tag chunk split silenced; no post-visual speech; fixture playback has no visual-induced underrun; measured live result distinguished | P1, P3 |
| AC-2; REQ-4–5 | Complete visual only; right-to-left 300–350 ms entry; five-second timing target recorded; responsive and reduced-motion checks | P2, P3 |
| AC-3 | Timestamped render versus audible walkthrough, including deliberately slow generation; no synchronization claim from callback order alone | P3 |
| AC-4–5; REQ-6 | Panel/tab exit and toggle reopening, stable count/selection, keyboard access, unchanged capture/socket/playback identity | P2, P3 |
| AC-6; REQ-7 | Under-250 ms local interruption evidence, retained complete visual, discarded partial source, no late/replayed cancelled artifact | P1, P2, P3 |
| AC-7; REQ-8 | Exit, reload, and recovery retain linked clean explanation plus inline card; no duplicate or hidden artifact; follow-up context retains visual without claiming unheard speech was heard | P1, P2, P3 |
| AC-8 | Mermaid flowchart and sequence; categorical bar, line, and pie; X-Y scatter; existing supported SVG safety unchanged | P1, P2, P3 |

## Boundaries and non-goals

- No new model request, external renderer, package, queue service, collection, authentication feature, deployment, or provider configuration change.
- Do not enable arbitrary HTML/JavaScript, external resource fetching from source, new SVG privileges, or live tool execution. Preserve Canvas rendering safety and server-side credentials/identity attribution.
- Do not rewrite the media engine, text-chat Canvas, general transcript grouping, unrelated Calendar behavior, or retention policy beyond the exact integration required here.
- Research and unified code review are **skipped**, never passed. Worker investigation of affected code, targeted compatibility documentation, regression diagnosis, and final tests are still required.

## Delivery and completion

The three units are **P1: backend extraction, contracts, durability, and context**, **P2: frontend live Canvas, transcript integration, and controls**, and **P3: integrated interruption, persistence, and timing verification**. Detailed ownership, planner readiness, worker dependencies, acceptance mapping, and resume procedure are in [state.md](state.md).

This preparation ends after the two documents are checked and committed. A later explicit approval/resume is required to write `plan1.md`–`plan3.md` and execute them. Completion later requires passing required offline checks, recorded live timing evidence or an explicit acceptance decision, `verification.md`, and `final_report.md`; code or documentation presence alone is not completion.
