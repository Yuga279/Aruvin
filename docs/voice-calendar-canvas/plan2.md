# P2: Voice-first Canvas and Text Entry Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present existing Calendar work automatically during live voice, manually from text, with accessible structured agendas, proposal controls, truthful outcomes, and reload-safe snapshots without adding waiting to speech or text delivery.

**Architecture:** Extend the existing frontend wire mirrors, live reducer/controller, chat completion reducer, and Canvas artifact collection; do not introduce another execution or authorization path. Calendar views remain typed data beside legacy artifact source, and Calendar content uses an ordinary scrolling panel inside the existing Canvas shell. A small presentation projection correlates progress, proposal, and outcome frames; only the current live controller can send revision-bound confirmation, while archived views are read-only.

**Tech Stack:** Existing React 19.2, TypeScript 6, React DOM server rendering, Vitest 4 Node tests, CSS/Intl/native disclosure elements, existing LiveKit and WebSocket wire contracts; no added dependencies.

---

## Execution boundary and evidence

- This is **P2 only**. Prerequisite P1 implementation is `f9ca285..d8ee6a4`; the inspected checkout is `495e891`. Read [goal.md](goal.md), [research.md](research.md), [state.md](state.md), and [../../AGENTS.md](../../AGENTS.md). The dated approval/current dependency matrix supersede preparation-era awaiting-approval paragraphs. Unified review is **skipped**, not passed.
- Own frontend source/unit tests below. Do not change backend schemas, proposal authority, persistence, speech instructions, or P3's `frontend/src/features/voice/integration-tests/calendar-canvas.test.ts` and backend integration/performance cases. Return upstream contract defects to P1 and integration evidence to P3.
- Preserve concurrent work. At planning time `frontend/src/features/auth/auth-context.tsx`, `frontend/src/features/auth/auth-context.test.ts`, and `frontend/vite.config.ts` have unrelated modifications. Do not stage, overwrite, or attribute these to P2. Check again before implementation and each commit; serialize staging/commits with the orchestrator.
- All commands headed `Run (frontend/)` execute with `frontend/` as working directory. Git commands execute at repository root. Baseline: record `node --version`, `npm --version`, `git rev-parse HEAD`, and `git status --short`; run existing frontend checks before changing source, retaining actual failures separately. Use existing installed dependencies, or `npm ci` in `frontend/` if absent. Do not change lockfiles or dependencies.
- **Headers:** every new `.ts`, `.tsx`, and CSS file must receive the repository's full `FILE / LOCATION / PURPOSE / ROLE IN PROJECT / KEY COMPONENTS` comment before its first write. Existing files already have headers; update their description if responsibilities change and add a full header if modifying more than 30% of a headerless file. The snippets below are replacement/insert bodies, not permission to omit a file header. Use the exact pathname in that file's header, valid comment syntax, and preserve required directives. Tests are code files too.
- **Ponytail discipline:** reuse helpers first; no dependency, polling, generic validation framework, event bus, state-machine library, new provider call, or new server endpoint. Do not refactor large existing parsing/voice files incidentally. A deliberate ceiling receives a `ponytail:` comment naming the ceiling and upgrade path.
- **Latency invariant:** no display-only request, no awaited rendering/animation/acknowledgement, no JSON-to-visual parsing in audio callbacks, no `flushSync`, and no new render-completion callback in transports. Calendar SSE frames and `completed.calendarView` only update bounded state; existing delta coalescing/terminal flush remains unchanged. Voice frame presentation errors must not reach `fail(...VOICE_DELIVERY_UNKNOWN)`, stop input, invalidate playback, or manufacture a write result. React external-store updates are synchronous: wrapping `useSyncExternalStore` updates in `startTransition` does **not** prove non-blocking behavior.
- Keep React tests in `*.test.ts`, using `createElement` + `renderToStaticMarkup`, existing controller fakes, pure reducers, and captured element callbacks. SSR does not execute effects, prove keyboard focus, catch render exceptions through an error boundary, or measure browser responsiveness; do not claim those results from markup tests.

## P1's implemented contract, not the earlier research sketch

Authoritative references: `backend/src/contracts/calendar-view.ts`, `calendar-wire.ts`, `calendar-tools.ts`, `stream.ts`, `voice-wire.ts`, and `backend/src/persistence/messages.ts`. Read these sources, not backend implementation plans.

- `CalendarView` is a strict version-1 union, at most **14,336 UTF-8 bytes**. Protocol-3 SSE/voice calendar frame envelopes are capped at **16,384 bytes**. Do not force views through the legacy 8,192-character artifact source limit.
- `agenda`: `target`, nullable `requested`, up to 20 `entries`, `nextPageToken`, `truncated`, `detailsTrimmed`, `entriesOmitted`, `expiresAt`. Requested is `{timeMin,timeMax,displayTimeZone}`. Entry `timeZone` is nullable; all-day `start/end` are date-only with an **exclusive** end. No attendee field exists. `requested:null` is valid for get-event.
- `proposal`: `proposalId`, **`intentId`**, **`revision`**, `expiresAt`, reason, nullable target/action, candidates. Action is the existing timed `CalendarCreateInput`: summary/start/end/timeZone, optional description/location/calendarId. Unsupported attendees/recurrence/update/delete remain unsupported.
- `outcome`: operationId, nullable proposalId, intentId, state, retryAction, nullable **durable** receipt. Receipt exists iff state is `succeeded`; link/label require bounded expiry.
- `notice`: state `failed|unavailable|clarification|cancelled|expired|read-completed`, message, nullable proposalId/intentId/tool/coverage/conflict, limitations. A successful availability/calendar-list read is a notice, **not an empty agenda**.
- `calendar-clarification` optionally carries **`view`**, plus optional **`proposalRevision`**. Do not rename wire `proposalRevision` to view `revision`.
- V2 operations have optional `proposalId`/`intentId`. Legacy v1/v2 stream compatibility remains; `calendar-view` itself is protocol 3 only.
- Server voice: `{type:'calendar.frame',turnId,attemptId,**responseId**,event}` inside the existing session/epoch/eventId/sequence envelope. `responseId` is mandatory in committed P1, also for chunk correlation.
- Client voice: `{type:'calendar.confirm',proposalId,proposalRevision,answer:{kind:'accept'}|{kind:'reject'}|{kind:'select',calendarId}}`. No client action body, user ID, session override, calendarReplyTo, or direct provider execution. The backend translates this control to the existing CAS-authorized turn path.
- Text `completed` optionally includes `calendarView`; **consume this** even when no standalone view event arrives. P1 intentionally attaches publication views to completion to avoid an extra awaited SSE display write.
- Assistant messages optionally carry `calendarView` in either mode. Internal voice text is projected into `voiceTranscripts`; `calendarView` remains on the containing message. Frontend voice grouping must carry it forward locally with the original message ID and turn ID.

## File map and designs

Modify these existing files, in the tasks named below:

- `frontend/src/api/calendar-protocol.ts`: browser view types/guard and existing stream/clarification/operation extensions (Task 1).
- `frontend/src/api/voice-protocol.ts`, `frontend/src/api/protocol.ts`: voice mirror, completed/message/transcript types (Task 1).
- `frontend/src/features/chat/state/chat-types.ts`, `chat-reducer.ts`, `use-chat.ts`: scoped text view state and completion attachment (Task 2).
- `frontend/src/features/voice/state/live-voice-reducer.ts`, `live-voice-controller.ts`, `useLiveVoice.ts`, `state/testing/live-voice-fixture.ts`, `frontend/src/App.tsx`: live projection, confirmation, navigation binding (Tasks 3–4).
- `frontend/src/features/canvas/canvas-types.ts`, `canvas-artifacts.ts`, `CanvasPanel.tsx`, `index.ts`: typed artifact payload, hydration/cache/dedupe, untransformed calendar mode, exports (Tasks 5, 7).
- `frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx`: manual text result buttons and structured confirmation facts, keeping existing hidden text replies (Task 8).
- `frontend/src/components/group-voice-messages.ts`, `VoiceTranscriptModal.tsx`: carry archived calendar snapshots into the voice transcript and reuse manual artifact cards (Task 8). No need to restructure `MessageItem` or `Transcript`.
- `frontend/src/features/chat/ChatView.tsx`: remove text auto-open, add voice-only sticky opening and route live controls (Task 9).
- `frontend/src/styles/chat.css`: ordinary responsive calendar Canvas layout and focus styles (Task 7).

Create only these focused production/test helpers:

- `frontend/src/features/canvas/calendar-workspace.ts`: bounded **presentation folding**, correlation keys, and live-workspace artifact merging; no execution/authorization logic (Tasks 3, 5).
- `frontend/src/features/canvas/renderers/calendar-view-renderer.tsx`: small structured view switch, proposal/outcome/notice views, one expiry deadline, local render-error containment (Task 6).
- `frontend/src/features/canvas/renderers/calendar-agenda-view.tsx`: date-only/Intl formatting and day-grouped accessible agenda (Task 6).
- `frontend/src/features/canvas/testing/calendar-view-fixtures.ts`: deterministic wire/view/message factories used across P2 unit tests (Task 1).
- `frontend/src/features/canvas/calendar-workspace.test.ts`, `renderers/calendar-view-renderer.test.ts`, `renderers/calendar-agenda-view.test.ts`: focused tests (Tasks 3, 6).

Extend existing unit tests: `frontend/src/api/calendar-protocol.test.ts`, `voice-protocol.test.ts`, `protocol.test.ts`; `features/chat/state/calendar-chat-state.test.ts`, `chat-stream-coalescing.test.ts`; `features/voice/state/live-voice-controller.test.ts`, `live-voice-reducer.test.ts`; `features/canvas/calendar-canvas.test.ts`; `features/plugins/google-calendar/calendar-turn-region.test.ts`; `components/group-voice-messages.test.ts`, `VoiceTranscriptModal.test.ts`; `features/chat/ChatView.voice.test.ts`.

**Visual direction:** Aurvin's quiet existing surface/text/border palette and fonts, not a new branded calendar app. Signature: a narrow day/date rail beside a readable agenda, with all-day items sorted first and full multi-day intervals shown once. An exact-action review card uses existing Calendar button styles; uncertainty gets explanatory copy, not a success check. No mock busy blocks, fabricated calendar names, fake progress percentages, new animation, or new fonts. Preserve the existing responsive split pane/mobile overlay and close-focus behavior.

**Identity and dismissal:** one workspace's ID is anchored to its first actual-work turn (`calendar:<turnId>`), never renamed when proposal/intent/operation IDs arrive. Later confirmation turns join through authoritative references. While one current proposal awaits a reply, reference-free progress on a subsequent turn provisionally updates that workspace; a different structured intent splits that turn into a new workspace. This is presentation correlation only, not permission. Alias IDs let hydration replace a provisional artifact without opening another tab, losing selection, or reopening a dismissed operation.

## Task 1: Mirror the committed view and voice contracts

**Files:** modify the three API mirrors and three API tests listed above; create `frontend/src/features/canvas/testing/calendar-view-fixtures.ts`.

- [ ] **Step 1: Add deterministic fixtures, then failing protocol tests.** Give the fixture its mandatory header. Its complete export bodies are:

```ts
import type { CalendarView } from '../../../api/calendar-protocol.ts';
import type { VisibleMessage } from '../../../api/protocol.ts';
export const NOW = Date.parse('2026-11-11T12:00:00Z');
export const EXPIRY = '2026-11-11T12:05:00Z';
export const agenda = (): Extract<CalendarView, {kind:'agenda'}> => ({
  viewVersion: 1, kind: 'agenda',
  target: { calendarId: 'team@example.com', calendarLabel: 'Team', labelExpiresAt: EXPIRY },
  requested: {timeMin:'2026-11-11T00:00:00Z',timeMax:'2026-11-14T00:00:00Z',displayTimeZone:'Europe/London'},
  entries: [{eventId:'event-1',summary:'Design sync',start:'2026-11-11T14:00:00Z',
    end:'2026-11-11T15:00:00Z',allDay:false,timeZone:'Europe/London',status:'confirmed',
    description:'Discuss <script> safely',location:'Room 4',htmlLink:'https://calendar.google.com/calendar/event?eid=one'}],
  nextPageToken:null,truncated:false,detailsTrimmed:false,entriesOmitted:0,expiresAt:EXPIRY,
});
export const proposal = (): Extract<CalendarView, {kind:'proposal'}> => ({
  viewVersion:1,kind:'proposal',proposalId:'proposal-1',intentId:'intent-1',revision:2,
  expiresAt:EXPIRY,reason:'details',target:agenda().target,
  action:{summary:'Design sync',start:'2026-11-11T14:00:00Z',end:'2026-11-11T15:00:00Z',timeZone:'Europe/London'},
  candidates:[],
});
export const outcome = (): Extract<CalendarView, {kind:'outcome'}> => ({
  viewVersion:1,kind:'outcome',operationId:'operation-1',proposalId:'proposal-1',intentId:'intent-1',
  state:'succeeded',retryAction:'none',receipt:{durable:true,eventId:'event-1',
    htmlLink:'https://calendar.google.com/calendar/event?eid=one',calendarLabel:'Team',expiresAt:EXPIRY},
});
export const notice = (): Extract<CalendarView, {kind:'notice'}> => ({
  viewVersion:1,kind:'notice',state:'unavailable',message:'Calendar unavailable. Try again later.',
  proposalId:null,intentId:null,tool:'calendar_list_events',coverage:'incomplete',conflict:null,limitations:['provider-error'],
});
export function calendarMessage(view: CalendarView = agenda(), mode: 'text'|'live' = 'text'): VisibleMessage {
  return {messageId:'assistant-1',turnId:'turn-1',eventId:'event-message-1',sequence:2,role:'assistant',
    content:mode === 'live' ? '' : 'Here is your calendar.',createdAt:'2026-11-11T12:00:00Z',
    completionStatus:'completed',truncated:false,mode,calendarView:view,
    ...(mode === 'live' ? {voiceSessionId:'voice-1',voiceTranscripts:[{role:'assistant' as const,content:'One event.'}]} : {})};
}
```

Append to `frontend/src/api/calendar-protocol.test.ts` (add these imports):

