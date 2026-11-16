# P1 Backend Voice Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver bounded, silent live-voice visuals through the existing response pipeline, retain them with their originating assistant message across interruption and recovery, and expose their source honestly in follow-up context.

**Architecture:** Keep one model stream and the runtime-owned `SpeechProse` filter; split its output into clean speech and complete visual descriptors. Journal accepted descriptors through the existing lease-bound `VoiceDelivery` writer before emitting a live event, then publish the same descriptors inside the assistant message and saved graph result. Reuse the existing message archive, checkpoint publication, reference manifests, and Canvas renderers; add no model request, collection, dependency, media scheduler, or exit upload.

**Tech Stack:** TypeScript/NodeNext, NestJS, existing LangGraph/checkpointer, MongoDB record repositories, Zod 3, portable dependency-free browser contracts, Vitest, React/Vite consumers owned by P2.

---

## Authority, execution rules, and inspected baseline

- Implement only P1 of [goal.md](goal.md), under the ownership and exit gate in [state.md](state.md). The explicit planner assignment and current authorized state supersede preparation-era stop paragraphs. Do not edit those documents as part of this plan.
- This deliverable is planning only. Its snippets are implementation instructions, **not implemented or tested application code**.
- Worker W1 loads the installed `executing-plans` and `test-driven-development` skills. Execute in the assigned worker; do not create another worker hierarchy merely because the standard header mentions subagent-driven execution. Research and unified review remain **skipped**, not passed.
- The supplied `C:\Users\Peter.gemini\config\skills\writing-plans\SKILL.md` did not exist. The installed equivalent at `C:\Users\Peter\.config\opencode\skills\writing-plans\SKILL.md` supplied this plan's structure.
- Existing files inspected: all source paths in the ownership list below, existing voice agent/runtime/persistence/context suites, `backend/src/agent/state.ts`, `backend/src/context/reference-selection.ts`, `backend/src/context/context-budget.ts`, `backend/src/persistence/{records,metadata}.ts`, the voice flow/transport, and frontend Canvas types/classification and API client.
- `SpeechProse` is constructed in `DurableChatRuntime.executeOwnedTurn`, not in `AgentVoiceAdapter`. The adapter must not consume model tokens or instantiate a second filter.
- `SavedResult.assistant` already uses `messageRecordSchema`. Adding the optional message field automatically covers the saved result; **do not edit the graph state/channel files** or introduce another checkpoint channel.
- `MongoMessages.append` is immutable; do not attempt to append a growing assistant message on every artifact. The existing `metadata` voice-delivery record already supports serial sequence-CAS writes and recovery reads, making it the bounded in-flight journal.
- `MongoMetadata.checkedDelivery` already enforces attempt/input linkage and document size. Its current transition code does not itself enforce an artifact prefix. W1 enforces append-only artifacts in `VoiceDelivery`, validates all runtime delivery writes, and preserves the journal on reconciliation; no metadata repository edit is authorized here.
- `MongoMessages.list` currently exposes internal voice speech through `voiceTranscripts` with public `content: ''`. Preserve that compatibility; add top-level artifacts instead of changing the meaning of speech or rewriting call summaries.
- `frontend/src/api/client.ts` currently casts message responses rather than validating the whole response. P1 supplies a reusable artifact-field guard in `protocol.ts`; P2 must call it before converting archive artifacts. Do not expand this into unrelated HTTP client validation work.
- Preserve user changes. Before every commit coordinate the shared index with the orchestrator and stage named owned files only. New code/test files need the mandatory repository header; preserve existing headers. No paid calls, microphone runs, service checks, provisioning, or deployment are authorized.

## Exact ownership and file structure

### Implementation files W1 may modify

1. `backend/src/instructions/system.md` — live voice choreography only.
2. `backend/src/contracts/voice-wire.ts` — canonical portable descriptor, numeric caps, pure guards, new live event.
3. `backend/src/contracts/canvas-artifact.ts` — **new** Zod boundary around the portable descriptor/list guards, not a renderer or second extraction service.
4. `backend/src/contracts/message.ts` — optional bounded assistant artifact field; preserve the unrefined object for API picking.
5. `backend/src/contracts/api.ts` — visible-message field and assistant/live field validation.
6. `backend/src/contracts/voice.ts` — optional bounded in-flight artifact journal; leave all speech fields and prefix rules intact.
7. `frontend/src/api/voice-protocol.ts` — exact portable mirror, dependency-free.
8. `frontend/src/api/protocol.ts` — visible artifact type and reusable field guard, not UI behavior.
9. `backend/src/voice/agent/speech-prose.ts` — bounded complete-block capture, metadata classification, suffix latch, existing prose cleanup.
10. `backend/src/voice/agent/agent-voice-adapter.ts` — active-response journal/sink bridge and cancellation fencing.
11. `backend/src/voice/agent/voice-delivery.ts` — serialized append-only artifact acceptance through the existing writer.
12. `backend/src/chat-runtime/ports.ts` — optional compatible `LiveExecution.artifact` hook.
13. `backend/src/chat-runtime/durable-chat-runtime.ts` — filter callback consumption, budgets, generated result, recovery handoff.
14. `backend/src/chat-runtime/finalization.ts` — validate journal/result linkage and artifact equality before publication.
15. `backend/src/chat-runtime/reconciliation.ts` — publish retained complete artifacts on incomplete-turn recovery; preserve speech truth.
16. `backend/src/chat-runtime/history.ts` — P1-owned/read and verified; **no change expected** because terminal live messages, including empty-speech messages, already pass `eligible`. Modify only if the new test demonstrates a real gap.
17. `backend/src/context/referenced-context-assembler.ts` — separate generated-visual context after heard-speech projection.
18. `backend/src/persistence/messages.ts` — backward-compatible top-level archive projection and role-boundary validation.

### Exact owned test files

1. `backend/src/contracts/voice.spec.ts`
2. `backend/src/contracts/canvas-artifact.spec.ts` — **new**
3. `backend/test/voice/agent/speech-prose.spec.ts`
4. `backend/test/voice/agent/pipeline.spec.ts`
5. `backend/test/voice/agent/voice-delivery.spec.ts`
6. `backend/test/voice/agent/submission.spec.ts`
7. `backend/test/runtime/voice-output.spec.ts`
8. `backend/test/runtime/voice-history.spec.ts`
9. `backend/test/persistence/voice-messages.spec.ts`
10. `backend/test/context/voice-context.spec.ts`
11. `frontend/src/api/voice-protocol.test.ts`
12. `frontend/src/api/protocol.test.ts`

Keep small fixture extensions local to these files; read/import existing fixture helpers without modifying them. P3's three named integration files and evidence document are **not** W1-owned. Any necessary additional path, including metadata repository, graph state, flow/transport, reference selection, startup factory, or native test edits, needs an orchestrator ownership update before writing it.

## Frozen P2/W1 handoff — normative

This section is frozen at L1. Any change to its fields, caps, normalization, keys, or lifecycle behavior pauses P2/P3 until the orchestrator records the reconciled handoff. Optional compatibility means old **records** remain readable; an old strict voice client is not interoperable with the new event. Deploy matching portable contracts together, keeping protocol version 1.

### Portable exports and exact wire shape

Define these exports after `VOICE_PROTOCOL_VERSION` in `voice-wire.ts`, and copy the entire portable body to `voice-protocol.ts`. The existing contract test compares those bodies byte-for-byte.

```typescript
export const CANVAS_ARTIFACT_LIMITS = Object.freeze({
  sourceMaxChars: 8192,
  sourceMaxBytes: 16384,
  titleMaxChars: 120,
  titleMaxBytes: 480,
  subTypeMaxChars: 48,
  subTypeMaxBytes: 192,
  maxArtifactsPerResponse: 3,
  responseSourceMaxChars: 16384,
  responseSourceMaxBytes: 24576,
  projectionMaxBytes: 32768,
  messageReserveBytes: 33792,
  headerMaxChars: 512,
  headerMaxBytes: 1024,
});
export type CanvasArtifactKind = 'mermaid' | 'chart' | 'svg';
export type CanvasArtifactSource = {
  ordinal: number;
  kind: CanvasArtifactKind;
  subType: string;
  title: string;
  rawSource: string;
};
export type CanvasArtifactProjection = CanvasArtifactSource & { responseId: string };
export type CanvasArtifactPayload = {
  type: 'canvas.artifact';
  turnId: string;
} & CanvasArtifactProjection;
```

Add `| CanvasArtifactPayload` to `VoiceServerPayload`. Its fully serialized event has **exactly** these 13 keys, with no nested artifact and no optional artifact fields:

```json
{
  "protocolVersion": 1,
  "sessionId": "voice-session-id",
  "connectionEpoch": 1,
  "eventId": "wire-event-id",
  "sequence": 7,
  "type": "canvas.artifact",
  "turnId": "accepted-turn-id",
  "responseId": "deterministic-response-id",
  "ordinal": 0,
  "kind": "mermaid",
  "subType": "Flowchart",
  "title": "Approval path",
  "rawSource": "flowchart TD\nA --> B"
}
```

