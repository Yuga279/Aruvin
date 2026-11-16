# Worker 3 results: composer drafting and sidebar follow-up

Review: **skipped**, not passed. No git staging/commits. Node tests only; not browser paint or p95 evidence.

## What changed

- Textarea stays editable during `accepted` / `generating` / `finalizing`. Send stays gated (`isSubmitting` / `isStreaming`); Cancel still replaces Send; voice/dictation remains `readOnly` + claim/submit interlock. No queued send.
- Shared submit/retry cleanup uses a generation token. Stale `catch`/`finally`/`onEvent`/`onError` cannot overwrite a newer draft, dispatch `STREAM_CANCELLED` after New Chat, or `coalescer.cancel()` a newer attach.
- `TURN_SUBMIT_ERROR` restores `preservedContent` only when the composer is still empty.
- **No GET on the completion-to-follow-up path.** Known sidebar rows skip the immediate list fetch. After **250ms idle** (`setTimeout`, existing timer pattern) they reconcile from `listSessions` and apply **`SESSION_UPDATED`** with the server row (title/pin/`lastActivityAt`). Extra paged rows and `sessionsCursor` are kept. Missing (new) sessions still GET immediately for insertion via `SESSIONS_LOADED`.
- Follow-up `submit`/`retry` clears the idle timer and aborts an in-flight reconcile; stale results are ignored. After that turn completes, idle reconcile is scheduled again.
- `NEW_CHAT` / `SELECT_SESSION` abort an in-flight fetch (do not apply a stale first page) and reschedule idle reconcile for the pending session id. Hook unmount clears the timer, aborts the fetch, and drops the pending id.
- No invented stream timestamps or titles.

## Exact files

**Created**
- `docs/chat-followup-latency/plan3.md`
- `docs/chat-followup-latency/worker3-results.md`
- `frontend/src/components/composer-followup-draft.test.ts`
- `frontend/src/features/chat/state/chat-followup-generation-safety.test.ts`
- `frontend/src/features/chat/state/sidebar-followup-reconcile.test.ts`

**Modified**
- `frontend/src/components/Composer.tsx`
- `frontend/src/components/Composer.test.ts`
- `frontend/src/features/chat/state/use-chat.ts`
- `frontend/src/features/chat/state/chat-reducer.ts`
- `frontend/src/api/client.ts` (`listSessions` optional `signal` only)

**Build defect correction (this pass)**
- `frontend/src/features/chat/state/sidebar-followup-reconcile.test.ts` — unused `handlers` on the second `connectTurnStream` mock renamed away (`async (_path)`). No suppressions.

## Red / green

Working directory: `frontend/`.

| Check | Red (before fix) | Green (after fix) |
| --- | --- | --- |
| `npm test -- src/components/composer-followup-draft.test.ts --reporter=verbose` | 4 failed / 1 passed (textarea `disabled` during stream) | 5 passed |
| `npm test -- src/features/chat/state/chat-followup-generation-safety.test.ts --reporter=verbose` | 5 failed / 4 passed (stale finally, draft clobber, STREAM_CANCELLED after New Chat) | 9 passed |
| `npm test -- src/features/chat/state/sidebar-followup-reconcile.test.ts --reporter=verbose` | First pass: 4 failed / 1 passed (always GET). Integration follow-up: 3 failed / 5 passed (known skip forever; no idle GET) | **9 passed** |

Related safety after idle follow-up:
`npm test -- src/features/chat/state/sidebar-followup-reconcile.test.ts src/features/chat/state/chat-followup-generation-safety.test.ts src/components/composer-followup-draft.test.ts src/components/Composer.test.ts src/features/voice/dictation/composer-events.test.ts src/features/chat/state/chat-stream-coalescing.test.ts src/features/chat/state/voice-draft-lock.test.ts --reporter=verbose`

**57 passed / 7 files** (prior pass). This correction re-ran sidebar + build only.

## Suite commands / results

| Command (in `frontend/`) | Result |
| --- | --- |
| `npm test -- src/features/chat/state/sidebar-followup-reconcile.test.ts --reporter=verbose` | **9 passed / 1 file** (this correction) |
| `npm run build` | **pass** (`tsc -b && vite build`, this correction). Prior TS6133 on unused `handlers` is gone. |
| `npm test` | **73 files, 536 passed** (previous full run; parent re-runs) |
| `npm run lint` | **0** on parent integrated pass. |

## Pagination / idle strategy

Known-session idle reconcile uses **`SESSION_UPDATED` for the matching first-page row**, not `SESSIONS_LOADED`. That keeps `sessionsCursor`, `hasMoreSessions`, and already-appended page rows. A first-page replace would drop loaded-more chats; that was not done.

If the completed session is absent from the first page, the local row is left unchanged rather than replacing the list. New-chat insertion still uses `SESSIONS_LOADED` (no extra pages yet).

## Limitations

- Node Vitest, not browser DOM, focus/IME paint, or p95 Send-to-feedback.
- Unmount cleanup is implemented on the hook effect; this Node harness does not run `useEffect`, so unmount is covered by the same abort/timer clears used on submit/navigation plus the effect source.
- No backend, native DB, paid provider, or app restart.

## Compatibility / integration

- No protocol rewrite. `listSessions({ signal })` is additive.
- Independent of W1/W2 backend work. Parent serializes commits and runs integrated frontend build/lint/test.
- Drafting + serialized send + voice protections unchanged by this follow-up.