```ts
import { isCalendarView, parseCalendarCompatibleFrame } from './calendar-protocol.ts';
import { agenda, proposal, outcome, notice } from '../features/canvas/testing/calendar-view-fixtures.ts';
it('accepts bounded P1 views and protocol-3 view frames, not malformed or oversized facts', () => {
  for (const view of [agenda(), proposal(), outcome(), notice()]) {
    expect(isCalendarView(view)).toBe(true);
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify({protocolVersion:3,sessionId:'s',turnId:'t',
      attemptId:'a',sequence:0,event:{type:'calendar-view',view}})}`).event.type).toBe('calendar-view');
  }
  expect(isCalendarView({...agenda(),entries:Array(21).fill(agenda().entries[0])})).toBe(false);
  expect(isCalendarView({...agenda(),truncated:false,nextPageToken:'more'})).toBe(false);
  expect(isCalendarView({...agenda(),extra:true})).toBe(false);
  expect(isCalendarView({...outcome(),state:'unknown'})).toBe(false);
  expect(isCalendarView({...agenda(),entries:[{...agenda().entries[0],allDay:true,
    start:'2026-11-12',end:'2026-11-11'}]})).toBe(false);
  expect(isCalendarView({...agenda(),entries:Array.from({length:20},(_,i)=>({...agenda().entries[0],
    eventId:`event-${i}`,description:'🙂'.repeat(500)}))})).toBe(false);
});
```

Append to `frontend/src/api/voice-protocol.test.ts`:

```ts
import { agenda } from '../features/canvas/testing/calendar-view-fixtures.ts';
it('mirrors calendar frames with response IDs and live-only revision-bound controls', () => {
  const envelope = {protocolVersion:1,sessionId:'v',connectionEpoch:1,eventId:'e',sequence:0};
  const frame = {...envelope,type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',
    event:{type:'calendar-view',view:agenda()}};
  expect(isVoiceServerEvent(frame,'live')).toBe(true);
  expect(isVoiceServerEvent(frame,'dictation')).toBe(false);
  const {responseId: removed, ...missingResponse} = frame;
  expect(removed).toBe('r');
  expect(isVoiceServerEvent(missingResponse,'live')).toBe(false);
  for (const answer of [{kind:'accept'},{kind:'reject'},{kind:'select',calendarId:'team@example.com'}]) {
    const control = {...envelope,type:'calendar.confirm',proposalId:'p',proposalRevision:2,answer};
    expect(parseVoiceControl(JSON.stringify(control),'client','live')).toEqual(control);
    expect(() => parseVoiceControl(JSON.stringify(control),'client','dictation')).toThrow('INVALID_VOICE_CONTROL');
  }
  expect(isVoiceClientEvent({...envelope,type:'calendar.confirm',proposalId:'p',proposalRevision:0,
    answer:{kind:'accept'}})).toBe(false);
});
```

Append to `frontend/src/api/protocol.test.ts`:

```ts
import { agenda } from '../features/canvas/testing/calendar-view-fixtures.ts';
it('accepts a completed Calendar snapshot without changing completion/save semantics', () => {
  expect(isStreamEvent({type:'completed',assistantMessageId:'m',outcome:'completed',calendarView:agenda()})).toBe(true);
  expect(isStreamEvent({type:'completed',assistantMessageId:'m',outcome:'completed',calendarView:{kind:'agenda'}})).toBe(false);
});
```

- [ ] **Step 2: Run (frontend/):** `npm test -- src/api/calendar-protocol.test.ts src/api/voice-protocol.test.ts src/api/protocol.test.ts`. Expected RED: missing `isCalendarView` export, new frame/control rejected, completion rejected; do not treat a fixture-import typo as the behavior failure.
- [ ] **Step 3: Add exact browser types in `calendar-protocol.ts`.** Use the following bodies; keep existing types and guards intact:

```ts
export type CalendarViewTarget = {calendarId:string;calendarLabel:string|null;labelExpiresAt:string|null};
export type CalendarCreateInput = {summary:string;start:string;end:string;timeZone:string;
  description?:string;location?:string;calendarId?:string};
export type CalendarViewEntry = {eventId:string;summary:string;start:string;end:string;allDay:boolean;
  timeZone:string|null;status:'confirmed'|'tentative'|'cancelled';location?:string;description?:string;htmlLink:string|null};
export type CalendarView =
  | {viewVersion:1;kind:'agenda';target:CalendarViewTarget;
      requested:{timeMin:string;timeMax:string;displayTimeZone:string}|null;
      entries:CalendarViewEntry[];nextPageToken:string|null;truncated:boolean;detailsTrimmed:boolean;entriesOmitted:number;expiresAt:string}
  | {viewVersion:1;kind:'proposal';proposalId:string;intentId:string;revision:number;expiresAt:string;
      reason:CalendarClarificationReason;target:CalendarViewTarget|null;action:CalendarCreateInput|null;candidates:CalendarClarificationCandidate[]}
  | {viewVersion:1;kind:'outcome';operationId:string;proposalId:string|null;intentId:string;
      state:CalendarOperationState;retryAction:CalendarRetryAction;receipt:CalendarDurableReceiptV2|null}
  | {viewVersion:1;kind:'notice';state:'failed'|'unavailable'|'clarification'|'cancelled'|'expired'|'read-completed';
      message:string;proposalId:string|null;intentId:string|null;
      tool:'calendar_list_events'|'calendar_get_event'|'calendar_list_calendars'|'calendar_check_availability'|null;
      coverage:'complete'|'incomplete'|null;conflict:'clear'|'conflict'|'unknown'|null;limitations:string[]};
export type CalendarPresentationEvent = CalendarProgressEvent | CalendarOperationWireEventV2 |
  CalendarClarificationEvent | {type:'calendar-view';view:CalendarView};
```

Add `proposalId?:string|null; intentId?:string` to `CalendarTurnStateV2`; add `view?:Extract<CalendarView,{kind:'proposal'}>` to `CalendarClarificationEvent`. Expand **only their existing optional-key lists** and test those optional values. Add `{type:'calendar-view';view:CalendarView}` to the protocol-3 union and call `isCalendarPresentationEvent` for the view case. Do not admit standalone view frames into protocol 2.

Implement the new trust-boundary guard in this same file with existing exact-key, bounded-ID, byte, receipt, role, and safe-link helpers (not new copies):

```ts
const boundedText = (v: unknown, max: number, min = 0): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const validZone = (v: unknown): v is string => {
  if (!boundedText(v,100,1)) return false;
  try { new Intl.DateTimeFormat('en',{timeZone:v}); return true; } catch { return false; }
};
const dateOnly = (v: unknown): v is string => boundedText(v,10,10) && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v;
const instant = (v: unknown): v is string => boundedText(v,96,1) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
function viewTarget(v: unknown): v is CalendarViewTarget {
  return isRecord(v) && hasExactKeys(v,['calendarId','calendarLabel','labelExpiresAt']) && isCalendarId(v.calendarId) &&
    (v.calendarLabel === null || boundedText(v.calendarLabel,200,1)) && (v.labelExpiresAt === null || isIsoDate(v.labelExpiresAt));
}
function createInput(v: unknown): v is CalendarCreateInput {
  return isRecord(v) && hasExactKeys(v,['summary','start','end','timeZone',
    ...('description' in v ? ['description'] : []),...('location' in v ? ['location'] : []),...('calendarId' in v ? ['calendarId'] : [])]) &&
    boundedText(v.summary,200,1) && boundedText(v.start,96,1) && boundedText(v.end,96,1) && boundedText(v.timeZone,100,1) &&
    (!('description' in v) || boundedText(v.description,2000)) && (!('location' in v) || boundedText(v.location,500)) &&
    (!('calendarId' in v) || v.calendarId === 'primary' || isCalendarId(v.calendarId));
}
function viewEntry(v: unknown): v is CalendarViewEntry {
  if (!isRecord(v) || !hasExactKeys(v,['eventId','summary','start','end','allDay','timeZone','status','htmlLink',
    ...('location' in v ? ['location'] : []),...('description' in v ? ['description'] : [])])) return false;
  return boundedText(v.eventId,1024,1) && boundedText(v.summary,200) && typeof v.allDay === 'boolean' &&
    (v.timeZone === null || validZone(v.timeZone)) && ['confirmed','tentative','cancelled'].includes(v.status as string) &&
    (v.htmlLink === null || isSafeCalendarEventLink(v.htmlLink)) &&
    (!('location' in v) || boundedText(v.location,500)) && (!('description' in v) || boundedText(v.description,2000)) &&
    (v.allDay ? dateOnly(v.start) && dateOnly(v.end) && v.end > v.start
      : instant(v.start) && instant(v.end) && Date.parse(v.end) > Date.parse(v.start));
}
export function isCalendarView(v: unknown): v is CalendarView {
  if (!isRecord(v) || v.viewVersion !== 1 || !withinBytes(v,14336)) return false;
  if (v.kind === 'agenda') {
    if (!hasExactKeys(v,['viewVersion','kind','target','requested','entries','nextPageToken','truncated','detailsTrimmed','entriesOmitted','expiresAt'])) return false;
    const r = v.requested;
    return viewTarget(v.target) && isIsoDate(v.expiresAt) && (r === null || (isRecord(r) &&
      hasExactKeys(r,['timeMin','timeMax','displayTimeZone']) && isIsoDate(r.timeMin) && isIsoDate(r.timeMax) &&
      Date.parse(r.timeMax) > Date.parse(r.timeMin) && validZone(r.displayTimeZone))) &&
      Array.isArray(v.entries) && v.entries.length <= 20 && v.entries.every(viewEntry) &&
      (v.nextPageToken === null || boundedText(v.nextPageToken,2048,1)) && typeof v.truncated === 'boolean' &&
      typeof v.detailsTrimmed === 'boolean' && typeof v.entriesOmitted === 'number' && Number.isInteger(v.entriesOmitted) &&
      v.entriesOmitted >= 0 && v.entriesOmitted <= 20 && ((v.entriesOmitted === 0 && v.nextPageToken === null) || v.truncated) &&
      (v.target.calendarLabel === null || (v.target.labelExpiresAt !== null && Date.parse(v.target.labelExpiresAt) <= Date.parse(v.expiresAt)));
  }
  if (v.kind === 'proposal') return hasExactKeys(v,['viewVersion','kind','proposalId','intentId','revision','expiresAt','reason','target','action','candidates']) &&
    isBoundedId(v.proposalId) && isBoundedId(v.intentId) && isPositiveRevision(v.revision) && isIsoDate(v.expiresAt) &&
    ['target','details','conflict','coverage'].includes(v.reason as string) && (v.target === null || viewTarget(v.target)) &&
    (v.action === null || createInput(v.action)) && Array.isArray(v.candidates) && v.candidates.length <= 20 && v.candidates.every(isCalendarClarificationCandidate);
  if (v.kind === 'outcome') return hasExactKeys(v,['viewVersion','kind','operationId','proposalId','intentId','state','retryAction','receipt']) &&
    isBoundedId(v.operationId) && (v.proposalId === null || isBoundedId(v.proposalId)) && isBoundedId(v.intentId) &&
    CALENDAR_OPERATION_STATES_V2.includes(v.state as CalendarOperationState) && CALENDAR_RETRY_ACTIONS.includes(v.retryAction as CalendarRetryAction) &&
    (v.receipt === null || isCalendarDurableReceiptV2(v.receipt)) && ((v.state === 'succeeded') === (v.receipt !== null));
  if (v.kind === 'notice') return hasExactKeys(v,['viewVersion','kind','state','message','proposalId','intentId','tool','coverage','conflict','limitations']) &&
    ['failed','unavailable','clarification','cancelled','expired','read-completed'].includes(v.state as string) && boundedText(v.message,1000,1) &&
    (v.proposalId === null || isBoundedId(v.proposalId)) && (v.intentId === null || isBoundedId(v.intentId)) &&
    [null,'calendar_list_events','calendar_get_event','calendar_list_calendars','calendar_check_availability'].includes(v.tool as string|null) &&
    [null,'complete','incomplete'].includes(v.coverage as string|null) && [null,'clear','conflict','unknown'].includes(v.conflict as string|null) &&
    Array.isArray(v.limitations) && v.limitations.length <= 8 && v.limitations.every(x=>boundedText(x,100,1));
  return false;
}
export function isCalendarPresentationEvent(v: unknown): v is CalendarPresentationEvent {
  return isCalendarProgressEvent(v) || isCalendarOperationWireEventV2(v) || isCalendarClarificationEvent(v) ||
    (isRecord(v) && hasExactKeys(v,['type','view']) && v.type === 'calendar-view' && isCalendarView(v.view));
}
```

This mirrors shape validation, not action authorization. Compare `calendar-discovery.ts`'s calendar ID schema and `identifiers.ts` with existing frontend helpers; preserve all P1-valid canonical IDs and exact limits. Extend clarification's return guard with `(!('view' in value) || (isCalendarView(value.view) && value.view.kind === 'proposal'))`. Add optional operation ID checks alongside its current guard, not another operation validator.

In `voice-protocol.ts`, import `isCalendarPresentationEvent` and its type. Add these exact types/unions and shape entries:

```ts
export type CalendarConfirmPayload = {type:'calendar.confirm';proposalId:string;proposalRevision:number;
  answer:{kind:'accept'}|{kind:'reject'}|{kind:'select';calendarId:string}};
export type CalendarFramePayload = {type:'calendar.frame';turnId:string;attemptId:string;responseId:string;event:CalendarPresentationEvent};
// Add CalendarConfirmPayload to VoiceClientPayload, CalendarFramePayload to VoiceServerPayload.
// clientShapes entry:
'calendar.confirm': {proposalId:id,proposalRevision:positive,answer:v =>
  exact(v,{kind:oneOf('accept')}) || exact(v,{kind:oneOf('reject')}) ||
  exact(v,{kind:oneOf('select'),calendarId:v=>typeof v === 'string' && v.length > 0 && v.length <= 1024 && v !== 'primary' && !/[\u0000-\u001f\u007f]/u.test(v)})},