- `sessionId` in the envelope is the **voice session**, not the conversation. `conversation.bound` supplies the conversation before artifacts. The enclosing durable message supplies conversation/turn/message ownership on archive reload.
- `responseId` remains `key('voice-response', userId, conversationId, attemptId)` using the existing SHA-256 tuple helper. Both runtime and adapter derive precisely this value; never use an independent UUID, content hash, speech ID, or generation ID.
- New payload `turnId`/`responseId`, projection `responseId`, and canvas-event envelope `sessionId`/`eventId` use `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`. This rejects blank, whitespace, control-character, non-string, and overlong identities. Do not tighten unrelated existing event identifiers in this change.
- `ordinal` is an integer in `[0, 2]`. It is the zero-based position among the first three **supported visual candidate openers**, including candidates later discarded as empty, malformed, oversized, or incomplete. Unsupported code fences do not consume it. Gaps are valid; never renumber accepted descriptors after discards. All subsequent supported candidates are silenced but not captured.
- Stable frontend identity is `` `${responseId}::canvas::${ordinal}` ``. Scope stores to the bound conversation. Keep `turnId` as an ownership check. `eventId`, envelope sequence, title, renderer parse index, and source are **not** artifact identity. No `artifactId`, `messageId`, timestamp, display receipt, or persistence flag is added to the event.
- Event is server-only and **live-only**. In both mirrors extend `serverShapes` and `isVoiceServerEvent(value, mode)` together; add `canvas.artifact` to that guard's dictation-forbidden event list. `isVoiceClientEvent` and client-direction `parseVoiceControl` never accept it. Maintain exact-key checking and existing epoch/sequence checks. It may precede `audio.start` and must not change audio sequence/origin or create playback state.
- `MAX_VOICE_CONTROL_BYTES` remains **131072 bytes**. `parseVoiceControl` still checks both string length and `TextEncoder` UTF-8 length before JSON parsing; sender still passes its event through that parser. Do not bypass this for artifacts.

### Guard semantics and budgets

Export pure `isCanvasArtifactId`, `isCanvasArtifactSource`, `isCanvasArtifactProjection`, and `isCanvasArtifactProjectionList` from both portable mirrors. Define source/projection validation by exact key sets, type/kind/ordinal/identifier checks and the caps above. Define list validation as follows:

```typescript
export function isCanvasArtifactProjectionList(value: unknown): value is CanvasArtifactProjection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 ||
      !value.every(isCanvasArtifactProjection)) return false;
  const items = value as CanvasArtifactProjection[];
  return items.every((item, index) => item.responseId === items[0].responseId &&
      (index === 0 || item.ordinal > items[index - 1].ordinal)) &&
    items.reduce((n, item) => n + item.rawSource.length, 0) <= 16384 &&
    items.reduce((n, item) => n + new TextEncoder().encode(item.rawSource).byteLength, 0) <= 24576 &&
    new TextEncoder().encode(JSON.stringify(items)).byteLength <= 32768;
}
```

- All string lengths are **UTF-16 code units**, as in existing JS `.length` contracts; all byte caps are UTF-8. Strings must have well-formed surrogate pairs. Use iteration by Unicode code point to reject isolated surrogates; do not depend on a Node-only API in portable contracts.
- `title`/`subType` must be nonempty, trimmed, single-line strings, excluding C0 and DEL characters; check both char and byte caps. Reject metadata that exceeds caps; do not truncate it into a different identity/title. Missing metadata is replaced with the deterministic defaults below before validation.
- `rawSource` must be nonempty, outer-trimmed, valid Unicode, and contain no C0/DEL except LF, CR, and TAB. Extractor normalizes CRLF to LF before trimming. Guards do not rewrite values. Source contains **only the body**, not the enclosing fence, wrapper, prose, hidden reasoning, or a repaired/automatically closed body.
- Lists are optional but, when present, nonempty. Absent means no artifacts; do not write `[]`, `null`, or explicit `undefined`. Old records decode with the field absent. List order is ascending ordinal, all from one response; duplicate ordinals or conflicting payloads are invalid.
- Keep existing raw-answer limit **32000 UTF-16 units**, and use the attempt's frozen `snapshot.budgets.maxInputChars` if lower. The model adapter's raw UTF-8 output/token limits also remain active. Visual syntax, hidden output, and trailing suppressed text count against the raw-answer budget; capture is not an unlimited side channel.
- At most three candidate descriptors and one bounded raw answer buffer exist per turn. The filter's existing maximum bounds even unterminated hidden/fenced units. Count-check before buffering a fourth candidate. Do not introduce per-token durable writes or a session-wide replay map.
- Whole live artifact array serialized JSON must fit **32768 bytes**, including escaping, keys, ordinals and response IDs. Aggregate sources must also fit **16384 chars / 24576 UTF-8 bytes**. A candidate that would exceed any aggregate cap is silently discarded, without removing previously accepted artifacts or reopening speech.
- One event is well below 131072 even under maximum permitted JSON escaping; assert actual serialization of maximum-size and multibyte examples. The envelope's independent byte gate remains authoritative, including adversarial IDs/whitespace.
- Default message cap remains **65536 bytes**. For live turns only, subtract **33792 bytes** from `outputBudget` after the existing empty-document/headroom calculation: 32768 projection bytes plus 1024 for BSON array/object/key differences. Feed the remaining budget to the existing model adapter. Refuse nonpositive capacity before inference with `STORAGE_BUDGET_EXCEEDED`.
- Before accepting each artifact into the journal, run `bounded(messageRecordSchema, candidateAssistant, messageKey, effectiveMessageLimit)` using the actual assistant sequence, current clean speech, and proposed artifact list. Check the assembled final assistant again before checkpoint seal. Never increase storage/document/checkpoint/audio-queue caps to fit a visual. Smaller configured budgets may reject a response; report this honestly instead of promising every maximum can coexist.
- The delivery journal uses existing `maxDocumentBytes`; speech generated/spoken/remaining still obey their current 32000-character schema limits. Finalization and recovery continue to use repository/BSON size checks and existing checkpoint limits. No assumption about Azure document capacity is introduced.

### Recognized block grammar and classification

The extractor is a framing/classification boundary, **not** a replacement Canvas renderer. Keep text-mode parsing untouched.

- Fences: backtick or tilde runs of at least three characters at line start with zero to three spaces. The closing run is the same character, at least opener length, followed only by horizontal whitespace and newline/end-of-response. Never use a simple `indexOf('```')` that closes on a body string or a shorter run. An incomplete closing line waits for more input or `finish()`; a real EOF can finish an already-present closing run, but never invent one.
- Recognize the existing Canvas aliases: `mermaid`, `mmd`; `chart`, `graph`, `plot`, `scatter`, `xy`, `xy-plot`, `line-graph`, `bar-chart`, `line-chart`, `pie-chart`, `area-chart`; `svg`; `canvas`; recognized chart-shaped `json`; and empty-language fences with an existing Mermaid header. Backtick and tilde forms use identical classification.
- Wrappers: a complete case-insensitive `<aurvin-canvas ...> ... </aurvin-canvas>` with the same `type` and `title` metadata forms as the existing Canvas parser. Accept quoted single/double or bare attribute values, case-insensitive names, and multiline whitespace. Reject conflicting duplicate `type`/`title` attributes, nested Canvas wrappers, and headers over 512 chars/1024 bytes. Unknown attributes are not authority and are ignored for classification; never forward them as HTML.
- `canvas`/wrapper type aliases follow the existing frontend `parseCanvasCodeBlock`: diagram/flowchart/mermaid → Mermaid; chart/graph/plot/scatter/xy/bar/line/pie/area → chart; svg → SVG; absent type infers Mermaid header, then SVG root, otherwise chart. A `json` fence is a candidate only if it is a JSON object with recognized chart `type` and `data`, `datasets`, or `points` keys; classify JSON in the silent fence state, never by speaking its opening bytes. Empty-language fences remain silent until their body can be classified.
- Once a supported alias is known at its opener, latch suffix silence **immediately**, even when its body later fails. For empty-language/JSON inference, keep the entire block silent, and latch suffix silence as soon as its supported body is recognized. An unclassifiable fence remains ordinary silent code, allowing safe prose after its close as before.
- Strip wrapper/fence delimiters, normalize CRLF, and outer-trim body; preserve interior bytes and all labels/values. Do not fix malformed JSON/Mermaid, synthesize absent chart values, or parse source from hidden `<think>`/`<analysis>` content. Hidden blocks always have precedence over candidate recognition.
- JSON-looking chart bodies must successfully `JSON.parse` to a non-null object/array before acceptance. A line-oriented chart must contain at least one data-bearing numeric line/coordinate pair, after optional title/type/axis directives. A Mermaid body must match the existing Mermaid header family, allowing its existing frontmatter/comments. An SVG body must begin with an SVG root and contain its closing root (or a complete self-closing root). These are conservative structural gates; full chart/Mermaid/SVG rendering and SVG allowlists remain the existing frontend's responsibility. P2 catches conversion/render failure without adding a broken live card or crashing media.
- An explicitly titled block uses that title. Otherwise use a bounded source title from existing Mermaid title/frontmatter, JSON `title`, or SVG `<title>`/`aria-label`; otherwise default to the subtype. `graph` **always maps to kind `chart`**, never a fourth kind.
- Canonical backend subtype/default-title strings: Mermaid `Flowchart`, `Sequence Diagram`, `State Diagram`, `Class Diagram`, `ER Diagram`, `Mindmap`, `Timeline Chart`, `Pie Chart`, `Coordinate Graph`; chart `Bar Chart`, `Line Graph`, `Area Graph`, `Pie Chart`, `X-Y Point Plot` (or `Coordinate Graph` for connected X-Y points); SVG `SVG Visual`. Preserve current chart alias/explicit-type precedence and JSON type detection. Untyped `graph` defaults to `Line Graph`, while untyped `chart` defaults to `Bar Chart`. Subtype is metadata, not executable renderer selection supplied by the model.
- P2 maps chart subtypes back to existing forced parser kind when needed (notably a line-default `graph` whose source lacks a `type`). Raw source and the frozen subtype must not change on archive reconciliation. Existing renderers remain the safety boundary; source text never goes into `dangerouslySetInnerHTML` or external resource fetching.

