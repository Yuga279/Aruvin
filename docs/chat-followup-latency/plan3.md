# Composer drafting and sidebar follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Unified review is **skipped**. Do not git add/commit; parent serializes named files.

**Goal:** Let the user type a follow-up during generation/finalization without a second send until durable terminal/release, keep voice exclusivity and draft safety across old-request cleanup, and stop an immediate sessions GET on every completed turn.

**Architecture:** Separate composer *editing* from *send* gating. Give submit/retry/cancel/navigation a generation token so stale catch/finally/error handlers cannot overwrite a newer draft or cancel a newer coalescer. Skip or abort post-turn `listSessions` when the active session is already in the sidebar or a send is in flight; never invent `lastActivityAt`/title from stream frames.

**Tech Stack:** React 19, Vite, existing Vitest Node harness (`renderToStaticMarkup` + reducer), existing `ApiClient` fetch abort mapping.

---

## Research (this worker)

Demonstrated causes, not guesses:

1. `Composer.tsx` sets `disabled={state.isStreaming}` while Send already uses `isSubmitting || isStreaming`. Reducer `SET_DRAFT` already allows typing unless `voiceInput` is held. Voice remains exclusive via `readOnly={voiceLocked}`, `claimVoiceInput` busy guards, and `textBusy`.
2. Shared `submitMessage` / `retryTurn` `finally` always calls `coalescer.cancel()`, even when `activeAbortControllerRef` has moved on. After `STREAM_COMPLETED` the next send can attach the coalescer, then the previous `connectTurnStream` finally aborts it. Same generation hole: aborted `submitTurn` catch dispatches `STREAM_CANCELLED` / `TURN_SUBMIT_ERROR` after `NEW_CHAT` / a newer submit.
3. `TURN_SUBMIT_ERROR` always writes `draftInput: preservedContent`. Textarea is **not** disabled during `isSubmitting`, so a user can type before `submitTurn` fails; the error then restores the sent text and drops the new draft. If a newer submit already started, it also strips all `temp_` messages.
4. `dispatchStreamEvent` calls `loadSessions()` on every `completed`. Stream payload has no title/`lastActivityAt`. Known sidebar rows already have authoritative pin/title/pagination; a GET on the follow-up path is unnecessary. Missing rows (new chat) still need a list fetch, but an in-flight GET must not race the next send.

Out of scope: backend, protocol rewrite, UI visual redesign, queued send, new scheduler/cache framework, invented timestamps, Git commits.

---

## Files

**Modify:**
- `frontend/src/components/Composer.tsx` — stop disabling textarea on stream; keep send/cancel/voice/IME gates
- `frontend/src/features/chat/state/use-chat.ts` — generation ownership; draft-safe errors; skip/abort post-turn list reconcile
- `frontend/src/features/chat/state/chat-reducer.ts` — do not clobber a newer non-empty draft on `TURN_SUBMIT_ERROR`
- `frontend/src/api/client.ts` — optional `signal` on `listSessions` only
- `frontend/src/components/Composer.test.ts` — existing streaming lock assertion must match new edit/send split (suite hygiene)

**Create:**
- `frontend/src/components/composer-followup-draft.test.ts`
- `frontend/src/features/chat/state/chat-followup-generation-safety.test.ts`
- `frontend/src/features/chat/state/sidebar-followup-reconcile.test.ts`
- `docs/chat-followup-latency/worker3-results.md`

**Do not edit:** backend, lockfiles, `goal.md`/`state.md`, other workers' docs, unrelated frontend files.

---

### Task 1: Composer editing vs send gating

**Files:**
- Create: `frontend/src/components/composer-followup-draft.test.ts`
- Modify: `frontend/src/components/Composer.tsx`, `frontend/src/components/Composer.test.ts`

- [x] **Step 1: Write the failing composer draft tests**

Node markup + existing voice mock pattern from `Composer.test.ts`. Assert during `accepted` / `generating` / `finalizing`:

- textarea is **not** `disabled`
- Cancel is shown, Send is not
- `readOnly` still applies when dictation/live lock is held
- `submitMessage` is not called while `isStreaming`
- Shift+Enter and IME `isComposing` do not send; Enter still preventDefaults and no-ops while streaming
- after terminal completed/cancelled/error/interrupted, Send returns and draft text is still in the textarea value

- [x] **Step 2: Run to verify red**

```powershell
npm test -- src/components/composer-followup-draft.test.ts --reporter=verbose
```

Expected: FAIL because `disabled={state.isStreaming}` still renders `disabled=""`.

- [x] **Step 3: Minimal composer change**

Remove `disabled={state.isStreaming}`. Keep `readOnly={voiceLocked}`. Keep `isSubmitDisabled` including `isSubmitting || isStreaming`. Keep Cancel vs Send. Do not auto-queue send.

- [x] **Step 4: Update the old Composer.test.ts lock example** so it asserts submission locked and input *editable* during those statuses (otherwise it fights Task 1).

- [x] **Step 5: Re-run composer tests green**

```powershell
npm test -- src/components/composer-followup-draft.test.ts src/components/Composer.test.ts src/features/voice/dictation/composer-events.test.ts --reporter=verbose
```

No commit.

---

### Task 2: Generation ownership (shared submit/retry cleanup)

**Files:**
- Create: `frontend/src/features/chat/state/chat-followup-generation-safety.test.ts`
- Modify: `frontend/src/features/chat/state/use-chat.ts`, `frontend/src/features/chat/state/chat-reducer.ts`

- [x] **Step 1: Write failing regressions** using the existing `renderToStaticMarkup` + `useChatActions` harness:

1. **Stale `finally` must not cancel a newer coalescer.** Hang first `connectTurnStream` on a deferred promise. Fire `completed`. Re-render actions from post-terminal state. Start a second `submitMessage`. Resolve the first stream. Second stream deltas must still flush; first `finally` must not `coalescer.cancel()` the new attach.
2. **Stale `TURN_SUBMIT_ERROR` must not overwrite a typed draft.** Start submit with hanging `submitTurn`. `SET_DRAFT` a follow-up while `isSubmitting`. Reject `submitTurn`. Draft stays the follow-up, not `preservedContent`. Empty draft still restores `preservedContent` (retryable failed send).
3. **Stale abort after navigation.** Start submit, `startNewChat()` (aborts). Catch must not dispatch `STREAM_CANCELLED` onto the new empty chat (`turnStatus` stays idle).
4. **Retry shares the same guards.** Same as (1) on `retryTurn` → newer submit.
5. **Send remains serialized.** After accepted/generating/finalizing, `submitMessage` / `retryTurn` do not call `submitTurn`/`retryTurn` (existing Composer.test behavior, keep in this file too).
6. **No queued send.** Completing a turn does not call submit with leftover draft.

- [x] **Step 2: Run to verify red**

```powershell
npm test -- src/features/chat/state/chat-followup-generation-safety.test.ts --reporter=verbose
```

Expected: FAIL on (1) (coalescer cancelled) and (2) (draft restored to sent text) and likely (3).

- [x] **Step 3: Minimal implementation**

In `use-chat.ts`:

- `generationRef` incremented only when a turn request actually starts (`submitMessage` past guards, `retryTurn` past guards) and when `cancelCurrentTurn` / `startNewChat` / `selectSession` take over.
- `onEvent` / `onError` / `catch` / `finally` no-op unless `generationRef.current === generation`.
- `coalescer.cancel()` in `finally`/`catch` only for the owning generation.
- `TURN_SUBMIT_ERROR` only if still current generation.

In `chat-reducer.ts` `TURN_SUBMIT_ERROR`:

```typescript
draftInput: state.draftInput.length > 0 ? state.draftInput : action.payload.preservedContent,
```

Do not strip a newer in-flight user message if this action is still only dispatched for the owning generation (temp_ filter stays for that failed submit).

- [x] **Step 4: Green**

```powershell
npm test -- src/features/chat/state/chat-followup-generation-safety.test.ts src/features/chat/state/chat-stream-coalescing.test.ts src/features/chat/state/chat-reducer.test.ts src/features/chat/state/voice-draft-lock.test.ts --reporter=verbose
```

No commit.

---

### Task 3: Sidebar reconcile off the follow-up path

**Files:**
- Create: `frontend/src/features/chat/state/sidebar-followup-reconcile.test.ts`
- Modify: `frontend/src/features/chat/state/use-chat.ts`, `frontend/src/api/client.ts` (signal only if the regression needs abort)

- [x] **Step 1: Write failing tests**

1. Completed follow-up on a session **already in** `state.sessions` does not call `listSessions`. Pin, title, `lastActivityAt`, cursor, and extra paged rows stay as they were. No fabricated timestamp/title in dispatched actions.
2. Completed **new** session (id not in list) does call `listSessions` once (insertion still required; response metadata comes from the API, not the stream).
3. If that GET is still in flight and `submitMessage` starts, the list fetch is aborted (`signal.aborted`) and a late `SESSIONS_LOADED` is not applied. Retry after the follow-up completes still inserts when the session is missing.
4. Explicit `loadSessions` / `loadMoreSessions` still work. `selectSession` after skip still loads messages. Retry completed on a known session also skips GET.

- [x] **Step 2: Run to verify red**

```powershell
npm test -- src/features/chat/state/sidebar-followup-reconcile.test.ts --reporter=verbose
```

Expected: FAIL because `completed` currently always `loadSessions()`.

- [x] **Step 3: Minimal implementation**

- Keep a `sessionsRef` (and abort controller) in `use-chat.ts`.
- On `completed`, if `envelope.sessionId` is already in `sessionsRef`, do nothing.
- Else `listSessions({ signal })`. Ignore `ABORTED`. Do not `SESSIONS_ERROR` on abort. Ignore results if the abort controller is no longer current or `isSubmitting`/`isStreaming` is true (defer by setting a pending flag and retrying on the next terminal `completed` if still missing).
- On `submitMessage` / `retryTurn` start: abort in-flight **reconcile** GET only (not a reason to invent a scheduler).
- `listSessions` gains optional `signal?: AbortSignal` passed through existing `request()`.

Never synthesize `createdAt` / `lastActivityAt` / title.

- [x] **Step 4: Green + safety**

```powershell
npm test -- src/features/chat/state/sidebar-followup-reconcile.test.ts src/features/chat/state/chat-followup-generation-safety.test.ts src/components/composer-followup-draft.test.ts src/components/Composer.test.ts src/features/chat/state/chat-stream-coalescing.test.ts src/api/client.test.ts --reporter=verbose
```

Then scoped `npm run lint` / `npm run build` in `frontend/` if time; parent runs integrated checks.

No commit.

---

## Verification notes

- Frontend tests are Node, not browser paint/p95 evidence.
- No `npm ci`, no backend, no `.env`, no paid calls.
- Review skipped, not passed.

## Spec coverage

| AC / instruction | Task |
| --- | --- |
| Draft during generating/finalizing; Send gated; no queue | 1 |
| Voice exclusivity, Enter/Shift+Enter/IME, draft through terminal | 1, 2 |
| Old failure/abort/finally vs newer draft/stream | 2 |
| No immediate GET when sidebar already has the session; defer/abort when busy | 3 |
| No invented timestamps/titles; pin/page/new-session/retry/navigation | 3 |