// serverShapes entry:
'calendar.frame': {...response,attemptId:id,event:isCalendarPresentationEvent},
```

Add `calendar.frame` to the dictation server exclusion, `calendar.confirm` to dictation client exclusions, and `if (v.type === 'calendar.frame' && utf8(JSON.stringify(v)) > 16384) return false;`. Existing chunking/reassembly already handles turnId+responseId: do not fork it.

In `protocol.ts`, import view type/guard; add `calendarView?:CalendarView` to `VisibleMessage`, `VoiceTranscriptItem`, and the `completed` event; add local-only `turnId?:string` to `VoiceTranscriptItem` for history identity. Completion's exact-key list and return condition gain:

```ts
...('calendarView' in value ? ['calendarView'] : [])
// In its boolean return:
(!('calendarView' in value) || isCalendarView(value.calendarView))
```

Do not relax `isVisibleMessageCanvasArtifacts`: legacy projections remain voice-only. `listMessages()` already passes additive JSON fields through; no extra request/parse pass is needed. Validate views once when projecting API messages to artifacts, not on every token render.

- [ ] **Step 4: Verify (frontend/):** rerun the Step 2 command, then `npm run build`. Expected PASS for the new contract cases; fix union exhaustiveness/type errors in owned code. Add table cases for optional clarification `view`, optional operation IDs, requested:null, unsafe link, bad zone/date, and successful read notice using the same fixture constructors.
- [ ] **Step 5: Commit:**

```bash
git add frontend/src/api/calendar-protocol.ts frontend/src/api/voice-protocol.ts frontend/src/api/protocol.ts frontend/src/api/calendar-protocol.test.ts frontend/src/api/voice-protocol.test.ts frontend/src/api/protocol.test.ts frontend/src/features/canvas/testing/calendar-view-fixtures.ts
git commit -m "feat(calendar-ui): mirror structured Calendar view and live control contracts"
```

## Task 2: Retain scoped text views, including completion-only publication

**Files:** `frontend/src/features/chat/state/chat-types.ts`, `chat-reducer.ts`, `use-chat.ts`, `calendar-chat-state.test.ts`, `chat-stream-coalescing.test.ts`.

- [ ] **Step 1: Append failing reducer test** (import `agenda` from `../../canvas/testing/calendar-view-fixtures.ts`):

```ts
it('attaches completion-only calendar facts and never opens Canvas or revives a historical proposal', () => {
  let state = activeState();
  state = chatReducer(state,{type:'STREAM_DELTA',payload:{text:'One event.'}});
  state = chatReducer(state,{type:'STREAM_COMPLETED',payload:{assistantMessageId:'m-final',outcome:'completed',calendarView:agenda()}});
  expect(state.messages.at(-1)?.calendarView).toEqual(agenda());
  expect(state.messages.at(-1)?.content).toBe('One event.');
  expect(state.canvasOpen).toBe(false);
  const switched = chatReducer(state,{type:'SELECT_SESSION',payload:{sessionId:'other',title:'Other'}});
  expect(switched.calendarViewsByTurn).toEqual({});
  expect(switched.calendarClarification).toBeNull();
});
it('fences standalone calendar views by session, turn, attempt and sequence', () => {
  const payload = {sessionId:'session-1',turnId:'turn-1',attemptId:'attempt-1',sequence:5,view:agenda()};
  const accepted = chatReducer(activeState(),{type:'CALENDAR_VIEW',payload});
  expect(accepted.calendarViewsByTurn['turn-1']).toEqual(agenda());
  for (const patch of [{sessionId:'other'},{turnId:'old'},{attemptId:'old'},{sequence:4}]) {
    expect(chatReducer(accepted,{type:'CALENDAR_VIEW',payload:{...payload,...patch}})).toBe(accepted);
  }
});
```

- [ ] **Step 2: Run (frontend/):** `npm test -- src/features/chat/state/calendar-chat-state.test.ts`. Expected RED: missing view slice and snapshot on completed assistant.
- [ ] **Step 3: Minimal implementation.** Add `calendarViewsByTurn:Record<string,CalendarView>` and `CALENDAR_VIEW` with the same scoped payload fields as `CALENDAR_OPERATION`; add optional `calendarView` to `STREAM_COMPLETED.payload`. Initialize/reset the map in initial state, NEW_CHAT, SELECT_SESSION (do not clear historical views on a new accepted turn). Insert this reducer branch:

```ts
case 'CALENDAR_VIEW': {
  if (ignoreCalendarAction(state,action.payload)) return state;
  return {...state,calendarViewsByTurn:{...state.calendarViewsByTurn,[action.payload.turnId]:action.payload.view},
    calendarLastSequence:action.payload.sequence ?? state.calendarLastSequence};
}
```

In STREAM_COMPLETED, before constructing assistantMsg:

```ts
const view = action.payload.calendarView ?? (state.activeTurnId ? state.calendarViewsByTurn[state.activeTurnId] : undefined);
// Add to assistantMsg:
...(view ? {calendarView:view} : {})
```

`MESSAGES_LOADED` already retains message objects and reset navigation fences. Do not turn archived proposals into `calendarClarification`. Read historical views directly from messages rather than hydrating an authorization slice. For an active structured clarification, also store `event.view` under its turn in the existing CALENDAR_CLARIFICATION return; preserve its existing revision-bound hidden reply behavior.

In `dispatchStreamEvent`, forward `event.calendarView` into completed payload. Add the standalone view branch before generic non-delta coalescer flush, returning after a scoped CALENDAR_VIEW dispatch so **a display-only view does not force an extra text flush**:

```ts
if (event.type === 'calendar-view') {
  dispatch({type:'CALENDAR_VIEW',payload:{sessionId:envelope.sessionId,turnId:envelope.turnId,
    attemptId:envelope.attemptId,sequence:envelope.sequence,view:event.view}});
  return;
}
```

No new await, call to reloadMessages, save poll, or Canvas opening in this path. Completion still drains coalesced text once and dispatches terminal state immediately.

- [ ] **Step 4: Add actual orchestration coverage** to `chat-stream-coalescing.test.ts`, reusing its SSR Harness/client setup. This exact test covers the completion-only path rather than merely passing a reducer field directly:

```ts
it('publishes Calendar completion before any visual rendering or frame tick', async () => {
  const client = new ApiClient({fetch:vi.fn()});
  vi.spyOn(client,'submitTurn').mockResolvedValue({sessionId:'sess_1',turnId:'turn_1',attemptId:'att_1',userMessageId:'u',streamPath:'/stream'});
  let handler!: NonNullable<Parameters<ApiClient['connectTurnStream']>[1]['onEvent']>;
  vi.spyOn(client,'connectTurnStream').mockImplementation(async (_path,h) => {handler=h.onEvent!;});
  let state:ChatState = {...initialChatState,activeSessionId:'sess_1'};
  const dispatch = (a:ChatAction) => {state=chatReducer(state,a);};
  let actions!:ReturnType<typeof useChatActions>;
  function Harness(){actions=useChatActions(state,dispatch,client);return null;}
  renderToStaticMarkup(createElement(Harness));
  await actions.submitMessage('Check my calendar');
  const envelope=createMockEnvelope({protocolVersion:3});
  handler({type:'delta',text:'One event.'},envelope);
  handler({type:'completed',assistantMessageId:'m',outcome:'completed',calendarView:agenda()},
    {...envelope,sequence:2});
  expect(state.messages.at(-1)).toMatchObject({content:'One event.',calendarView:agenda()});
  expect(state.isStreaming).toBe(false);
  expect(state.canvasOpen).toBe(false);
});
```

Import `agenda` into that test file. Verify (frontend/): `npm test -- src/features/chat/state/calendar-chat-state.test.ts src/features/chat/state/chat-stream-coalescing.test.ts src/features/chat/state/chat-followup-generation-safety.test.ts`. Expected PASS; existing stale-generation/abort tests remain unchanged.
- [ ] **Step 5: Commit:**

```bash
git add frontend/src/features/chat/state/chat-types.ts frontend/src/features/chat/state/chat-reducer.ts frontend/src/features/chat/state/use-chat.ts frontend/src/features/chat/state/calendar-chat-state.test.ts frontend/src/features/chat/state/chat-stream-coalescing.test.ts
git commit -m "feat(calendar-ui): preserve scoped text Calendar snapshots at completion"
```

## Task 3: Fold live frames into one bounded presentation workspace

**Files:** create `frontend/src/features/canvas/calendar-workspace.ts` and `calendar-workspace.test.ts`; modify `frontend/src/features/voice/state/live-voice-reducer.ts`, `live-voice-reducer.test.ts`.

- [ ] **Step 1: Write the failing test** in the new workspace test, with its mandatory header:

```ts
import {expect,it} from 'vitest';
import {foldCalendarFrame} from './calendar-workspace.ts';
import {proposal,outcome} from './testing/calendar-view-fixtures.ts';
import type {CalendarFramePayload} from '../../api/voice-protocol.ts';
const frame=(event:CalendarFramePayload['event'],turnId='turn-1'):CalendarFramePayload =>
  ({type:'calendar.frame',turnId,attemptId:`attempt-${turnId}`,responseId:`response-${turnId}`,event});
it('keeps proposal, confirmation progress and outcome in one workspace without treating progress as success',()=>{
  let items=foldCalendarFrame([],frame({type:'calendar-progress',phase:'executing'}));
  const id=items[0].id;
  items=foldCalendarFrame(items,frame({type:'calendar-view',view:proposal()}));
  items=foldCalendarFrame(items,frame({type:'calendar-progress',phase:'executing'},'confirm-turn'));
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({id,phase:'executing',interactive:false});
  items=foldCalendarFrame(items,frame({type:'calendar-view',view:outcome()},'confirm-turn'));
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({id,view:{kind:'outcome',state:'succeeded'}});
  expect(items[0].turnIds).toEqual(['turn-1','confirm-turn']);
});
it('does not open for schema validation and splits a genuinely different intent',()=>{
  expect(foldCalendarFrame([],frame({type:'calendar-progress',phase:'validating'}))).toEqual([]);
  let items=foldCalendarFrame([],frame({type:'calendar-view',view:proposal()}));
  items=foldCalendarFrame(items,frame({type:'calendar-progress',phase:'executing'},'new-turn'));
  items=foldCalendarFrame(items,frame({type:'calendar-view',view:{...proposal(),proposalId:'proposal-2',intentId:'intent-2'}},'new-turn'));
  expect(items).toHaveLength(2);
  expect(items[0].turnIds).toEqual(['turn-1']);
  expect(items[1].id).toBe('calendar:new-turn');
  expect(items[0].interactive).toBe(false);
});
```

- [ ] **Step 2: Run (frontend/):** `npm test -- src/features/canvas/calendar-workspace.test.ts`. Expected RED: missing module/export.
- [ ] **Step 3: Add this projection implementation**, prefixed by the full header. It keeps at most 64 recent workspaces per call; persisted assistant snapshots remain the archive. This is not a new lifecycle/authorization state machine:

```ts
import type {CalendarProgressPhase,CalendarView} from '../../api/calendar-protocol.ts';
import type {CalendarFramePayload} from '../../api/voice-protocol.ts';
export type CalendarWorkspace = {
  id:string;turnIds:string[];artifactAliases:string[];intentId:string|null;proposalId:string|null;operationId:string|null;
  view:CalendarView|null;proposal:Extract<CalendarView,{kind:'proposal'}>|null;
  phase:CalendarProgressPhase|null;interactive:boolean;pending:boolean;
};
export function foldCalendarFrame(items:readonly CalendarWorkspace[],frame:CalendarFramePayload):CalendarWorkspace[] {
  const event=frame.event;
  const view=event.type === 'calendar-view' ? event.view : event.type === 'calendar-clarification' ? event.view ?? null : null;
  const op=event.type === 'calendar-operation' ? event.operation : null;
  const intentId=(view && 'intentId' in view ? view.intentId : null) ?? op?.intentId ?? null;
  const proposalId=(view && 'proposalId' in view ? view.proposalId : null) ?? op?.proposalId ??
    (event.type === 'calendar-clarification' ? event.proposalId : null);
  const operationId=(view?.kind === 'outcome' ? view.operationId : null) ?? op?.operationId ?? null;
  const correlated=items.find(w=>(intentId !== null && w.intentId === intentId) ||
    (proposalId !== null && w.proposalId === proposalId) || (operationId !== null && w.operationId === operationId));
  const byTurn=items.find(w=>w.turnIds.includes(frame.turnId));
  const differentIntent=Boolean(intentId && byTurn?.intentId && intentId !== byTurn.intentId);
  const pending=items.findLast(w=>w.view?.kind === 'proposal' && (w.interactive || w.pending));
  const target=correlated ?? (differentIntent ? undefined : byTurn) ??
    (!intentId && !proposalId && !operationId ? pending : undefined);
  if (!target && event.type === 'calendar-progress' && !['executing','reconciling'].includes(event.phase)) return [...items];
  if (view?.kind === 'proposal' && target?.proposal?.proposalId === view.proposalId &&
    (view.revision < target.proposal.revision || (target.pending && view.revision === target.proposal.revision))) return [...items];
  if (view?.kind === 'proposal' && target?.view &&
    ((target.view.kind === 'outcome' && !['planned','dispatching'].includes(target.view.state)) ||
      (target.view.kind === 'notice' && ['cancelled','expired'].includes(target.view.state)))) return [...items];
  const initial:CalendarWorkspace={id:`calendar:${frame.turnId}`,turnIds:[],artifactAliases:[],intentId:null,proposalId:null,operationId:null,
    view:null,proposal:null,phase:null,interactive:false,pending:false};
  const base=target ?? initial;
  const operationView:CalendarView|null=op && op.intentId ? {viewVersion:1,kind:'outcome',operationId:op.operationId,
    proposalId:op.proposalId ?? null,intentId:op.intentId,state:op.state,retryAction:op.retryAction,receipt:op.receipt} : null;
  const nextView=view ?? operationView ?? base.view;
  const isProposal=Boolean(view?.kind === 'proposal');
  const mergingProvisional=byTurn && byTurn.id !== base.id && !differentIntent ? byTurn : null;
  const next:CalendarWorkspace={...base,turnIds:[...new Set([...base.turnIds,...(mergingProvisional?.turnIds ?? []),frame.turnId])],
    artifactAliases:[...new Set([...base.artifactAliases,...(mergingProvisional ?
      [`${mergingProvisional.id}::canvas::calendar`,...mergingProvisional.artifactAliases] : [])])],
    intentId:intentId ?? base.intentId,proposalId:proposalId ?? base.proposalId,operationId:operationId ?? base.operationId,
    view:nextView,proposal:view?.kind === 'proposal' ? view : base.proposal,
    phase:event.type === 'calendar-progress' ? event.phase : null,interactive:isProposal,pending:false};
  const updated=items.filter(w=>w.id !== next.id && w.id !== mergingProvisional?.id).map(w=>({...w,interactive:false,
    turnIds:w.turnIds.filter(id=>id !== frame.turnId)})).filter(w=>w.turnIds.length > 0);
  // ponytail: at most 64 recent workspaces per call; assistant messages are the archive.
  // If longer-call navigation is needed, page the existing message archive rather than grow this slice.
  return [...updated,next].slice(-64);
}
export const freezeCalendarControls=(items:readonly CalendarWorkspace[]) =>
  items.map(w=>({...w,interactive:false}));
```

The provisional merge unions both turn lists and preserves the discarded artifact ID for Task 5. Lower revisions and pending/resolved proposal replay cannot restore controls. Duplicates/sequence fencing belong to the controller in Task 4.

Add `calendarWorkspaces:CalendarWorkspace[]` to LiveVoiceState, initialize `[]`, and append these action members (import CalendarFramePayload with `import type`):

```ts
| {type:'CALENDAR_FRAME';frame:CalendarFramePayload}
| {type:'CALENDAR_PENDING';proposalId:string;revision:number}
```

Reducer bodies:

```ts
case 'CALENDAR_FRAME':
  return {...state,calendarWorkspaces:foldCalendarFrame(state.calendarWorkspaces,action.frame)};
case 'CALENDAR_PENDING':
  return {...state,calendarWorkspaces:state.calendarWorkspaces.map(w=>w.view?.kind === 'proposal' &&
    w.view.proposalId === action.proposalId && w.view.revision === action.revision ? {...w,pending:true,interactive:false} : w)};