### Speech filter API and suffix semantics

Preserve `push(text): string` and `finish(): string` for existing callers. Add the optional second constructor callback and a read-only latch:

```typescript
new SpeechProse(maximum, (artifact: CanvasArtifactSource) => { pending.push(artifact); });
// public getter, initially false, irreversible once a supported visual starts:
filter.visualSuffixStarted;
```

The callback fires once only for a fully closed, structurally accepted, bounded block. It is synchronous; runtime drains its at-most-three pending results through an **awaited** hook, never a fire-and-forget persistence operation. `finish` discards partial fences, tags, headers and bodies. After suffix latch, all intervening/trailing prose and unsupported syntax are silent, but subsequent complete supported candidate blocks can still be captured within caps. No punctuation, metadata, hidden text, opening-prefix fragments, closing fragments, JSON, or post-visual commentary may leak at any chunk boundary.

Preserve prose normalization, factual identifiers, Unicode, negation and incremental clause release before the suffix. At a visual opener, drain the already-safe prose prefix even if it lacks final punctuation. Hold ambiguous `<`, backtick and tilde prefixes until classified; explicitly exclude tilde runs from the fast plain-clause release path. For a hidden block, fence, or wrapper, do not let sentence punctuation inside its body trigger plain release. Retain the existing 32000-answer `ponytail:` ceiling comment, updated to explain the bounded incremental scanner and migration ceiling.

### Durable schemas, publication, and P2 archive behavior

Add `canvasArtifacts?: CanvasArtifactProjection[]` to these existing records, with the **same** list schema:

1. `MessageRecord` — original assistant record only, `role: 'assistant'`, `mode: 'live'`, `visibility: 'internal'`, non-null `attemptId`, nonempty `voiceSessionId`.
2. `VoiceDeliveryRecord` — bounded journal for that same turn/attempt/voice session/response. Every descriptor's `responseId` must equal the record's `responseId`.
3. `VisibleMessage` — public assistant/live projection with `voiceSessionId`, same descriptors, **no attempt/user/provider fields**. Parent `messageId`, `turnId`, event and sequence retain their existing values.

Keep schema versions 1. Export `messageRecordObjectSchema` for the pre-refinement object; define `messageRecordSchema` by refining it. Change `api.ts` picking to `messageRecordObjectSchema.pick(...)`, include `canvasArtifacts`, then refine the public role/live/voice-session rules. This prevents adding a `.superRefine` from breaking the existing `.pick` call. No other `.pick/.shape` caller exists at planning baseline; re-grep before editing.

Example durable assistant shape (existing accounting/lifecycle fields are unchanged):

```typescript
{
  schemaVersion: 1, userId, sessionId: conversationId, turnId, attemptId,
  messageId: outputId(attempt), eventId: eventIdFor(userId, conversationId, outputId(attempt)),
  sequence: assistantSequence, role: 'assistant',
  content: 'First, requests are validated. Follow the branch from A to B.',
  createdAt, completionStatus: 'streaming', truncated: false,
  visibility: 'internal', mode: 'live', voiceSessionId,
  canvasArtifacts: [{ responseId, ordinal: 0, kind: 'mermaid', subType: 'Flowchart',
    title: 'Approval path', rawSource: 'flowchart TD\nA --> B' }],
}
```

- Assistant `content` is always the full **clean generated speech**, not a claim it was all heard. `textGenerated` equals that content after settlement/reconciliation; `textSpoken`/`textRemaining` preserve existing prefix/unknown semantics. No source is appended to those strings or `voiceTranscripts[].content`.
- Journal admission order: validate candidate and message fit → drain generated speech evidence without awaiting audio playback → serialize descriptor append through `VoiceDelivery`'s existing chain → await sequence-CAS durability → recheck active response/signal → emit `canvas.artifact` immediately through the existing sink. This is at block closure, not provider EOF, playback drain, or call exit.
- The event proves journal persistence, not final message publication, successful rendering, heard speech, or a browser display acknowledgment. P2 treats it as a complete but **provisional archive projection** until an authoritative message reload confirms it. No permanent-save badge based on the event alone.
- On normal completion, put the identical list in `SavedResult.assistant.canvasArtifacts`. `checkedResult` verifies deterministic response ID and exact equality with the scoped delivery journal before any publication. Existing immutable append, manifest, boundary seal, completion CAS and attempt transition remain authoritative.
- No new list is stored in manifests; they still reference original message/event/sequence. No whole-call blob, extra visible duplicate assistant, standalone artifact message, or second collection.
- Public projection remains `content: ''` for internal messages and exactly one clean `voiceTranscripts` item. Add `canvasArtifacts` at top level, never duplicate it in the transcript item. Preserve call duration, grouping identity and transcript access. P2 displays the assistant explanation from that transcript item alongside inline cards using the original message ID; P2 must not hide the cards inside the call pill/modal or render a second duplicate explanation.
- `frontend/src/api/protocol.ts`: import/export the projection type and add `isVisibleMessageCanvasArtifacts(value: unknown): boolean`. It returns true for a record with no `canvasArtifacts`; otherwise requires assistant/live/valid `voiceSessionId` plus `isCanvasArtifactProjectionList`. This is a field-boundary guard, not a claim to validate every historical `VisibleMessage` property. P2 calls it before archive conversion; malformed data produces no source/card, and the enclosing message/explanation remains reachable.

### Cancellation, failure, and recovery matrix

1. **Interrupt before candidate closes:** set active invalid synchronously, abort existing work, discard filter buffer/pending unaccepted candidates; emit/save no partial source. Preserve prior accepted complete artifacts.
2. **Invalidate before journal append starts:** `VoiceDelivery.artifact` returns false without writing. Adapter does not emit. Runtime does not add it to its result list.
3. **Invalidate during an already-started CAS:** finish tracking that write through existing Work/owner drain. If confirmed, retain the accepted journal descriptor, but recheck invalidation and suppress the live event. Never roll back/delete confirmed evidence to make cancellation look simpler.
4. **Journal write rejects or times out:** do not emit; invalidate generation and propagate failure. A timeout may have committed: quarantine/reconcile from stored evidence, not RAM or a fabricated failed save. Do not retry inference. Runtime's write callback remembers failure and rejects every later generation/delivery artifact admission while still allowing terminal speech settlement to be attempted.
5. **Live sink throws after journal success:** descriptor survives. The runtime follows existing disconnected/interrupted handling; journal-backed publication repairs the assistant. Do not resend it from an unbounded replay queue.
6. **Interrupt/failure before sealed result:** `interruptAttempt` reads the scoped delivery journal, validates linkage, merges its confirmed artifacts with the in-memory accepted prefix, and appends the one deterministic assistant message even when speech is empty. Recover speech from `partial` when present, otherwise `delivery.textGenerated`; it must extend the durable generated prefix. For non-live attempts keep existing behavior.
7. **Crash after journal success, before assistant exists:** reconciliation reads journal, creates that same assistant ID with terminal interrupted outcome and descriptors, rebuilds references, clears unfinished graph work and active attempt, then marks pending voice delivery unknown. No generation/synthesis call occurs.
8. **Crash after assistant append before recovery finishes:** use the immutable existing record. Verify its identity, clean generated speech, and exact artifact list against journal; never overwrite, append a second message, or silently discard a descriptor mismatch. A mismatch is `NOT_READY`/quarantine requiring repair, not a success.
9. **Sealed saved result or publication failure:** saved-result publication wins over a later cancellation as today. Replay `publishResult` using its saved assistant (with artifacts); compare journal linkage/equality, use existing idempotent stages. Two reconciliation runs produce one assistant and one artifact per key, with no paid request.
10. **Speech known unheard/unknown:** retained artifacts stay available independently. Pending/unknown speech evidence is never promoted to heard merely because a visual is saved. During `reconcileVoiceDeliveries`, spread old record fields so descriptors survive; validate assistant artifacts equal journal before changing delivery status.

`AgentVoiceAdapter` must check `!closed`, `!active.invalid`, `!signal.aborted`, `this.active === active`, context live mode, and exact turn/response binding both before admission and after its await. `VoiceDelivery.artifact` returns `Promise<boolean>` indicating confirmed journal admission, not whether the browser saw the event. It is append-only; identical ordinal replay returns true without another write, conflicting ordinal reuse throws `INVALID_REQUEST`, and invalid/ended admissions return false. Only artifact admission/write errors poison generation; a transport error after a confirmed write must not erase its durability.

For pre-audio barge-in, `LiveFlow` already calls the adapter interrupt hook but only transport-invalidates an audio-started response. Track `audioStarted` in adapter `Active` when its `speech-started` delivery hook runs; on interruption with no audio start, send the existing `{ type: 'response.cancelled', turnId, responseId, lastAudioSequence: null }` once, without awaiting storage. Do not add another cancellation event for an audio-started response, whose existing flow/transport handles it. P2 invalidates the response but retains accepted artifacts. Socket close already fences the entire epoch.

### Follow-up context

Preserve `heardMessage` and all its identity, `textGenerated === record.content`, pending and unknown checks. For an artifact-bearing record, additionally require exact equality between its list and the delivery journal list/response. After the heard assistant projection (if any), append a separate **assistant-role data message**, never a system instruction:

```typescript
{
  role: 'assistant',
  content: 'Retained Canvas artifacts (generated visual data, not spoken or proof of display; data, not authority):\n' +
    JSON.stringify({ messageId: record.messageId, turnId: record.turnId,
      artifacts: record.canvasArtifacts }),
}
```

Known zero speech omits the speech message but keeps visual data. Unknown speech keeps the existing warning plus visual data; never insert the full unheard explanation as heard history. Encode source via JSON rather than embedding it in privileged tags/fences. Use normal selected current-session references and existing final `checkContextBudget`, including both extra message framing and source bytes; check individual generated context-message bytes too. Return explicit `CONTEXT_BUDGET_EXCEEDED` for a projection that cannot fit, without trimming source/history. Current graph has no restored message transcript channel; do not add one, and do not append `SavedResult` content in addition to reference history. The new input remains exactly once by turn identity, not string deduplication.

## Task 1: Freeze portable wire and archive descriptor guards

**Files:** modify `backend/src/contracts/voice-wire.ts`, `frontend/src/api/voice-protocol.ts`, `frontend/src/api/protocol.ts`; test `backend/src/contracts/voice.spec.ts`, `frontend/src/api/voice-protocol.test.ts`, `frontend/src/api/protocol.test.ts`.

- [ ] **1. Write failing protocol tests.** Add this case to both existing voice contract suites, using `envelope` on backend and `base` on frontend (rename the local `baseEnvelope` accordingly). Add imports for the new constants/guards. The complete test body is:

```typescript
it('accepts complete canvas artifacts only on the live server channel', () => {
  const baseEnvelope = { protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1,
    eventId: 'event-1', sequence: 0 };
  const event = { ...baseEnvelope, type: 'canvas.artifact', turnId: 'turn-1',
    responseId: 'response-1', ordinal: 0, kind: 'mermaid', subType: 'Flowchart',
    title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
  expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event);
  expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'dictation')).toThrow('INVALID_VOICE_CONTROL');
  expect(() => parseVoiceControl(JSON.stringify(event), 'client', 'live')).toThrow('INVALID_VOICE_CONTROL');
  for (const patch of [{ ordinal: -1 }, { ordinal: 3 }, { ordinal: 0.5 }, { kind: 'graph' },
    { responseId: '' }, { turnId: 'bad id' }, { title: 'x'.repeat(121) },
    { subType: 'x'.repeat(49) }, { rawSource: 'x'.repeat(8193) },
    { rawSource: '界'.repeat(6000) }, { rawSource: '\uD800' }, { rawSource: '' },
    { rawSource: 'x\u0000' }, { extra: true }]) {
    expect(() => parseVoiceControl(JSON.stringify({ ...event, ...patch }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
  }
  const json = JSON.stringify(event);
  const exactCeiling = json + ' '.repeat(131072 - new TextEncoder().encode(json).byteLength);
  expect(parseVoiceControl(exactCeiling, 'server', 'live')).toEqual(event);
  expect(() => parseVoiceControl(exactCeiling + ' ', 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
});
```

Also test title/subtype byte limits and isolated low surrogate, every missing artifact property, extra nested values, wrong protocol, unknown kind, max legal ordinal, Unicode source, escaped/newline source, UTF-8 input larger than 131072 despite fewer code units, and inherited/non-own required keys. Extend the portable mirror equality assertion rather than replacing it with a subset comparison.

- [ ] **2. Run RED.** In `backend`: `npm test -- src/contracts/voice.spec.ts -t "canvas artifacts"`. In `frontend`: `npm test -- src/api/voice-protocol.test.ts -t "canvas artifacts"`. Expected: nonempty tests fail on rejected new event/missing exports, not on setup/network errors.
- [ ] **3. Implement the frozen portable exports/guards.** Add exact event shape, new dictation exclusion, Unicode/UTF-8 limits and list guard above. Use the existing `exact` helper; do not weaken `isEvent` for arbitrary fields. Implement a source-only key set and a projection key set rather than spreading untrusted objects. The new source guard's final predicate is:

```typescript
exact(value, { ordinal: v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 3,
  kind: oneOf('mermaid', 'chart', 'svg'), subType: canvasSubtype, title: canvasTitle,
  rawSource: canvasSource });
```

Define the local string guards next to the existing portable guards with these complete predicates:

```typescript
const utf8 = (value: string) => new TextEncoder().encode(value).byteLength;
const wellFormed = (value: string) => {
  for (const point of value) {
    const code = point.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
};
export function isCanvasArtifactId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
const canvasLabel = (maxChars: number, maxBytes: number): Guard => value =>
  typeof value === 'string' && value.length > 0 && value.length <= maxChars &&
  value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value) &&
  wellFormed(value) && utf8(value) <= maxBytes;
const canvasSubtype = canvasLabel(48, 192);
const canvasTitle = canvasLabel(120, 480);
const canvasSource: Guard = value => typeof value === 'string' &&
  value.length > 0 && value.length <= 8192 && value === value.trim() &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) &&
  wellFormed(value) && utf8(value) <= 16384;
```

Use the frozen named constants in the actual predicates rather than repeating their numeric literals. For canvas events apply `isCanvasArtifactId` to turn/response/voice-session/event IDs after ordinary envelope exact validation; leave unrelated guards untouched. Add the public visible artifact-field guard/type in `protocol.ts`:

```typescript
export function isVisibleMessageCanvasArtifacts(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!Object.hasOwn(value, 'canvasArtifacts')) return true;
  return value.role === 'assistant' && value.mode === 'live' &&
    isCanvasArtifactId(value.voiceSessionId) &&
    isCanvasArtifactProjectionList(value.canvasArtifacts);
}
```

Import `isCanvasArtifactId`, `isCanvasArtifactProjectionList` and the projection type from `./voice-protocol.ts`, and add `canvasArtifacts?: CanvasArtifactProjection[]` to `VisibleMessage`. Re-export that type for P2. Add protocol tests proving absent legacy field accepted, valid assistant/live accepted, user/text/null/empty/mixed-response/duplicate/descending/excess-count/aggregate-over-budget arrays rejected. The field guard is consumed by P2, not by a new HTTP abstraction.

- [ ] **4. Run GREEN.** Run both complete voice protocol files and `frontend/src/api/protocol.test.ts`; expected all existing and new assertions pass, including whole-body mirror equality. Verify maximum legal event is below 131072 serialized bytes.
- [ ] **5. Commit named paths.** Message: `feat(voice-canvas): freeze portable artifact event and guards`.

## Task 2: Add optional bounded schemas without changing speech

**Files:** create `backend/src/contracts/canvas-artifact.ts`, `backend/src/contracts/canvas-artifact.spec.ts`; modify `backend/src/contracts/message.ts`, `backend/src/contracts/api.ts`, `backend/src/contracts/voice.ts`; extend `backend/src/contracts/voice.spec.ts`.

- [ ] **1. Write RED schema tests.** Give the new test file the repository header and use existing `message`/`deliveryFixture` fixtures. Include this concrete round-trip test:

```typescript
import { expect, it } from 'vitest';
import { BSON } from 'mongodb';
import { message } from '../../test/persistence/fixtures.js';
import { deliveryFixture } from './testing/voice-fixtures.js';
import { messageRecordSchema } from './message.js';
import { visibleMessageSchema } from './api.js';
import { voiceDeliveryRecordSchema } from './voice.js';
import { canvasArtifactProjectionSchema } from './canvas-artifact.js';

const visual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
  subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
it('round trips bounded visuals separately from legacy speech', () => {
  const legacy = message(2);
  expect(messageRecordSchema.parse(legacy)).toEqual(legacy);
  const assistant = { ...legacy, role: 'assistant' as const, attemptId: 'a1',
    visibility: 'internal' as const, mode: 'live' as const, voiceSessionId: 'voice-1',
    content: 'Clean explanation.', canvasArtifacts: [visual] };
  expect(messageRecordSchema.parse(BSON.deserialize(BSON.serialize(assistant)))).toEqual(assistant);
  expect(canvasArtifactProjectionSchema.parse(visual)).toEqual(visual);
  const d = { ...deliveryFixture(), responseId: visual.responseId, canvasArtifacts: [visual] };
  expect(voiceDeliveryRecordSchema.parse(d).canvasArtifacts).toEqual([visual]);
  expect(messageRecordSchema.safeParse({ ...assistant, role: 'user' }).success).toBe(false);
  expect(messageRecordSchema.safeParse({ ...assistant, canvasArtifacts: [] }).success).toBe(false);
  expect(voiceDeliveryRecordSchema.safeParse({ ...d, responseId: 'other' }).success).toBe(false);
  const publicValue = { messageId: assistant.messageId, turnId: assistant.turnId,
    eventId: assistant.eventId, sequence: assistant.sequence, role: 'assistant', content: '',
    createdAt: assistant.createdAt, completionStatus: assistant.completionStatus, truncated: false,
    mode: 'live', voiceSessionId: 'voice-1', canvasArtifacts: [visual] };
  expect(visibleMessageSchema.parse(publicValue)).toEqual(publicValue);
});
```

Add cases for wrong role/mode/visibility/null attempt/missing voice session, unknown keys, descriptor and aggregate caps, three sorted ordinals, ordinal gaps, conflicting response IDs, and unchanged heard-prefix validation. For storage bounds call existing `bounded` with the worst legal array, multibyte speech and `DEFAULT_BUDGETS.maxMessageBytes`; prove the reserved budget fits and a candidate one byte beyond a configured limit rejects before admission.