```

LOST and PAUSE freeze controls but retain snapshots; RESUMED/READY never re-enable old proposals. ENDING/EXIT retain/freeze snapshots iff their existing `retainArtifacts` flag is true; START and navigation exit clear them. INTERRUPT/DRAINED **do not** clear Calendar facts, declare cancellation, or disable a durable outcome. A fresh proposal frame is needed to make a proposal interactive after reconnect. No expiry polling.

- [ ] **Step 4: Verify (frontend/):** `npm test -- src/features/canvas/calendar-workspace.test.ts src/features/voice/state/live-voice-reducer.test.ts`. Extend reducer tests to assert LOST→RESUMED is read-only, navigation clears, user exit retains read-only, and barge-in preserves unknown/succeeded facts. Expected PASS.
- [ ] **Step 5: Commit:**

```bash
git add frontend/src/features/canvas/calendar-workspace.ts frontend/src/features/canvas/calendar-workspace.test.ts frontend/src/features/voice/state/live-voice-reducer.ts frontend/src/features/voice/state/live-voice-reducer.test.ts
git commit -m "feat(calendar-ui): fold live Calendar frames into stable workspaces"
```

## Task 4: Route correlated live frames and confirmation without touching media

**Files:** `frontend/src/features/voice/state/live-voice-controller.ts`, `live-voice-controller.test.ts`, `state/testing/live-voice-fixture.ts`, `useLiveVoice.ts`, `frontend/src/App.tsx`.

- [ ] **Step 1: Add failing controller tests**, importing fixture view factories from `../../canvas/testing/calendar-view-fixtures.ts`:

```ts
it('sends one revision-bound confirmation and leaves microphone/playback unchanged',async()=>{
  const f=liveVoiceFixture();await f.begin();
  f.event({type:'conversation.bound',conversationId:'chat-1'});
  f.event({type:'calendar.frame',turnId:'t1',attemptId:'a1',responseId:'r1',event:{type:'calendar-view',view:proposal()}});
  f.client.control.mockClear();f.client.setInputEnabled.mockClear();f.client.invalidate.mockClear();
  expect(f.controller.confirmCalendar('proposal-1',2,{kind:'accept'})).toBe(true);
  expect(f.controller.confirmCalendar('proposal-1',2,{kind:'accept'})).toBe(false);
  expect(f.client.control).toHaveBeenCalledExactlyOnceWith({type:'calendar.confirm',proposalId:'proposal-1',
    proposalRevision:2,answer:{kind:'accept'}});
  expect(f.client.setInputEnabled).not.toHaveBeenCalled();
  expect(f.client.invalidate).not.toHaveBeenCalled();
  expect(f.http.end).not.toHaveBeenCalled();
  f.controller.exit();await settle();
});
it('keeps audio operational when Calendar presentation throws and ignores old epochs',async()=>{
  const f=liveVoiceFixture();await f.begin();f.event({type:'conversation.bound',conversationId:'chat-1'});
  const off=f.controller.subscribe(()=>{throw new Error('visual subscriber failed');});
  expect(()=>f.event({type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',
    event:{type:'calendar-view',view:agenda()}})).not.toThrow();
  off();
  f.event({type:'audio.start',turnId:'t',responseId:'r',sampleRate:24000,firstAudioSequence:0});
  expect(f.controller.getSnapshot()).toMatchObject({phase:'active',agent:'speaking'});
  expect(f.client.stopInput).not.toHaveBeenCalled();
  const before=f.controller.getSnapshot().calendarWorkspaces;
  f.event({type:'calendar.frame',turnId:'old',attemptId:'old',responseId:'old',event:{type:'calendar-view',view:notice()}},0);
  expect(f.controller.getSnapshot().calendarWorkspaces).toBe(before);
  f.controller.exit();await settle();
});
```

- [ ] **Step 2: Run (frontend/):** `npm test -- src/features/voice/state/live-voice-controller.test.ts -t "Calendar|confirmation"`. Expected RED: frame not routed / missing confirmCalendar.
- [ ] **Step 3: Minimal implementation.** Extend `LiveVoiceBindings` with `getActiveConversationId?:()=>string|null` (calendar fails closed if not supplied). App supplies `getActiveConversationId:()=>state.activeSessionId`; useLiveVoice delegates through `latest.current`, without recreating the controller:

```ts
getActiveConversationId:()=>latest.current.bindings.getActiveConversationId?.() ?? null,
```

In `state/testing/live-voice-fixture.ts`, add `let selectedConversationId=response.conversationId;`, replace its fake bind method and add the getter:

```ts
bindVoiceConversation:vi.fn((token:string,id:string)=>{
  if (owner !== token) return false;
  selectedConversationId=id;return true;
}),
getActiveConversationId:()=>selectedConversationId,
```

Add `selectConversation:(id:string|null)=>{selectedConversationId=id;}` to its returned harness. Do not derive selection solely from the old run's session.

Add run fields initialized in `start`: `calendarSequence:-1`, `calendarEpoch:undefined`, `calendarAttempts:new Map<string,string>()`. Handle calendar frames in a **local** try/catch:

```ts
case 'calendar.frame': {
  try {
    const selected=this.ports.bindings.getActiveConversationId?.();
    if (!run.ready || !selected || selected !== run.session?.conversationId || selected !== this.view.conversationId) break;
    if (run.calendarEpoch !== event.connectionEpoch) {
      run.calendarEpoch=event.connectionEpoch;run.calendarSequence=-1;
    }
    if (event.sequence <= run.calendarSequence) break;
    const attempt=run.calendarAttempts.get(event.turnId);
    if (attempt && attempt !== event.attemptId) break;
    if (!attempt && run.calendarAttempts.size >= 4096) break;
    const knownTurn=run.turnByResponse.get(event.responseId);
    if (knownTurn !== undefined && knownTurn !== event.turnId) break;
    if (knownTurn === undefined && run.turnByResponse.size >= 4096) break;
    run.turnByResponse.set(event.responseId,event.turnId);
    run.calendarAttempts.set(event.turnId,event.attemptId);run.calendarSequence=event.sequence;
    this.dispatch({type:'CALENDAR_FRAME',frame:event});
  } catch { /* Calendar presentation failure never pauses media or changes the authoritative result. */ }
  break;
}
```

Existing `event()` run/session/epoch checks remain first. Do **not** reuse cancelled/retired speech-response sets to drop Calendar outcomes: a late authoritative succeeded/unknown frame may still be true after barge-in. Frame responseId remains checked by the shared wire guard; map responseId→turnId consistently with existing known-turn checks, without changing `run.response`/playout. Reject a frame that claims a responseId already associated with a different turn. Real transport already validates wire/sequence; these checks protect the controller's conversation boundary and injected callbacks.

Add this public synchronous method (import `CalendarConfirmPayload`):

```ts
confirmCalendar(proposalId:string,revision:number,answer:CalendarConfirmPayload['answer']):boolean {
  const run=this.run;
  if (!run || !this.current(run) || !run.ready || run.needsGesture || this.view.phase !== 'active' ||
    this.view.connection !== 'connected' || this.view.agent === 'thinking' || this.view.inputBusy ||
    this.ports.bindings.getActiveConversationId?.() !== run.session?.conversationId) return false;
  const workspace=this.view.calendarWorkspaces.find(w=>w.interactive && !w.pending && w.view?.kind === 'proposal' &&
    w.view.proposalId === proposalId && w.view.revision === revision);
  const view=workspace?.view;
  if (!view || view.kind !== 'proposal' || Date.parse(view.expiresAt) <= Date.now()) return false;
  if (answer.kind === 'select' && !view.candidates.some(c=>c.calendarId === answer.calendarId)) return false;
  if (answer.kind === 'accept' && (view.reason === 'target' || !view.action || !view.target)) return false;
  const unconfirmed=()=>{
    try {this.dispatch({type:'NOTICE',notice:'Confirmation delivery is unconfirmed. Check the outcome before trying again.'});}
    catch { /* A visual subscriber must not escape this control handler. */ }
  };
  // dispatch updates the snapshot before notifying subscribers: the duplicate fence is synchronous.
  try {this.dispatch({type:'CALENDAR_PENDING',proposalId,revision});}
  catch { /* A failed visual notification must not prevent the authorized control send. */ }
  try {
    const sent=run.client?.control({type:'calendar.confirm',proposalId,proposalRevision:revision,answer}) ?? false;
    if (!sent) unconfirmed();
    return sent;
  } catch {unconfirmed();return false;}
}
```

If `control` returns false or throws, retain the read-only pending fence and display a local Calendar notice: “Confirmation delivery is unconfirmed. Check the outcome before trying again.” Do not automatically resend or re-enable the old proposal. This is not proof the write failed. A fresh server proposal/revision can enable buttons again. No call to interrupt, mute, invalidate, HTTP submitTurn, or endSession.

Expose `confirmCalendar:(proposalId,revision,answer)=>controller.confirmCalendar(...)` from useLiveVoice and in `LiveVoiceSurface` (optional for old non-calendar test surfaces; absent means read-only). Keep its return type boolean, not an awaited rendering promise.

- [ ] **Step 4: Freeze test time around new confirmation tests** with `vi.useFakeTimers(); vi.setSystemTime(NOW)` and `finally { f.controller.exit(); await settle(); vi.useRealTimers(); }`; otherwise the five-minute fixture proposal is correctly expired by wall clock. Add table tests for wrong selected conversation, expired/replaced revision, lost/recovered epoch (read-only until fresh proposal), invalid candidate, thinking/inputBusy, reject/select controls, and false/throwing control. Duplicate/raw frame test uses `f.callbacks().event` with the same sequence rather than `f.event` (which increments sequence). Verify (frontend/): `npm test -- src/features/voice/state/live-voice-controller.test.ts src/features/voice/state/live-voice-reducer.test.ts src/api/voice-protocol.test.ts`, then `npm run build`. Expected PASS with existing media tests unchanged.
- [ ] **Step 5: Commit:**

```bash
git add frontend/src/features/voice/state/live-voice-controller.ts frontend/src/features/voice/state/live-voice-controller.test.ts frontend/src/features/voice/state/testing/live-voice-fixture.ts frontend/src/features/voice/state/useLiveVoice.ts frontend/src/App.tsx
git commit -m "feat(calendar-ui): bind live Calendar controls without gating media"
```

## Task 5: Hydrate typed artifacts and deduplicate live, completed, and legacy views

**Files:** `frontend/src/features/canvas/canvas-types.ts`, `canvas-artifacts.ts`, `calendar-workspace.ts`, `index.ts`, `calendar-canvas.test.ts`.

- [ ] **Step 1: Append failing artifact tests** (import fixtures and the named new helpers):

```ts
it('hydrates an empty-content assistant snapshot without applying legacy source limits',()=>{
  const message=calendarMessage(agenda(),'live');
  const items=collectSessionCanvasArtifacts([message],'',false);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({artifactId:'assistant-1::canvas::calendar',turnId:'turn-1',
    kind:'calendar',calendarView:agenda(),isStreaming:false});
  expect(items[0].rawSource).toBe('');
  expect(collectSessionCanvasArtifacts([{...message,role:'user'}],'',false)).toEqual([]);
});
it('keeps one tab and its aliases when live and persisted views refer to the same request',()=>{
  const frames=foldCalendarFrame([], {type:'calendar.frame',turnId:'turn-1',attemptId:'a',responseId:'r',
    event:{type:'calendar-view',view:agenda()}});
  const archived=collectSessionCanvasArtifacts([calendarMessage()],'',false);
  const live=mergeCalendarWorkspaces(archived,frames,true);
  expect(live).toHaveLength(1);
  expect(live[0].artifactId).toBe('calendar:turn-1::canvas::calendar');
  expect(live[0].calendarAliases).toContain('assistant-1::canvas::calendar');
  const settled=mergeCalendarWorkspaces(archived,frames,false);
  expect(settled).toHaveLength(1);
  expect(settled[0].calendarWorkspace).toBeUndefined();
  expect(settled[0].calendarAliases).toContain(live[0].artifactId);
  expect(mergeCalendarWorkspaces([],frames,false)).toEqual([]);
});
```

- [ ] **Step 2: Run (frontend/):** `npm test -- src/features/canvas/calendar-canvas.test.ts`. Expected RED: structured message omitted / helpers absent.
- [ ] **Step 3: Add typed optional metadata to CanvasArtifact**, without changing existing required fields:

```ts
turnId?:string;
calendarView?:CalendarView;
calendarWorkspace?:CalendarWorkspace;
calendarAliases?:string[];
```

Import those types with `import type`; no runtime dependency cycle. Append these functions to `calendar-workspace.ts` and export them through `canvas/index.ts`:

```ts
import type {CanvasArtifact} from './canvas-types.ts';
export function calendarViewKey(view:CalendarView|null,turnId:string):string {
  return view && 'intentId' in view && view.intentId ? `intent:${view.intentId}` : `turn:${turnId}`;
}
export function calendarViewArtifact(view:CalendarView,messageId:string,turnId:string):CanvasArtifact {
  const title=view.kind === 'agenda' ? 'Calendar agenda' : view.kind === 'proposal' ? 'Review Calendar event' :
    view.kind === 'outcome' ? 'Calendar outcome' : 'Calendar update';
  return {artifactId:`${messageId}::canvas::calendar`,messageId,turnId,index:0,kind:'calendar',
    subType:view.kind === 'agenda' ? 'Agenda' : view.kind === 'proposal' ? 'Confirmation' : 'Calendar',
    title,buttonLabel:view.kind === 'agenda' ? 'View agenda in Canvas' : 'View Calendar result in Canvas',
    rawSource:'',isStreaming:false,calendarView:view};
}
export function mergeCalendarWorkspaces(artifacts:readonly CanvasArtifact[],workspaces:readonly CalendarWorkspace[],includeLive:boolean):CanvasArtifact[] {
  let result=[...artifacts];
  for (const workspace of workspaces) {
    const matching=result.filter(a=>a.kind === 'calendar' &&
      ((a.turnId !== undefined && workspace.turnIds.includes(a.turnId)) ||
       (a.calendarView && workspace.view && calendarViewKey(a.calendarView,a.turnId ?? a.messageId) ===
         calendarViewKey(workspace.view,workspace.turnIds[0]))));
    const liveId=`${workspace.id}::canvas::calendar`;
    const aliases=[...new Set([liveId,...workspace.artifactAliases,...matching.flatMap(a=>[a.artifactId,...(a.calendarAliases ?? [])])])];
    if (!includeLive && matching.length === 0) continue;
    const archived=matching.at(-1);
    const item:CanvasArtifact=includeLive ? {
      ...(workspace.view ? calendarViewArtifact(workspace.view,workspace.id,workspace.turnIds[0]) :
        {artifactId:liveId,messageId:workspace.id,turnId:workspace.turnIds[0],index:0,kind:'calendar' as const,
          subType:'Calendar',title:'Calendar workspace',buttonLabel:'View Calendar in Canvas',rawSource:'',isStreaming:false}),
      calendarWorkspace:workspace,calendarAliases:aliases,
    } : {...archived!,calendarAliases:aliases};
    const ids=new Set(matching.map(a=>a.artifactId));
    const insertion=result.findIndex(a=>ids.has(a.artifactId));
    result=result.filter(a=>!ids.has(a.artifactId));
    result.splice(insertion < 0 ? result.length : insertion,0,item);
  }
  return result;
}
export const matchesCalendarArtifact=(artifact:CanvasArtifact,id:string|null) =>
  id !== null && (artifact.artifactId === id || artifact.calendarAliases?.includes(id) === true);
```

Only merge workspaces from the selected conversation (Task 9). During an active call, the live workspace is the current projection and its archived duplicates are aliases, not extra tabs. After exit/reload completes, durable message views win; unmatched provisional views disappear, exactly like existing voice artifacts. Snapshots from the same request may resolve to its latest retained result while bridged; no archived snapshot enables controls. Do not deduplicate unrelated agendas by title or date.

In `collectSessionCanvasArtifacts`'s existing WeakMap cache, include `calendarView` in the cached identity fields and cache-invalidation condition. Admit assistant messages even if content is empty and no `canvasArtifacts` exist, using:

```ts
msg.role === 'assistant' && (msg.content || msg.canvasArtifacts !== undefined || msg.calendarView !== undefined)
```

Inside cache rebuild, add:

```ts
const calendarItem=msg.calendarView && isCalendarView(msg.calendarView)
  ? calendarViewArtifact(msg.calendarView,msg.messageId,msg.turnId) : null;
// Typed data supersedes calendar fences in that same message, not unrelated diagrams.
const items=[...textItems,...voiceItems].filter(a=>!calendarItem || a.kind !== 'calendar')
  .map(a=>a.kind === 'calendar' ? {...a,turnId:msg.turnId} : a);