- [ ] **2. Run RED.** `npm test -- src/contracts/canvas-artifact.spec.ts` in `backend`; expected missing module/export or rejected new field. Check nonzero discovery.
- [ ] **3. Implement the boundary using existing guards, not a second validation definition.** New file contents after its mandatory header:

```typescript
import { z } from 'zod';
import { isCanvasArtifactProjection, isCanvasArtifactProjectionList,
  type CanvasArtifactProjection } from './voice-wire.js';

export const canvasArtifactProjectionSchema = z.custom<CanvasArtifactProjection>(
  isCanvasArtifactProjection, 'Invalid Canvas artifact');
export const canvasArtifactsSchema = z.custom<CanvasArtifactProjection[]>(
  isCanvasArtifactProjectionList, 'Invalid Canvas artifact projection');
```

Rename the existing message object declaration to `messageRecordObjectSchema`, add `canvasArtifacts: canvasArtifactsSchema.optional()`, then export the refined `messageRecordSchema`. When the field is present require the exact assistant/internal/live/non-null-attempt/voice-session rules above, using `isCanvasArtifactId` for its voice session. Preserve exported `MessageRecord` inference. In `api.ts`, change its message import to `messageRecordObjectSchema`, pick from that object, add `canvasArtifacts: true`, then refine assistant/live/voice-session rules without expecting hidden `visibility` or `attemptId` in public data. In `voice.ts`, add the optional field and, in its existing `superRefine`, report an issue when any artifact's response differs from the record. Keep generated/spoken/remaining predicates unchanged.

- [ ] **4. Run GREEN.** `npm test -- src/contracts/canvas-artifact.spec.ts src/contracts/voice.spec.ts`; then `npm run build`. Existing graph result schema must accept artifacts by importing the refined message schema with **no graph edits**.
- [ ] **5. Commit named paths.** Message: `feat(voice-canvas): add bounded message and delivery projections`.

## Task 3: Capture closed visual suffixes in the existing incremental filter

**Files:** `backend/src/voice/agent/speech-prose.ts`, `backend/test/voice/agent/speech-prose.spec.ts`.

- [ ] **1. Write exhaustive RED tests.** Keep all current prose normalization tests. Add this local collector and cut-point test:

```typescript
import type { CanvasArtifactSource } from '../../../src/contracts/voice-wire.js';

function splitVisual(chunks: string[]) {
  const artifacts: CanvasArtifactSource[] = [];
  const filter = new SpeechProse(32000, artifact => artifacts.push(artifact));
  const spoken = chunks.map(chunk => filter.push(chunk)).join('') + filter.finish();
  return { artifacts, spoken, suffix: filter.visualSuffixStarted };
}
it('captures closed visual suffixes and never speaks syntax or trailing commentary at any cut', () => {
  const source = 'flowchart TD\nA --> B';
  const raw = 'Explain the concept. Follow A to B.\n```mermaid title="Approval path"\n' +
    source + '\n```\nThis trailing commentary must be silent.';
  const expected = { spoken: 'Explain the concept. Follow A to B.', suffix: true,
    artifacts: [{ ordinal: 0, kind: 'mermaid', subType: 'Flowchart', title: 'Approval path', rawSource: source }] };
  expect(splitVisual([raw])).toEqual(expected);
  expect(splitVisual([...raw])).toEqual(expected);
  for (let cut = 0; cut <= raw.length; cut++)
    expect(splitVisual([raw.slice(0, cut), raw.slice(cut)])).toEqual(expected);
});
it('emits a complete artifact before finish but never an unterminated one', () => {
  const artifacts: CanvasArtifactSource[] = [];
  const filter = new SpeechProse(32000, artifact => artifacts.push(artifact));
  expect(filter.push('Safe intro.\n~~~mermaid\nflowchart TD\nA --> B\n~~')).toBe('Safe intro.');
  expect(artifacts).toEqual([]);
  expect(filter.push('~\n')).toBe('');
  expect(artifacts).toHaveLength(1);
  expect(filter.push('~~~chart\n{"type":"bar","data":[')).toBe('');
  expect(filter.finish()).toBe('');
  expect(artifacts).toHaveLength(1);
});
```

Add concrete table fixtures for Mermaid sequence; JSON bar/line/pie/scatter; graph without type; graph with scatter; line-oriented chart; SVG; typed/untyped wrapper; `mmd` and chart aliases. For each run one chunk, each two-part cut, one-code-unit chunks, and a reproducible alternating 1/2/5/13-unit partition. Include CRLF and split surrogate pairs.

Add rejection fixtures: empty block; incomplete opener/header/closing line/tag; shorter/wrong fence; inline delimiter inside chart string; duplicate attributes; nested wrapper; invalid chart JSON; header/source cap+1 in chars and UTF-8; hidden reasoning containing an otherwise valid visual; four candidate blocks; oversized ordinal 0 followed by valid ordinal 1; safe unpunctuated prefix before a visual; trailing prose split after every closing delimiter. Assert exact safe prose, exact accepted descriptors, absence of every private/syntax sentinel, and ordinal stability. Aggregate response/projection overflow belongs in Task 5's runtime tests, because the runtime owns that admission decision. Existing unsupported code/hidden block tests must retain their previous safe trailing prose (only **supported** visual suffixes latch).

- [ ] **2. Run RED.** `npm test -- test/voice/agent/speech-prose.spec.ts -t "visual"`; expected missing callback/latch or missing descriptors, not a timeout.
- [ ] **3. Extend the scanner in-place.** Keep `plain`, `emitted`, total raw budget and existing push/finish signatures. Introduce bounded candidate/header/fence/tag state and irreversible suffix latch; classify using the normative grammar. The terminal acceptance operation must have this form (inside `SpeechProse`, after a real close):

```typescript
private acceptVisual(source: CanvasArtifactSource) {
  if (isCanvasArtifactSource(source)) this.onArtifact?.(source);
}
```

Declare `onArtifact` as the optional second constructor parameter, use the portable source guard, and gate collection by candidate ordinal before allocating another source. The runtime supplies response and aggregate validation. Scanner processing order must be: bounded append → continue any hidden/code/wrapper unit → detect a possible opener before plain release → drain safe prefix → classify supported start/latch → capture until a real close → validate/emit complete descriptor → continue scanning while suppressing all suffix prose. Unclassified code/hidden blocks stay silent as today. Make the `visualSuffixStarted` getter public and read-only. Do not call callbacks from speculative scans, `plain`, or incomplete EOF cleanup.

For a conservative scanner, retaining an unfinished unit within the already-enforced 32000-unit total is acceptable; do not add an unbounded string beyond that ceiling. A closed source over its per-source cap is discarded, and later supported candidates still scan with speech silenced. No buffering at all is needed for candidate 3 and later beyond detecting its closing delimiter. Keep a `ponytail:` comment naming the bounded raw-answer ceiling and the future richer-parser upgrade path.

- [ ] **4. Run GREEN.** `npm test -- test/voice/agent/speech-prose.spec.ts`; expected complete old/new suite passes with early speech emission and artifact-before-finish assertions. Report actual case/assertion counts; a passing single happy-path split is insufficient.
- [ ] **5. Commit named paths.** Message: `feat(voice-canvas): capture bounded complete visual suffixes`.

## Task 4: Journal complete artifacts through delivery and fence the sink

**Files:** `backend/src/chat-runtime/ports.ts`, `backend/src/voice/agent/voice-delivery.ts`, `backend/src/voice/agent/agent-voice-adapter.ts`; tests `backend/test/voice/agent/voice-delivery.spec.ts`, `backend/test/voice/agent/pipeline.spec.ts`, `backend/test/voice/agent/submission.spec.ts`.

- [ ] **1. Write RED delivery tests.** Reuse the existing local `fixture`/`deferred` helpers in `voice-delivery.spec.ts`:

```typescript
it('journals artifacts without mixing generated or heard speech and keeps them after invalidate', async () => {
  const f = fixture();
  const artifact = { responseId: f.seed.responseId, ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
  await f.delivery.start(); await f.delivery.delta('Clean explanation.');
  expect(await f.delivery.artifact(artifact)).toBe(true);
  const count = f.writes.length;
  expect(await f.delivery.artifact(artifact)).toBe(true);
  expect(f.writes).toHaveLength(count);
  f.delivery.invalidate();
  expect(await f.delivery.artifact({ ...artifact, ordinal: 1 })).toBe(false);
  await f.delivery.settle('Clean explanation.', AbortSignal.abort());
  expect(f.writes.at(-1)?.canvasArtifacts).toEqual([artifact]);
  expect(f.writes.at(-1)?.textGenerated).toBe('Clean explanation.');
  expect(f.speak.mock.calls.map(([command]) => command.text).join('')).not.toContain('flowchart');
});
```

Use fake timers for unknown-delivery settlement. Add wrong response, conflicting ordinal, aggregate cap, writer rejection, invalidation before enqueue, invalidation while an artifact CAS is blocked, preserved artifacts on every later playback/generated/terminal update, and no artifact admission after invalidation or ended settlement. **Speech `finish()` alone must still allow artifacts**: the runtime closes speech at the visual opener before any block closes. The in-flight test releases the write and asserts durability survives but adapter sink sees no event.

- [ ] **2. Add RED pipeline/replay tests.** In the existing `pipeline` fixture add a local optional artifact script argument (default absent). After `live.start` and clean `live.delta`, call the optional new artifact hook; do not use a second SpeechProse. Gate provider `speech-started` so the test proves wire artifact receipt before `audio.start`. Assert the emitted envelope passes `parseVoiceControl`, journal snapshot already contains the same projection, and no artifact source appears in TTS `speak`. Inject barge-in during a blocked journal write and assert no late event, accepted descriptor retained, mic input still forwarded, and no new providers/socket. Replay the same finalized input in `submission.spec.ts` and assert no reinference or artifact re-emission (the durable lookup/reconciliation path already exists).
- [ ] **3. Run RED.** `npm test -- test/voice/agent/voice-delivery.spec.ts test/voice/agent/pipeline.spec.ts test/voice/agent/submission.spec.ts`; expected missing artifact hook/method or absent event.
- [ ] **4. Implement the compatible port and journal method.** Add this optional port member (existing text/no-artifact/native fixtures need not be rewritten):

```typescript
artifact?(artifact: CanvasArtifactProjection): Promise<boolean>;
```

In `VoiceDelivery.artifact`, validate projection and response, await `drainAllGenerated()` outside the enqueue callback to avoid recursive-chain deadlock, then `enqueue` a callback that checks invalid/ended again. Read `this.record.canvasArtifacts ?? []`; identical ordinal+payload is a no-write success, conflict throws `INVALID_REQUEST`, otherwise validate the sorted appended list and `await this.update({ canvasArtifacts: next })`. Return true only after that update is confirmed, even if invalidation occurred during the awaited write; an already-started write remains tracked. Catch a journal failure, set `generatedFailure`, invalidate, and rethrow so no subsequent Speak/inference output is admitted. Do not clear artifacts in `invalidate`, `proof`, `settle`, `event`, or generated text updates.

Generalize the existing adapter helper to preserve the journal method's boolean result (all current void-returning callers remain compatible):

```typescript
private async deliveryAction<T>(active: Active, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) { active.failure ??= voiceError(error, 'VOICE_DELIVERY_UNKNOWN'); throw error; }
}
```

In the adapter's existing `live` object, implement `artifact` by checking active/context/response binding, calling `active.delivery.artifact` through `deliveryAction`, then immediately rechecking active/signal/closed fences before `sink.event({ type: 'canvas.artifact', turnId: active.ids.turnId, ...artifact })`. Keep a per-active-response `emittedArtifactOrdinals: Set<number>` with at most three entries; check it after the await and add immediately before sink emission so an identical replay does not send a second event. This set is released with `Active`, not retained per call or epoch. Return the admission boolean even when cancellation or duplicate delivery suppressed the event. Do not route this through audio queues or await playback. Keep persistence errors distinct from sink-after-persistence errors in control flow; stored journal remains authoritative in either case. Extend the pipeline test to invoke the same descriptor twice and assert one event and one journal append.

Extend `Active` with optional `audioStarted`/`preAudioCancelled` flags. Set `audioStarted` synchronously on a matching `speech-started` delivery hook. In `interrupt`, before its first await, invalidate exactly as today and send one existing pre-audio cancellation event when no audio started; protect cancellation with a `try/finally` so a throwing sink cannot prevent `cancelLiveTurn`/abort. Existing audio-started invalidation remains flow-owned. No `LiveFlow` or transport edits.

- [ ] **5. Run GREEN.** The three complete agent files plus the source contract suites pass; no provider calls outside fakes, no hanging timers/Promises, mic input stays off evidence-write queues.
- [ ] **6. Commit named paths.** Message: `feat(voice-canvas): journal artifacts before live delivery`.

## Task 5: Integrate the real runtime filter, budgets, and saved results

**Files:** `backend/src/chat-runtime/durable-chat-runtime.ts`, `backend/src/chat-runtime/finalization.ts`; tests `backend/test/runtime/voice-output.spec.ts`.

- [ ] **1. Add RED runtime coverage using real filter/checkpoint/delivery.** Extend `voice-output.spec.ts` locally, reusing `textConfigFixture(textSnapshot(1))`, deterministic OpenRouter `chunk`, `modelUsage`, `done`, and actual `VoiceDelivery` as its existing test does. Keep a local `pending` provider `ReadableStream` to stop at a completed visual before model EOF. Wire the new live artifact hook to `delivery.artifact`, record emission time, and read `p.metadata.getVoiceDelivery` inside that hook to assert persisted equality.

Core provider sequence and assertions:

```typescript
controller.enqueue(encoder.encode(chunk('Explain the concept. Follow A to B.\n')));
controller.enqueue(encoder.encode(chunk('```mermaid title="Approval path"\nflowchart TD\nA --> B\n```\n')));
await vi.advanceTimersByTimeAsync(100);
expect(artifacts).toHaveLength(1);
expect(flush).toHaveBeenCalledTimes(1); // Speech closed at visual start, not provider EOF.
expect(spoken.join('')).toBe('Explain the concept. Follow A to B.');
controller.enqueue(encoder.encode(chunk('Trailing model commentary must remain silent.')));
controller.enqueue(encoder.encode(chunk('', 'stop') + modelUsage + done));
controller.close();
await vi.advanceTimersByTimeAsync(250);
await running;
const assistant = (await h.p.messages.listForContext(h.identity.userId, ids.sessionId,
  { cursor: null, limit: 50 })).items.find(message => message.role === 'assistant')!;
expect(assistant.content).toBe(spoken.join(''));
expect(assistant.canvasArtifacts).toEqual(artifacts);
expect(assistant.canvasArtifacts?.[0].responseId).toBe(
  key('voice-response', h.identity.userId, ids.sessionId, ids.attemptId));
expect(h.fetcher).toHaveBeenCalledTimes(1);
```

Declare `artifacts: CanvasArtifactProjection[]`, `ids`, `running`, `spoken`, `flush`, and the controlled stream locally using the existing test's complete setup/cleanup. In `live.start`, set the seed `responseId` using the same key (the existing generic `deliveryFixture` value is not the runtime response ID). In `live.artifact`, await actual admission and only push accepted projections. In `settle`, use existing completion/sample proof or explicit unknown fixture; do not invent heard evidence from artifacts.

Add cap tests (per-source, aggregate, raw answer, reduced `maxMessageBytes`), supported/no-artifact/text output, model attribution unchanged, and a missing optional artifact hook that fails closed for an actual visual rather than dropping it. Include a tampered saved result/journal list that `checkedResult` rejects. Save successful graph `getState` and assert `result.assistant.canvasArtifacts` equals the message/journal and `result.assistant.content` contains no source. No graph schema edit should be necessary.

- [ ] **2. Run RED.** `npm test -- test/runtime/voice-output.spec.ts`; expected no captured artifact/saved projection or delayed Flush, with the existing cadence test still runnable.
- [ ] **3. Add bounded runtime collection in the current executor.** Derive deterministic response ID once from the attempt, declare `acceptedArtifacts` and `pendingArtifacts` as at-most-three arrays, and instantiate `SpeechProse(Math.min(32000, snapshot.budgets.maxInputChars), callback)`. The callback adds the projection only if the combined accepted/pending list passes the portable list guard; otherwise discard that candidate while preserving suffix silence. Before each awaited hook, validate candidate assistant BSON fit; append only after `live.artifact` returns true. If no hook exists when a real candidate is accepted, throw `NOT_READY` instead of silently losing it.

Refactor the two existing push/tail handling sites to the same local awaited routine, in this order:

```typescript
const publishFiltered = async (text: string) => {
  if (text) {
    partial += text;
    await c.live?.delta(text);
    await emit({ type: 'delta', text });
  }
  if (prose?.visualSuffixStarted && !speechClosed) {
    speechClosed = true;
    await c.live?.finish();
  }
  while (pendingArtifacts.length) {
    job.check();
    const artifact = pendingArtifacts.shift()!;
    if (!c.live?.artifact) throw new AppError('NOT_READY', 'Visual delivery is unavailable.');
    const next = [...acceptedArtifacts, artifact];
    assertArtifactMessageFits(next);
    if (await c.live.artifact(artifact)) acceptedArtifacts.push(artifact);
  }
};
```

Define local `speechClosed = false`; define `assertArtifactMessageFits` using the actual assistant envelope/sequence/voiceSessionId and existing `bounded` as specified in the budget section. The final assistant construction and the admission envelope must have identical fixed identity fields and bounds; use the same local assistant-builder function rather than copying field construction. Do not change unrelated Calendar execution. At normal EOF, `await publishFiltered(prose?.finish() ?? '')`, then finish speech only if not already closed. Do not call the prose filter at all for text execution.

Add `canvasArtifacts` only when nonempty to the final assistant; retain `partial` as speech only. Reserve the frozen live message capacity in `outputBudget`, using the frozen attempt/storage budget consistently at acceptance/execution rather than a mutable later config. Give `outputBudget` a fourth optional message-limit argument and pass `Math.min(snapshot.budgets.maxMessageBytes, p.messages.budgets.maxMessageBytes)` at all three existing call sites (new/live admission, retry admission, execution). After its existing `headroom` calculation, compute:

```typescript
const maxVisibleBytes = messageLimit - headroom -
  (internal ? CANVAS_ARTIFACT_LIMITS.messageReserveBytes : 0);
if (maxVisibleBytes < 1)
  throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The answer cannot fit in storage.');