if (calendarItem) items.push(calendarItem);
```

Store `items` and `calendarView:msg.calendarView` in that cache. Do not serialize/parse the view to squeeze it into rawSource. Existing legacy receipt synthesis remains only when no structured artifact exists for that turn; add `turnId` to both existing fallback constructors so merge can recognize them. Do not manufacture an agenda/proposal from narration regexes. Keep all non-calendar markdown/voice projections unchanged.

Active text view events before completion can be projected using `calendarViewArtifact(view,turnId,turnId)` from the scoped `calendarViewsByTurn` map; skip it once a persisted structured message for that turn exists. Task 8 uses this same collection, not a second parser.

- [ ] **Step 4: Verify (frontend/):** `npm test -- src/features/canvas/calendar-canvas.test.ts src/features/canvas/canvas.test.ts src/features/canvas/streaming-markdown.test.ts src/features/canvas/calendar-workspace.test.ts`. Add a valid >8,192-character/<14,336-byte agenda to the hydration test and assert it survives. Add mutable-message-cache regression by replacing `message.calendarView` and collecting again, ensuring a changed snapshot is not cached as the old one. Expected PASS.
- [ ] **Step 5: Commit:**

```bash
git add frontend/src/features/canvas/canvas-types.ts frontend/src/features/canvas/canvas-artifacts.ts frontend/src/features/canvas/calendar-workspace.ts frontend/src/features/canvas/index.ts frontend/src/features/canvas/calendar-canvas.test.ts
git commit -m "feat(canvas): hydrate typed Calendar snapshots and deduplicate workspace tabs"
```

## Task 6: Render accurate agendas, exact proposals, and truthful outcomes

**Files:** create `frontend/src/features/canvas/renderers/calendar-agenda-view.tsx`, `calendar-view-renderer.tsx`, and their `.test.ts` files. Header each before writing code. Reuse existing helpers from `CalendarTurnRegion.tsx` and `resolveSafeCalendarLink` from `canvas-artifacts.ts`.

- [ ] **Step 1: Write failing agenda tests** in `calendar-agenda-view.test.ts`:

```ts
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {CalendarAgendaView,calendarDay,calendarInterval} from './calendar-agenda-view.tsx';
import {agenda,NOW} from '../testing/calendar-view-fixtures.ts';
it('keeps date-only exclusive ends and shows full cross-day timed intervals',()=>{
  const allDay={...agenda().entries[0],allDay:true,start:'2026-11-11',end:'2026-11-14',timeZone:null};
  expect(calendarDay(allDay,'America/Los_Angeles')).toBe('2026-11-11');
  expect(calendarInterval(allDay,'America/Los_Angeles')).toContain('Nov 13');
  expect(calendarInterval(allDay,'America/Los_Angeles')).not.toContain('Nov 14');
  const timed={...agenda().entries[0],start:'2026-11-11T23:30:00Z',end:'2026-11-12T01:00:00Z'};
  expect(calendarInterval(timed,'Etc/UTC')).toContain('Nov 11');
  expect(calendarInterval(timed,'Etc/UTC')).toContain('Nov 12');
  const dst={...timed,start:'2026-11-01T05:30:00Z',end:'2026-11-01T06:30:00Z'};
  expect(calendarInterval(dst,'America/New_York')).toContain('EDT');
  expect(calendarInterval(dst,'America/New_York')).toContain('EST');
});
it('distinguishes empty, partial and trimmed results and escapes details',()=>{
  const view=agenda();
  const html=renderToStaticMarkup(createElement(CalendarAgendaView,{view,nowMs:NOW}));
  expect(html).toContain('Design sync');expect(html).toContain('Europe/London');
  expect(html).toContain('<details');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
  expect(html).toContain('rel="noopener noreferrer"');
  const partial=renderToStaticMarkup(createElement(CalendarAgendaView,{view:{...view,entries:[],truncated:true,
    nextPageToken:'opaque',detailsTrimmed:true,entriesOmitted:2},nowMs:NOW}));
  expect(partial).toContain('More results are available');
  expect(partial).toContain('2 events omitted');expect(partial).toContain('Some details were shortened');
  expect(partial).not.toContain('No events in this range');
  const empty=renderToStaticMarkup(createElement(CalendarAgendaView,{view:{...view,entries:[]},nowMs:NOW}));
  expect(empty).toContain('No events in this range');
  const expired=renderToStaticMarkup(createElement(CalendarAgendaView,{view,nowMs:NOW+600_000}));
  expect(expired).not.toContain('href=');expect(expired).not.toContain('Calendar: Team');
  expect(expired).toContain('Design sync');
});
```

Write failing review/outcome tests in `calendar-view-renderer.test.ts`:

```ts
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {CalendarProposalReviewCard,CalendarViewRenderer} from './calendar-view-renderer.tsx';
import {proposal,outcome,notice,NOW} from '../testing/calendar-view-fixtures.ts';
it('makes history read-only and only current live proposals expose exact-action controls',()=>{
  const view=proposal();
  const history=renderToStaticMarkup(createElement(CalendarProposalReviewCard,{view,nowMs:NOW}));
  expect(history).toContain('Historical snapshot');expect(history).not.toContain('>Confirm event<');
  const live=renderToStaticMarkup(createElement(CalendarProposalReviewCard,{view,nowMs:NOW,
    interactive:true,disabled:false,onAnswer:vi.fn()}));
  expect(live).toContain('Design sync');expect(live).toContain('team@example.com');
  expect(live).toContain('Europe/London');expect(live).toContain('Confirm event');expect(live).toContain('Cancel request');
  const expired=renderToStaticMarkup(createElement(CalendarProposalReviewCard,{view,nowMs:NOW+600_000,
    interactive:true,onAnswer:vi.fn()}));
  expect(expired).toContain('Request expired');expect(expired).not.toContain('>Confirm event<');
});
it('never labels a failure, uncertain write or successful read as event creation',()=>{
  for (const state of ['unknown','definitely-failed','failed','cancelled','evidence-expired'] as const) {
    const view={...outcome(),state,receipt:null};
    const html=renderToStaticMarkup(createElement(CalendarViewRenderer,{view,nowMs:NOW}));
    expect(html).not.toContain('Calendar event created');expect(html).not.toContain('href=');
    expect(html).toContain(`data-calendar-state="${state}"`);
  }
  const read=renderToStaticMarkup(createElement(CalendarViewRenderer,{view:{...notice(),state:'read-completed',
    message:'Availability checked.',tool:'calendar_check_availability',coverage:'incomplete',conflict:'unknown'},nowMs:NOW}));
  expect(read).toContain('Availability checked.');expect(read).toContain('Coverage is incomplete');
  expect(read).not.toContain('No events');expect(read).not.toContain('Calendar event created');
});
```

- [ ] **Step 2: Run (frontend/):** `npm test -- src/features/canvas/renderers/calendar-agenda-view.test.ts src/features/canvas/renderers/calendar-view-renderer.test.ts`. Expected RED: new renderer exports absent.
- [ ] **Step 3: Implement agenda date formatting and native disclosure** in `calendar-agenda-view.tsx`, after its full header:

```tsx
import {useMemo} from 'react';
import type {CalendarView,CalendarViewEntry} from '../../../api/calendar-protocol.ts';
import {resolveSafeCalendarLink} from '../canvas-artifacts.ts';
type Agenda=Extract<CalendarView,{kind:'agenda'}>;
const dayLabel=(day:string)=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})
  .format(new Date(`${day}T12:00:00Z`));
export function calendarDay(entry:CalendarViewEntry,zone:string):string {
  if (entry.allDay) return entry.start;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(entry.start));
  const part=(name:string)=>parts.find(p=>p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function calendarInterval(entry:Pick<CalendarViewEntry,'start'|'end'|'allDay'>,zone:string):string {
  if (entry.allDay) {
    const last=new Date(Date.parse(`${entry.end}T00:00:00Z`)-86_400_000).toISOString().slice(0,10);
    return `All day · ${dayLabel(entry.start)}${last === entry.start ? '' : ` – ${dayLabel(last)}`}`;
  }
  try {
    const fmt=new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',year:'numeric',
      hour:'numeric',minute:'2-digit',timeZoneName:'short'});
    return `${fmt.format(new Date(entry.start))} – ${fmt.format(new Date(entry.end))}`;
  } catch { return `${entry.start} – ${entry.end} (${zone})`; }
}
export function CalendarAgendaView({view,nowMs=Date.now()}:{view:Agenda;nowMs?:number}) {
  const zone=view.requested?.displayTimeZone ?? view.entries.find(e=>e.timeZone)?.timeZone ?? 'Etc/UTC';
  const groups=useMemo(()=>{
    const map=new Map<string,CalendarViewEntry[]>();
    for (const entry of view.entries) {
      const day=calendarDay(entry,zone);const list=map.get(day) ?? [];list.push(entry);map.set(day,list);
    }
    return [...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([day,entries])=>({day,
      entries:entries.toSorted((a,b)=>Number(b.allDay)-Number(a.allDay) ||
        (a.allDay && b.allDay ? a.start.localeCompare(b.start) : Date.parse(a.start)-Date.parse(b.start)))}));
  },[view,zone]);
  const fresh=Date.parse(view.expiresAt)>nowMs;
  const label=fresh && view.target.labelExpiresAt && Date.parse(view.target.labelExpiresAt)>nowMs ? view.target.calendarLabel : null;
  const incomplete=view.truncated || view.nextPageToken !== null || view.entriesOmitted>0;
  return <section className="aurvin-calendar-agenda" aria-label="Calendar agenda">
    <header><h2>Calendar agenda</h2>{label ? <p>Calendar: {label}</p> : null}
      <p>{view.requested ? calendarInterval({start:view.requested.timeMin,end:view.requested.timeMax,allDay:false},zone) : 'Returned event details'}</p>
      <p>Time zone: {zone}</p></header>
    {incomplete ? <p role="status">{view.nextPageToken ? 'More results are available. Ask Aurvin to continue this lookup.' : 'Only part of the requested results is shown.'}</p> : null}
    {view.entriesOmitted>0 ? <p>{view.entriesOmitted} events omitted by the display limit.</p> : null}
    {view.detailsTrimmed ? <p>Some details were shortened to fit this result.</p> : null}
    {!view.entries.length && !incomplete ? <p>{view.requested ? 'No events in this range.' : 'No event details returned.'}</p> : null}
    <p className="aurvin-calendar-caption">Grouped by start day. Multi-day events appear once with their full interval.</p>
    {groups.map(group=><section className="aurvin-calendar-day" key={group.day} aria-label={dayLabel(group.day)}>
      <h3><time dateTime={group.day}>{dayLabel(group.day)}</time></h3>
      <ul>{group.entries.map((entry,index)=>{
        const link=fresh ? resolveSafeCalendarLink(entry.htmlLink) : null;
        return <li className="aurvin-calendar-agenda-entry" key={`${entry.eventId}:${index}`}>
          <h4>{entry.summary || 'Untitled event'}</h4><p>{calendarInterval(entry,zone)}</p>
          <p>{entry.allDay ? 'All-day' : 'Timed'} · {entry.status}</p>
          <details><summary>Event details: {entry.summary || 'Untitled event'}</summary>
            {entry.location ? <p>Location: {entry.location}</p> : null}
            {entry.description ? <p className="aurvin-calendar-description">{entry.description}</p> : null}
            <p>Event ID: {entry.eventId}</p>
            {link ? <a href={link} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a> : null}
          </details>
        </li>;
      })}</ul>
    </section>)}
  </section>;
}
```

Date-only arithmetic deliberately uses UTC calendar dates, never the browser's local timezone. Timed intervals use an explicit zone at both ends, including DST abbreviations. Do not expand an event into one DOM row per covered date: get-event can return long multi-day spans, and duplicating is neither needed nor bounded by the 20-entry limit. Timed sorting compares instants, not offset-string lexical order.

Native `<details>/<summary>` supplies keyboard behavior and expanded/collapsed semantics without a second UI state store or redundant `aria-expanded` that could drift. No HTML/Markdown injection for descriptions. Never invent attendees or local-time conversions for missing zones; fallback UTC is explicitly labelled, not a claim that it was the requested zone.

- [ ] **Step 4: Implement the structured switch and review card** in `calendar-view-renderer.tsx`, after its header:

```tsx
import {Component,useEffect,useState,type ReactNode} from 'react';
import type {CalendarView} from '../../../api/calendar-protocol.ts';
import type {CalendarConfirmPayload} from '../../../api/voice-protocol.ts';
import {describeCalendarProgress,describeOperationState,describeCalendarRetryAction,
  resolveReceiptCalendarLabel,resolveSafeReceiptLink} from '../../plugins/google-calendar/CalendarTurnRegion.tsx';