return maxVisibleBytes;
```

Use the same effective limit in `outputBudget`'s empty-envelope `bounded` call and candidate/final assistant `bounded` calls. Do not subtract the reserve again at those calls: the model's raw budget already reserved it. Validate every delivered journal's linkage/response ID/monotonic artifact prefix in the existing `live.start` writer callback before allowing its write. Hold the last **confirmed** snapshot in that callback, update it only after a successful write, and require its artifact list to be an exact prefix of the proposed list; same-length changes/removal are invalid. Require the initial list to be absent and every descriptor response to equal the deterministic response. A failed/uncertain write fences later generation admissions; terminal settlement is still attempted and stored evidence is used during recovery.

In `checkedResult`, when input is internal/live, fetch the scoped journal; require correct user/session/turn/attempt/voiceSession/response ID and exact normalized list equality with `r.assistant.canvasArtifacts ?? []`. For legacy no-artifact results retain existing behavior, including missing journal handling in voice reconciliation. Source must never be promoted into `content` to make equality pass. Leave `publishResult`'s stages and saved-result-wins rule unchanged.

- [ ] **4. Run GREEN.** `npm test -- test/runtime/voice-output.spec.ts test/voice/agent/speech-prose.spec.ts test/voice/agent/voice-delivery.spec.ts`; verify artifact callback occurs before provider EOF/audio drain and one model request. Run `npm run build` to catch port/schema composition regressions.
- [ ] **5. Commit named paths.** Message: `feat(voice-canvas): seal clean speech with durable visual projections`.

## Task 6: Retain journaled artifacts through cancellation and recovery

**Files:** `backend/src/chat-runtime/durable-chat-runtime.ts`, `backend/src/chat-runtime/reconciliation.ts`; `backend/src/chat-runtime/history.ts` only if tests expose a gap. Tests: `backend/test/runtime/voice-output.spec.ts`, `backend/test/runtime/voice-history.spec.ts`.

- [ ] **1. Write RED fault/recovery tests in owned runtime files.** Use `textConfigFixture` with its real `MemorySaver` and a real `VoiceDelivery`, not a stub returning a fabricated completed message. Keep fixture wrappers local. Reuse its `restart()` and repository methods, and gate writes with local deferred Promises.

For the sealed case wrap `p.messages.append`: throw once for assistant before write, or write then throw. For incomplete generation use controlled provider chunks and `runtime.cancelLiveTurn`/aborted signal after the confirmed artifact but before model end. For process-stop simulation leave a generating attempt and its journal in the in-memory repository, with no assistant, then restart/reconcile; do not call the generation hook during recovery. Include a complete visual followed by an incomplete second visual. Assert this recovery invariant after two reconciliations:

```typescript
await h.restart();
await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
const recovered = (await h.p.messages.listForContext(h.identity.userId, ids.sessionId,
  { cursor: null, limit: 50 })).items.filter(message => message.role === 'assistant');
expect(recovered).toHaveLength(1);
expect(recovered[0].canvasArtifacts).toEqual([completeArtifact]);
expect(recovered[0].content).not.toContain('flowchart');
expect(h.fetcher).toHaveBeenCalledTimes(1);
const delivery = await h.p.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId);
expect(delivery?.textGenerated).toBe(recovered[0].content);
expect(delivery?.canvasArtifacts).toEqual([completeArtifact]);
```

Declare `completeArtifact` from the admitted projection, not a newly numbered/source-reparsed descriptor. Expected delivery `status` is `unknown` when its pending evidence was lost; known interrupted evidence stays interrupted. Add empty-speech artifact-only recovery, sink-after-journal failure, journal timeout-after-commit, append-after-commit, manifest failure, checkpoint-boundary update failure, terminal-CAS failure, existing assistant mismatch, journal response mismatch, and missing/pending delivery. A failure must not clear the active slot or mark completion before required writes are durable. Existing empty-speech/no-artifact cancellation remains unchanged.

In `voice-history.spec.ts`, repeat its cancelled-live fixture with `content: ''` and a valid descriptor; assert the original message reference survives for each terminal live outcome, while a visible call summary with null attempt still does not enter history.

- [ ] **2. Run RED.** `npm test -- test/runtime/voice-output.spec.ts test/runtime/voice-history.spec.ts`; expected interrupted/crash records lack artifacts or artifact-only assistants disappear before the fix.
- [ ] **3. Extend incomplete-turn publication from the stored journal.** Add an optional `canvasArtifacts` parameter to `interruptOwned`/`interruptAttempt` for the in-memory confirmed prefix, passing it only from live execution. Existing cancellation/recovery callers remain compatible. Inside `interruptAttempt`, after loading accepted input and before append, load scoped voice delivery for internal/live input. Validate exact user/session/turn/attempt/voiceSession/response linkage, schema, sorted caps, and in-memory-list prefix agreement with the persisted journal. Persisted journal is authoritative and may contain one confirmed write whose caller was interrupted before observing success.

Use this decision shape, with the existing assistant envelope/allocation:

```typescript
const artifacts = delivery?.canvasArtifacts;
const generated = partial || delivery?.textGenerated || '';
if (delivery && !generated.startsWith(delivery.textGenerated))
  throw new AppError('NOT_READY', 'Voice result and delivery disagree.');
if ((generated || artifacts?.length) && !existing) {
  await job.wait(p.owner.run(lease, () => p.messages.append({
    ...assistantEnvelope, content: generated,
    ...(artifacts?.length ? { canvasArtifacts: artifacts } : {}),
  })), budgets.persistenceTimeoutMs);
}
```

Define `assistantEnvelope` by moving the current `interruptAttempt` append fields into a local construction with its allocated sequence, status, internal/live and original voice session classification; its final spread must produce a valid `MessageRecord`. `delivery` is loaded only for internal/live input. For non-live input keep `partial` and the existing conditional unchanged. A live crash may recover clean `delivery.textGenerated` even without artifacts; zero speech/no artifacts still creates no assistant. For an existing assistant verify its original identity/content/artifact equality instead of overwriting it; do not compare a newly allocated recovery sequence against an already-durable message's original sequence.

Rebuild references using the actual stored assistant, including artifact-only/failed/cancelled messages; preserve current `eligible` semantics and avoid a duplicate if `acceptedHistory` already included it. In `reconcileVoiceDeliveries`, validate the journal equals the assistant's descriptors before reconciling speech; keep the existing spread of the old record so artifacts cannot disappear. Continue to mark pending speech unknown rather than complete. Keep all recovery operations under the existing owner lease/work timeouts and existing no-inference graph factory.

- [ ] **4. Run GREEN.** Run both full runtime files, `npm test -- test/runtime/graph.spec.ts test/runtime/local-reconciliation.spec.ts`, and contract tests. Native suites are not a substitute for these nonempty deterministic crash tests and are not claimed as executed here.
- [ ] **5. Commit named paths.** Message: `fix(voice-canvas): preserve complete visuals across interrupted recovery`.

## Task 7: Expose unchanged original messages plus archive artifacts

**Files:** `backend/src/persistence/messages.ts`; test `backend/test/persistence/voice-messages.spec.ts`. Portable/schema changes from Tasks 1–2 are prerequisites.

- [ ] **1. Write RED archive tests.** Extend the existing attributed-live-message test with `canvasArtifacts`, and assert top-level projection retains its exact descriptor while keeping `content: ''`, one clean transcript item, original message/event/turn/sequence, and no attempt/user/provider fields. Add an artifact-only interrupted assistant and legacy no-artifact case. Reuse the local mocked `RecordStore` cursor or read-only `calendarMemory` fixture for actual BSON round trips; do not add a fixture framework.

```typescript
expect(found.items[0]).toMatchObject({
  messageId: raw.messageId, turnId: raw.turnId, sequence: raw.sequence,
  content: '', canvasArtifacts: raw.canvasArtifacts,
  voiceTranscripts: [{ role: 'assistant', content: raw.content, createdAt: raw.createdAt }],
});
expect(found.items[0]).not.toHaveProperty('attemptId');
expect(found.items[0].voiceTranscripts?.[0].content).not.toContain('flowchart');
```

Add three paged visual-bearing originals, repeated list reads, no session-wide aggregate, cancellation status visibility, and user record rejection. Assert paging count is messages, not one row per artifact, and `listForContext/get/getReferences` preserve the original clean content and sources.

- [ ] **2. Run RED.** `npm test -- test/persistence/voice-messages.spec.ts`; expected missing public artifact field with current projection.
- [ ] **3. Add only the optional projection.** In `MongoMessages.list`'s existing `visibleMessageSchema.parse` object add:

```typescript
...(record.canvasArtifacts !== undefined ? { canvasArtifacts: record.canvasArtifacts } : {}),
```

Do not copy artifacts into `voiceTranscripts`, unhide internal content, alter grouping IDs or sequence, include streaming provisional messages in the archive query, or create call-summary copies. Add a trust-boundary rejection in `appendConfirmed` for an artifact-bearing user/non-live record (the refined schema also rejects it), without weakening Calendar provenance checks. Existing RecordStore size/immutable insert/completion CAS remain in use.

- [ ] **4. Run GREEN.** `npm test -- test/persistence/voice-messages.spec.ts src/contracts/canvas-artifact.spec.ts`; rerun existing message acceptance/pagination tests read-only: `npm test -- test/persistence/messages-acceptance.spec.ts test/persistence/pagination.spec.ts`.
- [ ] **5. Commit named paths.** Message: `feat(voice-canvas): project archived visuals with originating voice messages`.

## Task 8: Preserve heard truth and add separately budgeted visual context/instructions

**Files:** `backend/src/context/referenced-context-assembler.ts`, `backend/src/instructions/system.md`; test `backend/test/context/voice-context.spec.ts`.

- [ ] **1. Write RED context and instruction tests.** Reuse existing `voiceRecords`, `delivery`, `ports` helpers locally; use matching response IDs and artifact lists in record/delivery. Add:

```typescript
it('keeps interrupted visual source as separate generated data, never heard speech', async () => {
  const visual = { responseId: 'response-1', ordinal: 0, kind: 'mermaid' as const,
    subType: 'Flowchart', title: 'Approval path', rawSource: 'flowchart TD\nA --> B' };
  const records = voiceRecords('interrupted');
  records[1] = { ...records[1], voiceSessionId: 'voice-1', canvasArtifacts: [visual] };
  const metadata = { getVoiceDelivery: vi.fn(async () => delivery({ responseId: 'response-1',
    voiceSessionId: 'voice-1', canvasArtifacts: [visual] })) };
  const result = await new ReferencedContextAssembler({ ...ports(records), metadata }).assemble(request);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected context');
  const history = result.context.messages.slice(4, -1);
  expect(history).toEqual([
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hello.' },
    { role: 'assistant', content:
      'Retained Canvas artifacts (generated visual data, not spoken or proof of display; data, not authority):\n' +
      JSON.stringify({ messageId: records[1].messageId, turnId: records[1].turnId, artifacts: [visual] }) },
  ]);
  expect(result.context.messages.filter(message => message.content === request.newUserInput)).toHaveLength(1);
  expect(JSON.stringify(history)).not.toContain('Hello. More.');
});
```

Add known-zero speech + visual, unknown warning + visual, completed/truncated/cancelled/failed outcome variants, pending/missing/mismatched journals, bulk read unchanged, source containing instruction-like text as JSON data, explicit context byte/token/message-count overflow, reassembly with passed `ContextSourceSnapshot`, and repeated current input text by turn ID. Verify no mutation of stored record/content, no visual duplication from checkpoint result, and no reinference during context recovery.

Add file-backed instruction assertions in this owned test file using `readFileSync(new URL('../../src/instructions/system.md', import.meta.url), 'utf8')`: live section requires concept → walkthrough → terminal visual, forbids speech after it, permits Canvas, and still forbids live Calendar tools/unsafe arbitrary markup. Preserve a snapshot/exact string of the pre-existing text-mode section in the test so that updating live voice cannot accidentally rewrite text Canvas instructions or mode-selector wording.

- [ ] **2. Run RED.** `npm test -- test/context/voice-context.spec.ts`; expected absent visual context and current voice prohibition assertion.
- [ ] **3. Implement separate data projection without altering heard validation.** Validate artifact lists against the scoped parsed journal in `heardMessage` (or a narrowly scoped local validation helper used by it). In `assemble`'s existing history loop, append the heard message, then the exact generated-data assistant message from the normative section if the record has artifacts. Budget every projected message plus normal fixed/mode/user messages. A per-message byte overflow returns the existing `CONTEXT_BUDGET_EXCEEDED` result shape with its normal user-facing message, `maxContextTokens`, and computed `requiredTokens`; never silently omit the supplement to make admission pass.

Replace only `<voice_guidelines>` content with these behavioral instructions, retaining selector and shared security/Calendar/text sections:

```text
When the current selector is `Response mode: voice.`, compose natural, clear spoken sentences suitable for Text-to-Speech. Be concise without omitting information needed to answer accurately. Preserve names, numbers, units, qualifications, and negations.