import type {CalendarWorkspace} from '../calendar-workspace.ts';
import {CalendarAgendaView,calendarInterval} from './calendar-agenda-view.tsx';
type Proposal=Extract<CalendarView,{kind:'proposal'}>;
type Answer=CalendarConfirmPayload['answer'];
export function CalendarProposalReviewCard({view,nowMs=Date.now(),interactive=false,disabled=false,onAnswer,context='history'}:{
  view:Proposal;nowMs?:number;interactive?:boolean;disabled?:boolean;onAnswer?:(answer:Answer)=>void;context?:'history'|'requested'}) {
  const expired=Date.parse(view.expiresAt)<=nowMs;
  const controls=interactive && !expired && Boolean(onAnswer);
  const target=view.target;
  const label=!expired && target?.labelExpiresAt && Date.parse(target.labelExpiresAt)>nowMs ? target.calendarLabel : null;
  const reason={target:'Choose a calendar',details:'Review this event',conflict:'This time conflicts with another event',coverage:'Availability coverage is incomplete'}[view.reason];
  return <section className="aurvin-calendar-review" aria-label="Review Calendar request">
    <h2>{context === 'requested' ? 'Requested event' : reason}</h2><p>{expired ?
      (context === 'requested' ? 'The original proposal expired; this does not change the reported outcome.' : 'Request expired. Ask Aurvin again.') : interactive ? 'Awaiting your confirmation.' :
      context === 'requested' ? 'This is the request being processed, not confirmation of creation.' : 'Historical snapshot — this card cannot authorize a write.'}</p>
    {view.action ? <><h3>{view.action.summary}</h3>
      <p>{calendarInterval({...view.action,allDay:false},view.action.timeZone)}</p><p>Time zone: {view.action.timeZone}</p>
      {view.action.location ? <p>Location: {view.action.location}</p> : null}
      {view.action.description ? <p className="aurvin-calendar-description">{view.action.description}</p> : null}
      <p>Creates one event. No invitations will be sent.</p></> : <p>More details are needed before an event can be created.</p>}
    {target ? <p>Calendar: {label ? `${label} · ` : ''}{target.calendarId}</p> : null}
    <p>Request expires: <time dateTime={view.expiresAt}>{view.expiresAt}</time></p>
    {view.candidates.length ? <ul>{view.candidates.map(c=><li key={c.calendarId}>
      {controls ? <button type="button" disabled={disabled} onClick={()=>onAnswer?.({kind:'select',calendarId:c.calendarId})}>
        Choose {c.label}</button> : <span>{expired ? c.calendarId : c.label}</span>}
      <span> · {c.role}</span></li>)}</ul> : null}
    {controls ? <div className="aurvin-calendar-card-actions" role="group" aria-label="Calendar request confirmation">
      <button className="aurvin-calendar-cancel-btn" type="button" disabled={disabled} onClick={()=>onAnswer?.({kind:'reject'})}>Cancel request</button>
      {view.reason !== 'target' && view.action && target ? <button className="aurvin-calendar-confirm-btn" type="button" disabled={disabled}
        onClick={()=>onAnswer?.({kind:'accept'})}>Confirm event</button> : null}
    </div> : null}
  </section>;
}
function expiryDeadlines(view:CalendarView|null):number[] {
  if (!view) return [];
  const deadlines:string[]=[];
  if ('expiresAt' in view) deadlines.push(view.expiresAt);
  if ((view.kind === 'agenda' || view.kind === 'proposal') && view.target?.labelExpiresAt) deadlines.push(view.target.labelExpiresAt);
  if (view.kind === 'outcome' && view.receipt?.expiresAt) deadlines.push(view.receipt.expiresAt);
  return deadlines.map(Date.parse).filter(Number.isFinite);
}
export function CalendarViewRenderer({view,workspace,nowMs:testNow,disabled=false,onAnswer}:{
  view:CalendarView|null;workspace?:CalendarWorkspace;nowMs?:number;disabled?:boolean;onAnswer?:(answer:Answer)=>void}) {
  const [clock,setClock]=useState(()=>Date.now());const nowMs=testNow ?? Math.max(clock,Date.now());
  useEffect(()=>{
    if (testNow !== undefined) return;
    const next=expiryDeadlines(view).filter(t=>t>Date.now()).sort((a,b)=>a-b)[0];
    if (next === undefined) return;
    const timer=setTimeout(()=>setClock(Date.now()),Math.min(2_147_483_647,Math.max(1,next-Date.now())));
    return ()=>clearTimeout(timer);
  },[view,clock,testNow]);
  const progress=workspace?.phase;
  let body:ReactNode=null;
  if (view?.kind === 'agenda') body=<CalendarAgendaView view={view} nowMs={nowMs}/>;
  else if (view?.kind === 'proposal') body=<CalendarProposalReviewCard view={view} nowMs={nowMs}
    interactive={workspace?.interactive} disabled={disabled || workspace?.pending} onAnswer={onAnswer}/>;
  else if (view?.kind === 'outcome') {
    const label=resolveReceiptCalendarLabel(view.receipt,nowMs);const link=resolveSafeReceiptLink(view.receipt,nowMs);
    const heading=['planned','dispatching'].includes(view.state) ? 'Creating Calendar event…' : describeOperationState(view.state);
    body=<section className="aurvin-calendar-outcome" data-calendar-state={view.state} aria-label="Calendar outcome">
      <h2>{heading}</h2>{view.receipt ? <p>Event ID: {view.receipt.eventId}</p> : null}
      {label ? <p>Calendar: {label}</p> : null}
      {link ? <a href={link} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a> : null}
      {view.state === 'unknown' ? <p>Do not repeat this write. Check the Calendar outcome before sending a new request.</p> : null}
      <p>{describeCalendarRetryAction(view.retryAction).explanation}</p>
    </section>;
  } else if (view?.kind === 'notice') body=<section className="aurvin-calendar-notice" data-calendar-state={view.state} aria-label="Calendar update">
    <h2>Calendar update</h2><p>{view.message}</p>
    {view.coverage === 'incomplete' ? <p>Coverage is incomplete.</p> : null}
    {view.conflict ? <p>Availability: {view.conflict}.</p> : null}
    {view.limitations.length ? <p>Limitations: {view.limitations.join(', ')}.</p> : null}
  </section>;
  return <div className="aurvin-calendar-workspace">
    <p role="status" aria-live="polite" aria-atomic="true">{progress ? describeCalendarProgress(progress) :
      workspace?.pending ? 'Confirmation sent. Waiting for the actual outcome.' : 'Calendar result'}</p>
    {workspace?.proposal && view?.kind === 'outcome' ?
      <CalendarProposalReviewCard view={workspace.proposal} nowMs={nowMs} context="requested"/> : null}
    {body}
  </div>;
}
type BoundaryProps={children:ReactNode;value:CalendarView|null};
type BoundaryState={failed:boolean;value:CalendarView|null};
export class CalendarViewBoundary extends Component<BoundaryProps,BoundaryState> {
  constructor(props:BoundaryProps){super(props);this.state={failed:false,value:props.value};}
  static getDerivedStateFromError(){return {failed:true};}
  static getDerivedStateFromProps(props:BoundaryProps,state:BoundaryState){
    return props.value !== state.value ? {failed:false,value:props.value} : null;
  }
  render(){return this.state.failed ? <p role="status">Calendar display is unavailable. Voice and chat can continue.</p> : this.props.children;}
}
```

Wrap only the Calendar visual body with this boundary in Task 7; its key is the stable artifact ID and its value prop resets failure on a genuinely new snapshot. Do not use a random key or one that remounts the view on every audio state change. No error logger may record view payloads/descriptions. The boundary does not catch event handlers/async callbacks; controller/control handlers already catch their own failures.

For pending confirmation/execution, `workspace.proposal` remains visible above the outcome as “Requested event”, not as new authorization. Keep announcements concise and semantically stable, not the entire agenda marked aria-live.

- [ ] **Step 5: Add exact button callback and missing-field checks.** Calling the pure proposal component directly returns an element tree; traverse it without a DOM:

```ts
import {isValidElement,type ReactNode} from 'react';
function buttons(node:ReactNode):Array<{children?:ReactNode;onClick?:()=>void;disabled?:boolean}> {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{children?:ReactNode;onClick?:()=>void;disabled?:boolean}>(node)) return [];
  return [...(node.type === 'button' ? [node.props] : []),...buttons(node.props.children)];
}
it('uses the canonical candidate ID and never approves an incomplete target request',()=>{
  const onAnswer=vi.fn();const view={...proposal(),reason:'target' as const,target:null,
    candidates:[{calendarId:'team@example.com',label:'Shared label',role:'writer' as const}]};
  const controls=buttons(CalendarProposalReviewCard({view,nowMs:NOW,interactive:true,onAnswer}));
  expect(controls.some(p=>p.children === 'Confirm event')).toBe(false);
  controls.find(p=>Array.isArray(p.children) && p.children.includes('Shared label'))!.onClick!();
  expect(onAnswer).toHaveBeenCalledWith({kind:'select',calendarId:'team@example.com'});
});
```

Extend agenda tests with requested:null/missing description/location and cancelled/tentative status; assert absent fields stay absent rather than showing invented “busy”/participants. Extend outcome test with succeeded/unexpired vs expired link/label. Verification (frontend/): `npm test -- src/features/canvas/renderers/calendar-agenda-view.test.ts src/features/canvas/renderers/calendar-view-renderer.test.ts`, then `npm run build`. Expected PASS. Timer/focus behavior remains a P3 interaction check, not an SSR claim.
- [ ] **Step 6: Commit:**

```bash
git add frontend/src/features/canvas/renderers/calendar-agenda-view.tsx frontend/src/features/canvas/renderers/calendar-agenda-view.test.ts frontend/src/features/canvas/renderers/calendar-view-renderer.tsx frontend/src/features/canvas/renderers/calendar-view-renderer.test.ts
git commit -m "feat(canvas): render accessible Calendar agendas reviews and outcomes"
```

## Task 7: Give Calendar an ordinary, responsive Canvas mode

**Files:** `frontend/src/features/canvas/CanvasPanel.tsx`, `calendar-canvas.test.ts`, `frontend/src/styles/chat.css`, `frontend/src/styles/styles.test.ts`.

- [ ] **Step 1: Append this failing SSR test** to `calendar-canvas.test.ts`:

```ts
it('renders Calendar without diagram controls and retains diagram zoom unchanged',()=>{
  const artifact=calendarViewArtifact(agenda(),'m','t');
  const props={activeArtifactId:artifact.artifactId,onSelectArtifact:()=>{},onCloseTab:()=>{},onClosePanel:()=>{}};
  const html=renderToStaticMarkup(createElement(CanvasPanel,{...props,artifacts:[artifact]}));
  expect(html).toContain('aurvin-canvas-calendar-body');expect(html).toContain('Design sync');
  expect(html).not.toContain('aria-label="Zoom controls"');expect(html).not.toContain('Canvas view mode');
  expect(html).not.toContain('aurvin-canvas-stage');expect(html).not.toContain('scale(');
  const diagram=parseCanvasCodeBlock('mermaid','flowchart LR\n A-->B','m-diagram',0)!;
  const original=renderToStaticMarkup(createElement(CanvasPanel,{...props,artifacts:[diagram],activeArtifactId:diagram.artifactId}));
  expect(original).toContain('aria-label="Zoom controls"');expect(original).toContain('aurvin-canvas-stage');
});
```

- [ ] **Step 2: Run (frontend/):** `npm test -- src/features/canvas/calendar-canvas.test.ts -t "without diagram controls"`. Expected RED: current Calendar is inside zoom/pan stage.
- [ ] **Step 3: Minimal CanvasPanel edit.** Resolve active artifacts using `matchesCalendarArtifact(a,activeArtifactId)`. Add `onCalendarAnswer?:(proposalId:string,revision:number,answer:CalendarConfirmPayload['answer'])=>void` and `calendarControlsDisabled?:boolean`. Compute `const calendarMode=activeArtifact?.kind === 'calendar'` before effects. Native wheel-prevention effect returns early for calendarMode and includes it in dependencies. Wrap existing preview/code, zoom, copy, and download groups in `!calendarMode`; preserve window/tab controls.

Build this `calendarBody` local after the active-artifact null check and before the return:

```tsx
const calendarBody=<div className="aurvin-canvas-calendar-body" role="region" aria-label="Calendar workspace">
  {activeArtifact.calendarView || activeArtifact.calendarWorkspace ?
    <CalendarViewBoundary key={activeArtifact.artifactId} value={activeArtifact.calendarWorkspace?.view ?? activeArtifact.calendarView ?? null}>
      <CalendarViewRenderer view={activeArtifact.calendarWorkspace?.view ?? activeArtifact.calendarView ?? null}
        workspace={activeArtifact.calendarWorkspace} disabled={calendarControlsDisabled}
        onAnswer={activeArtifact.calendarWorkspace?.view?.kind === 'proposal' && onCalendarAnswer ? answer=>{
          const view=activeArtifact.calendarWorkspace!.view!;
          if (view.kind === 'proposal') onCalendarAnswer(view.proposalId,view.revision,answer);
        } : undefined}/>
    </CalendarViewBoundary> : <CalendarEventRenderer source={activeArtifact.rawSource} title={activeArtifact.title}/>}