When a Canvas visual helps, emit in this order: spoken concept explanation → spoken visual walkthrough → terminal silent Canvas block(s). The walkthrough explains the actual labels, branches, axes, or values that the visual contains. Use the existing mermaid, chart, graph, or svg fenced syntax, or an aurvin-canvas wrapper. Graphs use the chart renderer; do not invent data. Finish all speech before the first visual block. Never emit spoken prose after a visual block, including after its closing delimiter. Multiple visual blocks form one terminal silent suffix.

Keep each source within 8192 characters and 16384 UTF-8 bytes, titles within 120 characters, and emit at most three visual blocks. Total sources must remain within 16384 characters and 24576 UTF-8 bytes. Complete every visual delimiter. Visual syntax is silent, not speech.

Nonvisual answers need no filler or Canvas reference. Do not emit unsupported code listings, tables, raw JSON outside recognized visuals, hidden reasoning, arbitrary HTML/JavaScript, or LaTeX for speech. Canvas references describe the visual naturally but must not claim that it is already displayed or that delivery is synchronized. Do not claim to switch the interface. Live voice has no Calendar tools.
```

This is choreography, not timing certification. Never pad answers, increase output queues, delay/duplicate playback, or add a second model request to make a timing assertion look successful. Existing instruction content hashing will change; existing normal version-rebase procedures apply. Do not migrate/checkpoint-edit existing user databases during this task.

- [ ] **4. Run GREEN.** `npm test -- test/context/voice-context.spec.ts test/context/voice-startup.spec.ts test/context/fixed-assets.spec.ts test/context/referenced-context-assembler.spec.ts test/context/reference-selection.spec.ts`; then existing Calendar context tests and text mode tests. Check the actual fixed instruction file still fits its current asset ceiling and default context budget.
- [ ] **5. Commit named paths.** Message: `feat(voice-canvas): retain visual follow-up context without claiming heard speech`.

## Task 9: Required W1 exit verification and downstream handoff

**Files:** no new implementation/evidence artifacts. Fix regressions only in owned paths, in their owning tasks; report results/commits to the orchestrator. P3 owns integrated/final evidence.

- [ ] **1. Inspect diff/ownership and run focused nonempty suites.** `git diff --check`; `git status --short`; verify only the exact implementation/test ownership paths changed and no secrets/generated/dependencies were staged. Re-run backend source contract, all four voice agent, both runtime voice, voice message, and voice context files; run frontend both protocol files.
- [ ] **2. Run backend gates from `backend`.** Execute `npm run build`, `npm run lint`, `npm test` separately. Run `npm run test:e2e` only within the authorized local/offline environment; do not contact an operator database merely because credentials happen to exist. Record discovered tests, failures and skips. Native suites require separately authorized isolated generated database tests with `AURVIN_TEST_MONGODB_URI` and `AURVIN_TEST_DB_PREFIX=aurvin_p2_test_`; missing or unauthorized prerequisites are explicit skips, never certification. Do not print credentials or URIs.
- [ ] **3. Run frontend gates from `frontend`.** Execute `npm test -- src/api/voice-protocol.test.ts src/api/protocol.test.ts`, `npm run build`, `npm run lint`, and `npm test`. P1 does not claim Node tests prove animation, focus, five-second render timing, audible order or under-250 ms local audio interruption.
- [ ] **4. Check the full exit matrix.** Prove all cut points silent, no post-visual speech, complete blocks only, exact caps/guard parity, dictation/client rejection, pre-audio delivery, invalidation fencing, write-before-event, interrupted/artifact-only/crash/sealed publication recovery, one linked original assistant, no duplicate ordinal, legacy compatibility, clean generated/heard-prefix equality, separately labeled visual context, unchanged text/dictation/Calendar behavior, and unchanged global queue limits. A test failure blocks W1 completion; skipped review does not waive correction.
- [ ] **5. Send the exact W1 handoff.** Report implementation commit hashes, actual modified paths, Node/package environment, commands/counts/skips, and any frozen-contract deviation. Restate wire shape/caps, `canvasArtifacts` message/journal/public mapping, key formula, pre-audio/cancelled behavior, archive explanation location, provisional persistence semantics and subtype conversion notes. P2 may plan after L1 but cannot execute until W1 passes and commits. P3 plans after W1 plus L2 and measures remaining timing/native/browser gates; unauthorized live checks leave full acceptance blocked.

## Planning self-check and coverage record

- **G1 / REQ-1:** Task 8 changes only voice instructions and tests text/selector/security preservation. Tasks 3/5 enforce suffix order even for a violating model.
- **G2 / REQ-2–3:** Tasks 1–5 freeze matching guards, numeric bounds, complete-block/cut-point semantics, stable ownership and prompt active sink delivery. Tasks 4/6 fence invalidation and retain accepted artifacts. No additional token consumer, queue or renderer.
- **G3 / REQ-7–8:** Tasks 2/5–8 preserve speech fields, persist message/checkpoint/journal, recover without paid replay, expose artifacts/clean explanation through original visible messages, and supply honest visual follow-up context. P2 owns inline card/grouping integration; the public handoff explicitly prevents hiding cards in the call modal.
- **G4:** All panel/media/control work remains P2-owned. P1 supplies only portable data/identity/cancellation semantics.
- **G5 / AC-1–3, AC-6:** Tasks 3–5 prove callback/Flush ordering and bounded slow-write behavior, not audible synchronization. P3 retains normal/adverse rate, underrun, five-second, rendered-versus-audible and local-interruption measurements. No timing waiver or production claim.
- **AC-8:** Task 3 transports Mermaid flow/sequence, categorical bar/line/pie and X-Y scatter sources plus existing SVG. P2/P3 prove actual parser/render parity and existing SVG safety.
- Schema versions remain 1; no graph/state/collection migration or new external package; all added source arrays/strings have explicit caps; immutable message publication and speech reconciliation are respected.
- Self-check performed while planning: ownership mapped before tasks; every owned subsystem has concrete RED/GREEN commands, fixture/assertion examples and commit boundary; frozen names/types/identity are consistent across tasks; no separate researcher/reviewer dispatched. All verification commands above are future W1/P3 obligations, not results of this documentation-only task.