</div>;
```

In the body expression, replace the exact opening `{viewMode === 'code' ? (` with `{calendarMode ? calendarBody : viewMode === 'code' ? (`; keep the existing code-view and diagram-viewport subtrees unchanged. Existing legacy CalendarEventRenderer stays only on the legacy source branch and is never fed a structured lookup/proposal. Keep its old output/tests; this task does not certify model-authored legacy cards as write evidence.

Boundary recovery already compares snapshot object identity, without remounting every tick or expensive stringify keys. Add this pure class-state test to the renderer test (it is not a browser thrown-render test):

```ts
it('resets a contained visual failure only for a new snapshot',()=>{
  const view=agenda();
  const state={value:view,failed:true};
  expect(CalendarViewBoundary.getDerivedStateFromProps({value:view,children:null},state)).toBeNull();
  expect(CalendarViewBoundary.getDerivedStateFromProps({value:outcome(),children:null},state)).toMatchObject({failed:false});
});
```

Append CSS scoped to calendar mode, reusing existing tokens/buttons (do not give Calendar the `touch-action:none`/grab background):

```css
.aurvin-canvas-calendar-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 1.25rem;
  color: var(--aurvin-text-primary); background: var(--aurvin-bg); touch-action: pan-y; user-select: text; }
.aurvin-calendar-workspace { width: 100%; max-width: 48rem; margin-inline: auto; }
.aurvin-calendar-workspace h2 { margin: 0 0 .75rem; font-size: 1.25rem; }
.aurvin-calendar-workspace p { overflow-wrap: anywhere; }
.aurvin-calendar-day { display: grid; grid-template-columns: 7rem minmax(0,1fr); gap: 1rem; margin-block: 1.5rem; }
.aurvin-calendar-day h3 { margin: .75rem 0; font-size: .95rem; color: var(--aurvin-text-secondary); }
.aurvin-calendar-day ul { list-style: none; padding: 0; margin: 0; min-width: 0; }
.aurvin-calendar-agenda-entry { padding: 1rem; border-radius: .75rem; background: var(--aurvin-surface-elevated); margin-bottom: .75rem; }
.aurvin-calendar-agenda-entry h4 { font-size: 1rem; margin: 0 0 .5rem; overflow-wrap: anywhere; }
.aurvin-calendar-agenda-entry summary { cursor: pointer; padding-block: .5rem; overflow-wrap: anywhere; }
.aurvin-calendar-description { white-space: pre-wrap; overflow-wrap: anywhere; }
.aurvin-calendar-review,.aurvin-calendar-outcome,.aurvin-calendar-notice { padding: 1rem; border-radius: .75rem; background: var(--aurvin-surface-elevated); }
.aurvin-calendar-caption { color: var(--aurvin-text-secondary); font-size: .875rem; }
.aurvin-calendar-workspace :is(button,a,summary):focus-visible { outline: 2px solid var(--aurvin-text-primary); outline-offset: 3px; }
.aurvin-calendar-workspace .aurvin-calendar-card-actions { flex-wrap: wrap; gap: .75rem; }
.aurvin-calendar-workspace button { min-height: 2.75rem; }
@media (max-width: 600px) {
  .aurvin-canvas-calendar-body { padding: .875rem; }
  .aurvin-calendar-day { grid-template-columns: minmax(0,1fr); gap: .25rem; }
  .aurvin-calendar-workspace .aurvin-calendar-card-actions > button { flex: 1 1 10rem; }
}
```

No new animation is necessary. Existing Canvas shell has reduced-motion behavior; retain it, do not wait for `transitionend`. Extend `styles.test.ts` with assertions that the calendar body scrolls, is selectable, has mobile stacking/focus styles, and no calendar-specific keyframes/transform/touch-action:none were introduced. These source checks supplement, not replace, P3 browser evidence.

- [ ] **Step 4: Verify (frontend/):** `npm test -- src/features/canvas/calendar-canvas.test.ts src/features/canvas/canvas.test.ts src/styles/styles.test.ts`. Expected PASS; diagram controls, exiting/inert state, and existing reduced-motion tests remain passing.
- [ ] **Step 5: Commit:**

```bash
git add frontend/src/features/canvas/CanvasPanel.tsx frontend/src/features/canvas/calendar-canvas.test.ts frontend/src/features/canvas/renderers/calendar-view-renderer.tsx frontend/src/features/canvas/renderers/calendar-view-renderer.test.ts frontend/src/styles/chat.css frontend/src/styles/styles.test.ts
git commit -m "feat(canvas): use a scrollable responsive Calendar panel without pan or zoom"
```

## Task 8: Add explicit text entry points and preserve voice-history reachability

**Files:** `frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx`, `calendar-turn-region.test.ts`; `frontend/src/components/group-voice-messages.ts`, `group-voice-messages.test.ts`, `VoiceTranscriptModal.tsx`, `VoiceTranscriptModal.test.ts`.

- [ ] **Step 1: Append a failing manual-entry test** in `calendar-turn-region.test.ts`, importing `agenda`, `NOW`, `calendarViewArtifact`, `CanvasArtifactCard`, and `isValidElement`:

```ts
it('keeps lookup facts inline and opens Calendar only from an explicit Canvas click',()=>{
  const result=calendarViewArtifact(agenda(),'assistant-1','turn-1');const open=vi.fn();
  const props={progress:null,operations:[],disabled:false,onRetryTurn:vi.fn(),results:[result],onOpenCanvas:open,nowMs:NOW};
  const html=renderToStaticMarkup(createElement(CalendarTurnView,props));
  expect(html).toContain('Design sync');expect(html).toContain('View agenda in Canvas');
  expect(open).not.toHaveBeenCalled();
  const tree=CalendarTurnView(props);
  function findCard(node:unknown):{artifact:typeof result;onOpen:(id:string)=>void}|null {
    if (Array.isArray(node)) {for (const n of node) {const found=findCard(n);if (found) return found;}return null;}
    if (!isValidElement<{children?:unknown;artifact:typeof result;onOpen:(id:string)=>void}>(node)) return null;
    return node.type === CanvasArtifactCard ? node.props : findCard(node.props.children);
  }
  const card=findCard(tree)!;card.onOpen(card.artifact.artifactId);
  expect(open).toHaveBeenCalledExactlyOnceWith(result.artifactId);
});
```

Append history test in `group-voice-messages.test.ts` (import `calendarMessage`, `agenda`, `NOW`, `VoiceTranscriptModal`, React createElement/renderToStaticMarkup):

```ts
it('preserves Calendar snapshots with original message identity inside the voice transcript',()=>{
  const grouped=groupVoiceMessages([calendarMessage(agenda(),'live')]);
  expect(grouped).toHaveLength(1);
  expect(grouped[0].voiceTranscripts?.[0]).toMatchObject({messageId:'assistant-1',turnId:'turn-1',calendarView:agenda()});
  const html=renderToStaticMarkup(createElement(VoiceTranscriptModal,{transcripts:grouped[0].voiceTranscripts!,onClose:()=>{}}));
  expect(html).toContain('View agenda in Canvas');
  expect(html).not.toContain('Confirm event');
});
```

- [ ] **Step 2: Run (frontend/):** `npm test -- src/features/plugins/google-calendar/calendar-turn-region.test.ts src/components/group-voice-messages.test.ts`. Expected RED: no result button / grouped snapshot lost.
- [ ] **Step 3: Minimal CalendarTurnView integration.** Add `results?:readonly CanvasArtifact[]` (default `[]`) and `onOpenCanvas?:(artifactId:string)=>void` props. Include `results.length` in the existing null-return check, then render the data before operation cards:

```tsx
{results.map(artifact=><div key={artifact.artifactId}>
  {artifact.calendarView?.kind === 'agenda' ? <CalendarAgendaView view={artifact.calendarView} nowMs={nowMs}/> : null}
  <CanvasArtifactCard artifact={artifact} onOpen={onOpenCanvas}/>
</div>)}
```

In CalendarTurnRegion, include `dispatch` from useChat. Use `useMemo` for the message/view collection (not per keystroke parsing):

```ts
const results=useMemo(()=>{
  const persisted=collectSessionCanvasArtifacts(state.messages,'',false,state.calendarOperationsByTurn)
    .filter(a=>a.kind === 'calendar');
  const turns=new Set(persisted.map(a=>a.turnId).filter(Boolean));
  return [...persisted,...Object.entries(state.calendarViewsByTurn).filter(([id])=>!turns.has(id))
    .map(([id,view])=>calendarViewArtifact(view,id,id))];
},[state.messages,state.calendarOperationsByTurn,state.calendarViewsByTurn]);
// Add CalendarTurnView props:
results={results}
onOpenCanvas={artifactId=>dispatch({type:'OPEN_CANVAS_ARTIFACT',payload:{artifactId}})}
```

Do not show post-call live messages' Calendar entries again at the bottom of text chat: filter persisted entries to message turns with `mode !== 'live'` / no voiceSessionId. Voice results stay inside their transcript window and the ordinary Canvas toggle. Include active streamed views only from the scoped text map.

For structured current clarification, use the exact canonical view rather than parsing `event.message`; render this branch **before** the legacy parsed/fallback branches:

```tsx
<CalendarProposalReviewCard view={clarification.event.view} nowMs={nowMs}
  interactive={Boolean(onConfirmReply) && !isExpired} disabled={composerReplyDisabled}
  onAnswer={answer=>onConfirmReply?.(answer.kind === 'accept' ? 'yes' : answer.kind === 'reject' ? 'cancel' : answer.calendarId)}/>
```

The branch condition is `clarification.event.view !== undefined`; old events keep the legacy renderer. `CalendarTurnRegion` still calls `actions.submitMessage(content,{hideFromTranscript:true})`, and use-chat still attaches its current `calendarReplyTo`. Do not call liveVoice controls from text, manufacture approval by opening Canvas, or convert historical proposal messages into current clarification. For target choices, use calendarId, not a potentially duplicate candidate label. Add proposal view expiry, target-label expiry, agenda expiry, and outcome-receipt expiry to the **existing one-shot deadline list**, not a new interval, so inline link/label controls expire while idle.

In `group-voice-messages.ts`, extend `collectGroupTranscripts`'s existing spread logic with these fields for assistant items (never user items):

```ts
...(t.role === 'assistant' && (t.calendarView ?? msg.calendarView)
  ? {calendarView:t.calendarView ?? msg.calendarView,messageId:t.messageId ?? msg.messageId,turnId:t.turnId ?? msg.turnId} : {})
```

Also admit `msg.calendarView` in the fallback `else if (msg.content || msg.canvasArtifacts?.length)` condition and copy `{calendarView:msg.calendarView,messageId:msg.messageId,turnId:msg.turnId}` there for assistant messages. Preserve all existing voice durations, call pill grouping, transcript ordering, artifact projections, and main-transcript privacy.

In `VoiceTranscriptModal.tsx`, after its existing projection conversion, append the structured calendar artifact **only** for assistant snapshots with valid view and original messageId/turnId:

```ts
if (item.role === 'assistant' && item.calendarView && item.messageId && item.turnId && isCalendarView(item.calendarView)) {
  itemArtifacts.push(calendarViewArtifact(item.calendarView,item.messageId,item.turnId));
}
```

Use the existing CanvasArtifactCard/open/close-modal path; no automatic opening or confirmation callback. Original message IDs match Task 5's session artifact IDs. Do not synthesize authorization or a missing original identity from array index.

- [ ] **Step 4: Verify actual hidden-reply reference behavior** by adding to the existing `calendar-turn-region.test.ts` callback tests: current structured target choice sends `'team@example.com'`, accept sends `'yes'`, reject sends `'cancel'`, and expired view has no enabled controls; historical results alone do not call submit. Verify (frontend/): `npm test -- src/features/plugins/google-calendar/calendar-turn-region.test.ts src/features/chat/state/calendar-chat-state.test.ts src/components/group-voice-messages.test.ts src/components/VoiceTranscriptModal.test.ts src/components/MessageItem.test.ts`. Expected PASS. Preserve the existing text interaction rather than creating a second confirmation modal.
- [ ] **Step 5: Commit:**

```bash
git add frontend/src/features/plugins/google-calendar/CalendarTurnRegion.tsx frontend/src/features/plugins/google-calendar/calendar-turn-region.test.ts frontend/src/components/group-voice-messages.ts frontend/src/components/group-voice-messages.test.ts frontend/src/components/VoiceTranscriptModal.tsx frontend/src/components/VoiceTranscriptModal.test.ts
git commit -m "feat(calendar-ui): add manual text Canvas entry and archived voice snapshots"
```

## Task 9: Switch ChatView to voice-only automatic Calendar presentation

**Files:** `frontend/src/features/chat/ChatView.tsx`, `ChatView.voice.test.ts`; `frontend/src/features/canvas/calendar-workspace.ts`, `calendar-workspace.test.ts`, `calendar-canvas.test.ts`, `index.ts`.

- [ ] **Step 1: Add exact policy tests** in `calendar-workspace.test.ts`:

```ts
import {claimCalendarAutoOpenId,mergeCalendarWorkspaces} from './calendar-workspace.ts';
it('opens only new live requests and respects dismissal through ordinary updates',()=>{
  const seen=new Set<string>();
  const workspaces=foldCalendarFrame([],frame({type:'calendar-progress',phase:'executing'}));
  const artifacts=mergeCalendarWorkspaces([],workspaces,true);
  const input={live:true,conversationId:'chat-1',selectedId:'chat-1',workspaces,artifacts,seen};
  expect(claimCalendarAutoOpenId({...input,live:false})).toBeNull();
  expect(seen.size).toBe(0);
  expect(claimCalendarAutoOpenId({...input,selectedId:'another'})).toBeNull();
  expect(claimCalendarAutoOpenId(input)).toBe('calendar:turn-1::canvas::calendar');
  // Closing Canvas is just CLOSE_CANVAS; seen identities intentionally remain claimed.
  expect(claimCalendarAutoOpenId(input)).toBeNull();
  const updated=foldCalendarFrame(workspaces,frame({type:'calendar-view',view:proposal()}));
  expect(claimCalendarAutoOpenId({...input,workspaces:updated,artifacts:mergeCalendarWorkspaces([],updated,true)})).toBeNull();
  const next=foldCalendarFrame(updated,frame({type:'calendar-view',view:{...proposal(),proposalId:'p2',intentId:'i2'}},'turn-2'));
  expect(claimCalendarAutoOpenId({...input,workspaces:next,artifacts:mergeCalendarWorkspaces([],next,true)})).toBe('calendar:turn-2::canvas::calendar');
});
```

Add failing ChatView SSR cases to `ChatView.voice.test.ts` (import fixtures and fold helper). These assert composition, not effects:

```ts
it('renders a loading Calendar workspace beside live voice without mounting transcript/composer',()=>{
  context.state={...initialChatState,activeSessionId:'chat-1',canvasOpen:true,activeCanvasArtifactId:'calendar:turn-1::canvas::calendar'};
  const workspace=foldCalendarFrame([],{type:'calendar.frame',turnId:'turn-1',attemptId:'a',responseId:'r',
    event:{type:'calendar-progress',phase:'executing'}});
  const surface={...voice('active'),view:{...voice('active').view,conversationId:'chat-1',calendarWorkspaces:workspace}};
  const html=renderToStaticMarkup(createElement(ChatView,{liveVoice:surface}));
  expect(html).toContain('Running Calendar action');expect(html).toContain('Close Canvas (1)');
  expect(html).not.toContain('<textarea');expect(html).not.toContain('aurvin-transcript');
});
it('does not mount a Calendar workspace belonging to another conversation',()=>{
  context.state={...initialChatState,activeSessionId:'chat-2',canvasOpen:true};
  const surface={...voice('active'),view:{...voice('active').view,conversationId:'chat-1',
    calendarWorkspaces:foldCalendarFrame([],{type:'calendar.frame',turnId:'turn-1',attemptId:'a',responseId:'r',event:{type:'calendar-view',view:agenda()}})}};
  const html=renderToStaticMarkup(createElement(ChatView,{liveVoice:surface}));
  expect(html).not.toContain('Design sync');expect(html).not.toContain('id="aurvin-canvas-panel"');
});
```

- [ ] **Step 2: Run (frontend/):** `npm test -- src/features/canvas/calendar-workspace.test.ts src/features/chat/ChatView.voice.test.ts`. Expected RED: missing policy helper / no Calendar workspace in ChatView.
- [ ] **Step 3: Implement this opening policy helper** and export it:

```ts
export function claimCalendarAutoOpenId({live,conversationId,selectedId,workspaces,artifacts,seen}:{
  live:boolean;conversationId:string|null;selectedId:string|null;workspaces:readonly CalendarWorkspace[];
  artifacts:readonly CanvasArtifact[];seen:Set<string>}):string|null {
  if (!live || !conversationId || conversationId !== selectedId) return null;
  let newest:string|null=null;
  for (const workspace of workspaces) {
    if (seen.has(workspace.id)) continue;
    const artifact=artifacts.find(a=>matchesCalendarArtifact(a,`${workspace.id}::canvas::calendar`));
    if (!artifact) continue;
    seen.add(workspace.id);newest=artifact.artifactId;
  }
  return newest;
}
```

In ChatView:

1. Delete the entire existing text Calendar auto-open block (current lines 178–211) and its `seenCalendarArtifactIdsRef` plumbing/seeding. Preserve `claimNewAutoOpenArtifactId(liveProjections,seenLiveArtifactIdsRef.current)` and unrelated live artifact behavior.
2. Add `seenVoiceCalendarIdsRef=useRef(new Set<string>())`. Reset it only on real session navigation/new chat/new voice run, **not** on frame updates, panel/tab dismissal, reconnect, hydration, mode exit, or binding a previously unsaved same call to its first conversation. In the existing session-change layout effect's `!sameCallBinding` branch, clear this new ref; in startNewChat clear it with seenLiveArtifactIdsRef. Track `previousVoicePhaseRef` and clear once on entry into `requesting_permission` (the START phase), never on reconnect's connecting/suspended phases. Navigation already exits the voice lease; retain the explicit comparison to avoid seeding another session.
3. Get matching workspaces only if both conversationId and activeSessionId are non-null and equal. Merge after the existing text/live artifact collection. Append active text views (Task 5) without auto-opening them. Replace textArtifacts' useMemo body with:

```ts
const base=collectSessionCanvasArtifacts(state.messages,state.streamText,state.isStreaming,
  state.calendarOperationsByTurn,archivedArtifacts);
const persistedTurns=new Set(base.filter(a=>a.calendarView).map(a=>a.turnId));
const active=Object.entries(state.calendarViewsByTurn).filter(([turnId])=>!persistedTurns.has(turnId))
  .map(([turnId,view])=>calendarViewArtifact(view,turnId,turnId));
const structuredTurns=new Set(active.map(a=>a.turnId));
return [...base.filter(a=>!(a.kind === 'calendar' && !a.calendarView && structuredTurns.has(a.turnId))),...active];
```

Add `state.calendarViewsByTurn` to that memo's dependencies. Do not leave legacy receipt synthesis and a structured active view as two tabs for the same turn.

```ts
const calendarWorkspaces=liveVoice?.view.conversationId && liveVoice.view.conversationId === state.activeSessionId
  ? liveVoice.view.calendarWorkspaces : [];
const sessionArtifacts=useMemo(()=>mergeCalendarWorkspaces(
  mergeSessionCanvasArtifacts(textArtifacts,liveProjections,state.calendarOperationsByTurn),
  calendarWorkspaces,includeLiveArtifacts),[textArtifacts,liveProjections,state.calendarOperationsByTurn,calendarWorkspaces,includeLiveArtifacts]);
useEffect(()=>{
  const id=claimCalendarAutoOpenId({live:liveActive,conversationId:liveVoice?.view.conversationId ?? null,
    selectedId:state.activeSessionId,workspaces:calendarWorkspaces,artifacts:sessionArtifacts,seen:seenVoiceCalendarIdsRef.current});
  if (id) dispatch({type:'OPEN_CANVAS_ARTIFACT',payload:{artifactId:id}});
},[liveActive,liveVoice?.view.conversationId,state.activeSessionId,calendarWorkspaces,sessionArtifacts,dispatch]);
```

Keep the `[]` fallback referentially stable with a file-level `const EMPTY_CALENDAR_WORKSPACES:readonly CalendarWorkspace[]=[]` to avoid a pointless new dependency on every render. Use an ordinary effect for new automatic presentation, not a layout measurement or an awaited animation. Existing media components/controllers must remain mounted in place.

4. Alias-aware selection/filtering is required when hydration changes canonical IDs. Replace the closed-tab filter's predicate with:

```ts
(state.canvasOpen && matchesCalendarArtifact(a,state.activeCanvasArtifactId)) ||
  !state.closedCanvasArtifactIds.some(id=>matchesCalendarArtifact(a,id))
```

Keep its existing “if every tab is closed, manual toggle can reopen” fallback. Use `matchesCalendarArtifact` for header toggle's hasOpenActive check and CanvasPanel's active-artifact lookup. Ordinary updates keep the same workspace ID and do not remove a closed-tab mark. Explicit user click/header/Alt+C may reopen it.

5. Pass `calendarControlsDisabled={Boolean(!liveActive || liveVoice?.view.agent === 'thinking' || liveVoice?.view.inputBusy || liveVoice?.view.connection !== 'connected')}` to CanvasPanel. Route `onCalendarAnswer={(id,revision,answer)=>{ liveVoice?.confirmCalendar?.(id,revision,answer); }}` only while matching live conversation and not exiting. During an exiting animation render every proposal read-only; stale captured exit snapshots must not authorize a click. Controller checks remain the final client-side fence.
6. Closing the panel/tab only performs its existing Canvas dispatch and focus restore. Do not call voice exit/interrupt/toggleMute or send reject. Do not focus a proposal automatically: auto-open must not steal focus from LiveVoicePanel. Manual users can tab to review controls; existing close restoration uses the live Canvas toggle/composer as appropriate.

- [ ] **Step 4: Replace misleading legacy test labels, not working manual behavior.** Rename `calendar-canvas.test.ts`'s “Canvas Auto-Open on Event Completion” suite to “Manual Calendar Canvas opening”; its OPEN_CANVAS_ARTIFACT reducer test is a manual-open test, not evidence of an effect. Keep that test and add this actual state assertion:

```ts
it('never opens text Calendar from progress, operation, view or completed snapshot actions',()=>{
  const active={...initialChatState,activeSessionId:'s',activeTurnId:'t',activeAttemptId:'a',isStreaming:true};
  const payload={sessionId:'s',turnId:'t',attemptId:'a',sequence:1};
  let state=chatReducer(active,{type:'CALENDAR_PROGRESS',payload:{...payload,phase:'executing'}});
  state=chatReducer(state,{type:'CALENDAR_VIEW',payload:{...payload,sequence:2,view:agenda()}});
  const o=outcome();
  state=chatReducer(state,{type:'CALENDAR_OPERATION',payload:{...payload,sequence:3,operation:{schemaVersion:2,
    operationId:o.operationId,proposalId:o.proposalId,intentId:o.intentId,state:o.state,narration:'completed',retryAction:o.retryAction,receipt:o.receipt}}});
  state=chatReducer(state,{type:'STREAM_COMPLETED',payload:{assistantMessageId:'m',outcome:'completed',calendarView:o}});
  expect(state.canvasOpen).toBe(false);
});
```

Keep existing non-calendar ChatView/Canvas/live-controller suites. Add test cases for CLOSE_CANVAS_TAB followed by same-workspace frames, manual reopen, alias selection after hydration, mode exit while reload is pending/settled, and navigation followed by old frames. P3 owns the actual browser effect/focus/transport integration checks.

- [ ] **Step 5: Verify (frontend/):** `npm test -- src/features/chat/ChatView.voice.test.ts src/features/chat/ChatView.test.ts src/features/canvas/calendar-workspace.test.ts src/features/canvas/calendar-canvas.test.ts src/features/voice/state/live-voice-controller.test.ts`, then `npm run build` and `npm run lint`. Expected PASS without changed media lifetime or text auto-opening.
- [ ] **Step 6: Commit:**

```bash
git add frontend/src/features/chat/ChatView.tsx frontend/src/features/chat/ChatView.voice.test.ts frontend/src/features/canvas/calendar-workspace.ts frontend/src/features/canvas/calendar-workspace.test.ts frontend/src/features/canvas/calendar-canvas.test.ts frontend/src/features/canvas/index.ts
git commit -m "feat(calendar-ui): auto-open voice workspaces and keep text Calendar manual"
```

## Required edge-case checks (insert in the owning tasks before their green check)

These are concrete extensions to the tests above, not a separate implementation task. Merge imports into each test file's existing import declarations. Keep tests deterministic and run each owning task's focused command after inserting them.

**Task 1 — `frontend/src/api/calendar-protocol.test.ts`:**

```ts
it('accepts P1 optional references and distinguishes invalid data from absent optional facts',()=>{
  const p=proposal();
  const clarification={type:'calendar-clarification',proposalId:p.proposalId,proposalRevision:p.revision,
    expiresAt:p.expiresAt,reason:p.reason,message:'Review the event.',candidates:[],view:p};
  expect(isCalendarPresentationEvent(clarification)).toBe(true);
  const o=outcome();
  expect(isCalendarPresentationEvent({type:'calendar-operation',operation:{schemaVersion:2,operationId:o.operationId,
    proposalId:o.proposalId,intentId:o.intentId,state:o.state,narration:'completed',retryAction:o.retryAction,receipt:o.receipt}})).toBe(true);
  expect(isCalendarView({...agenda(),requested:null})).toBe(true);
  expect(isCalendarView({...agenda(),requested:{...agenda().requested!,displayTimeZone:'Invalid/Zone'}})).toBe(false);
  expect(isCalendarView({...agenda(),entries:[{...agenda().entries[0],allDay:true,start:'2026-02-30',end:'2026-03-03'}]})).toBe(false);
  expect(isCalendarView({...agenda(),entries:[{...agenda().entries[0],htmlLink:'javascript:alert(1)'}]})).toBe(false);
});
```

**Task 3 — `frontend/src/features/voice/state/live-voice-reducer.test.ts`:**

```ts
it('freezes proposal controls on reconnect and never cancels a write on barge-in',()=>{
  let state=liveVoiceReducer(initialLiveVoice,{type:'START',conversationId:'chat-1'});
  state=liveVoiceReducer(state,{type:'CALENDAR_FRAME',frame:{type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',
    event:{type:'calendar-view',view:proposal()}}});
  state=liveVoiceReducer(state,{type:'LOST'});state=liveVoiceReducer(state,{type:'RESUMED'});
  expect(state.calendarWorkspaces[0].interactive).toBe(false);
  state=liveVoiceReducer(state,{type:'CALENDAR_FRAME',frame:{type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',
    event:{type:'calendar-view',view:outcome()}}});
  state=liveVoiceReducer(state,{type:'INTERRUPT'});
  expect(state.calendarWorkspaces[0].view).toMatchObject({kind:'outcome',state:'succeeded'});
  expect(liveVoiceReducer(state,{type:'EXIT',notice:null,retainArtifacts:true}).calendarWorkspaces).toHaveLength(1);
  expect(liveVoiceReducer(state,{type:'EXIT',notice:null,retainArtifacts:false}).calendarWorkspaces).toEqual([]);
});
```

**Task 3 — `frontend/src/features/canvas/calendar-workspace.test.ts`:**

```ts
it('cannot downgrade a proposal revision or resurrect it after terminal success',()=>{
  const current=foldCalendarFrame([],frame({type:'calendar-view',view:proposal()}));
  const stale=foldCalendarFrame(current,frame({type:'calendar-view',view:{...proposal(),revision:1}}));
  expect(stale[0].view).toMatchObject({kind:'proposal',revision:2});
  const final=foldCalendarFrame(current,frame({type:'calendar-view',view:outcome()},'confirm-turn'));
  expect(foldCalendarFrame(final,frame({type:'calendar-view',view:proposal()}))[0].view).toMatchObject({kind:'outcome'});
  const pending=current.map(w=>({...w,interactive:false,pending:true}));
  expect(foldCalendarFrame(pending,frame({type:'calendar-progress',phase:'executing'},'button-turn'))).toHaveLength(1);
});
```

**Task 4 — `frontend/src/features/voice/state/live-voice-controller.test.ts`:** import `NOW`, `proposal`, `agenda`, `notice`, and use the fixture's `selectConversation` added in Task 4.

```ts
it.each(['expired','revision','navigation','thinking','lost','candidate'] as const)
  ('rejects %s confirmation without sending a control',async kind=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);
    const f=liveVoiceFixture();
    try {
      await f.begin();f.event({type:'conversation.bound',conversationId:'chat-1'});
      f.event({type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',event:{type:'calendar-view',view:proposal()}});
      if (kind === 'expired') vi.setSystemTime(NOW+600_000);
      if (kind === 'navigation') f.selectConversation('other');
      if (kind === 'thinking') f.event({type:'voice.state',input:'listening',agent:'thinking',connection:'connected'});
      if (kind === 'lost') f.callbacks().lost?.();
      f.client.control.mockClear();
      expect(f.controller.confirmCalendar('proposal-1',kind === 'revision' ? 1 : 2,
        kind === 'candidate' ? {kind:'select',calendarId:'unlisted@example.com'} : {kind:'accept'})).toBe(false);
      expect(f.client.control).not.toHaveBeenCalled();
    } finally {f.controller.exit();await settle();vi.useRealTimers();}
  });
it('does not await an unfinished visual subscription before subsequent audio events',async()=>{
  const f=liveVoiceFixture();await f.begin();f.event({type:'conversation.bound',conversationId:'chat-1'});
  const off=f.controller.subscribe(()=>new Promise<void>(()=>{}));
  f.event({type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',event:{type:'calendar-view',view:agenda()}});
  f.event({type:'audio.start',turnId:'t',responseId:'r',sampleRate:24000,firstAudioSequence:0});
  expect(f.controller.getSnapshot().agent).toBe('speaking');
  expect(f.client.stopInput).not.toHaveBeenCalled();off();f.controller.exit();await settle();
});
it.each([false,'throw'] as const)('keeps uncertain confirmation delivery fenced on %s',async result=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);const f=liveVoiceFixture();
  try {
    await f.begin();f.event({type:'conversation.bound',conversationId:'chat-1'});
    f.event({type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',event:{type:'calendar-view',view:proposal()}});
    f.client.control.mockImplementationOnce(()=>{if (result === 'throw') throw new Error('send');return false;});
    expect(f.controller.confirmCalendar('proposal-1',2,{kind:'accept'})).toBe(false);
    expect(f.controller.confirmCalendar('proposal-1',2,{kind:'accept'})).toBe(false);
    expect(f.controller.getSnapshot().calendarWorkspaces[0]).toMatchObject({pending:true,interactive:false});
    expect(f.controller.getSnapshot().phase).toBe('active');
  } finally {f.controller.exit();await settle();vi.useRealTimers();}
});
```

**Task 5 — `frontend/src/features/canvas/calendar-canvas.test.ts`:**

```ts
it('keeps a valid view larger than legacy raw source and invalidates changed snapshot cache entries',()=>{
  const view=agenda();view.entries=Array.from({length:6},(_,index)=>({...view.entries[0],eventId:`event-${index}`,description:'x'.repeat(1600)}));
  expect(JSON.stringify(view).length).toBeGreaterThan(8192);expect(isCalendarView(view)).toBe(true);
  const message=calendarMessage(view);
  expect(collectSessionCanvasArtifacts([message],'',false)[0].calendarView).toEqual(view);
  message.calendarView={...agenda(),entries:[{...agenda().entries[0],summary:'Changed snapshot'}]};
  const changed=collectSessionCanvasArtifacts([message],'',false)[0].calendarView;
  expect(changed?.kind === 'agenda' && changed.entries[0].summary).toBe('Changed snapshot');
});
```

**Task 6 — `frontend/src/features/canvas/renderers/calendar-agenda-view.test.ts`:**

```ts
it('handles get-event and omitted fields without inventing attendees or a requested range',()=>{
  const view=agenda();view.requested=null;
  delete view.entries[0].location;delete view.entries[0].description;view.entries[0].status='cancelled';
  const html=renderToStaticMarkup(createElement(CalendarAgendaView,{view,nowMs:NOW}));
  expect(html).toContain('Returned event details');expect(html).toContain('cancelled');
  expect(html).not.toContain('Location:');expect(html).not.toContain('Attendees');expect(html).not.toContain('No events');
});
```

**Task 6 — `frontend/src/features/canvas/renderers/calendar-view-renderer.test.ts`:**

```ts
it('keeps receipt facts after expiry but removes external link and expiring label',()=>{
  const fresh=renderToStaticMarkup(createElement(CalendarViewRenderer,{view:outcome(),nowMs:NOW}));
  expect(fresh).toContain('Calendar event created');expect(fresh).toContain('Calendar: Team');expect(fresh).toContain('href=');
  const old=renderToStaticMarkup(createElement(CalendarViewRenderer,{view:outcome(),nowMs:NOW+600_000}));
  expect(old).toContain('Event ID: event-1');expect(old).not.toContain('Calendar: Team');expect(old).not.toContain('href=');
});
```

**Task 7 — `frontend/src/styles/styles.test.ts`:**

```ts
it('keeps Calendar scrolling/selectable with responsive focusable content instead of a diagram stage',()=>{
  const css=readFileSync(new URL('./chat.css',import.meta.url),'utf8');
  const body=css.match(/\.aurvin-canvas-calendar-body\s*\{([^}]+)\}/)![1];
  expect(body).toContain('overflow-y: auto');expect(body).toContain('user-select: text');expect(body).toContain('touch-action: pan-y');
  expect(body).not.toContain('transform:');expect(body).not.toContain('animation:');
  expect(css).toContain('.aurvin-calendar-workspace :is(button,a,summary):focus-visible');
  expect(css).toContain('@media (max-width: 600px)');
});
```

## Task 10: Run P2 regression checks and deliver a precise P3 handoff

This task is verification, not another subsystem or a reinstated review. Do not change state.md/final-report ownership. Route a backend defect to P1, fix frontend defects with a red regression test in its owning task's files, and serialize any corrective commit with the orchestrator.

- [ ] **Step 1: Run (frontend/), separately:**

```bash
npm run build
```

```bash
npm run lint
```

```bash
npm test
```

Expected: build/typecheck and lint pass; report actual Vitest test counts, failed tests, and skips, comparing any failures to the recorded baseline. An empty suite is not evidence. Do not “fix” unrelated auth/Vite work to get a green result.

- [ ] **Step 2: Run (repository root):**

```bash
git diff --check
```

```bash
git status --short
```

Check that changes are named P2 files only, all new code/test files have the full required header, no lockfile/dependency/generated output/secret is staged, and non-calendar diagram behavior still passes its original tests.

- [ ] **Step 3: Audit the no-new-wait boundary and provide evidence, not a zero-overhead claim.** Record before/after counts for display-only HTTP/model/provider calls (must remain zero), new serial awaited rendering/animation/ack dependencies (must remain zero), and bounded projections (one view, at most 20 agenda entries/64 live workspaces). The controller throwing-subscriber test and completion-without-a-frame-tick test must pass. Do not run a spin loop or block the browser event loop to simulate “slow UI”; arbitrary synchronous JavaScript cannot be made free. A pending/failed display callback must not be awaited, and P3 owns comparative performance/browser measurements and actual transport execution.

- [ ] **Step 4: Report these exact integration APIs to P3:** `CalendarFramePayload` requires responseId; `LiveVoiceState.calendarWorkspaces`; `LiveVoiceController.confirmCalendar(proposalId,revision,answer):boolean`; `LiveVoiceBindings.getActiveConversationId`; pure `foldCalendarFrame`, `calendarViewArtifact`, `mergeCalendarWorkspaces`, `claimCalendarAutoOpenId`, `matchesCalendarArtifact`; `CalendarTurnView.results/onOpenCanvas`; optional `LiveVoiceSurface.confirmCalendar`. Include all implementation commits, tested checkout/runtime, commands/counts, baseline failures/skips, and any contract corrections.

- [ ] **Step 5: Provide the following fixture-backed interaction checklist to P3** (do not claim it ran from SSR): desktop and 360px viewport; real work opens Calendar while audio is speaking; grouped agenda/DST/all-day/exclusive ends; explicit text-only button; exact review/canonical choice/expiry; keyboard/native disclosure/focus; dismissal and tab-close sticky across phase updates; explicit reopen; voice/button race ends once; barge-in/unknown outcome remains truthful; reconnect old proposals read-only; session navigation isolation; reload from archived voice pill; reduced-motion shell; thrown visual renderer contained while chat/audio remain usable. No live Google/OpenRouter/LiveKit service, database mutation, or paid calls are authorized.

No empty verification-only source commit is required. If corrections are necessary, stage only named owned files and use `git commit -m "fix(calendar-ui): correct fixture-proven Calendar presentation regression"`, with the failing test and passing recheck in the worker report.

## Acceptance map and implementation self-check

- **AC1:** Tasks 3–4, 6–7, 9: actual-work progress, single voice workspace, agenda; validation/schema loading alone does not open it.
- **AC2:** Tasks 2, 8–9: inline agenda/text confirmation, manual Canvas button, deletion of both text auto-open branches; unrelated live/non-calendar artifacts preserved.
- **AC3:** Tasks 1, 3–4, 6, 8: exact structured action, current proposal identity/revision, duplicate pending fence, canonical candidate ID, expiry and historical read-only; CAS and speech/button race authority stay in P1.
- **AC4:** Tasks 3, 6, 9: progress/proposal/notice/outcome truth, no confirmation through dismissal/barge-in, no automatic uncertain-write replay.
- **AC5:** Tasks 1, 5–6: timed/date-only/multi-day/DST, nullable requested/zone, empty versus unavailable, partial/pagination/omitted/trimmed evidence, safe expiring links and labels; no invented attendee/calendar facts.
- **AC6:** Tasks 2–5, 8–9: snapshot completion, history and voice-transcript propagation, identity aliases/dedupe, reconnect freeze, navigation clearing/fencing.
- **AC7:** Tasks 6–9: no pan/zoom trapping, ordinary disclosure/buttons/headings, selectable readable mobile body, no focus theft, reduced motion and unchanged media lifetime.
- **AC8:** Every task has a red/green command and focused commit; Task 10 gives P2 package evidence to P3, which runs integrated/both-package checks. **Planned tests are not passing evidence.**
- **AC9:** All tasks preserve no display-only calls or awaited rendering; Tasks 2/4 prove immediate terminal/audio continuation under failed/unrendered presentation; Task 10 hands measurement limitations to P3.

## Documentation sources checked during planning

- Repository research and P1 contract sources above are the implementation authority.
- React documentation via Context7 `/reactjs/react.dev`: [useSyncExternalStore caveats](https://react.dev/reference/react/useSyncExternalStore#caveats), [error boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary), and [renderToStaticMarkup caveats](https://react.dev/reference/react-dom/server/renderToStaticMarkup#caveats). External-store updates cannot simply be transitioned; boundaries do not catch event/SSR/async failures; SSR tests cannot prove effects/focus or visual non-blocking behavior.
- Existing tokens are in `frontend/src/index.css`: dark `#000000`/`#2f2f2f`/`#ececec`/`#afafaf`, light `#ffffff`/`#f4f4f4`/`#0d0d0d`/`#8f8f8f`; retain existing UI font and token roles rather than adding colors/fonts. Use stronger text token where muted text would fail contrast for actionable content.

**Status:** implementation plan only. No frontend source changes or application test results are represented by this document. Unified review remains **skipped**.
