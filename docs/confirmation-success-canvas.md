# Confirmation success canvas fix

## Follow-up: original fix was incomplete

The user reproduced the false rejection after the initial fix. The initial regression covered a successful API envelope followed by model narration, but not an event that was committed while response projection failed. It did not establish the cause of the user's live failure.

Read-only inspection of the latest persisted operations found `definitely-failed` with `CALENDAR_INPUT_REJECTED`. Source inspection found `extendedProperties.private` in the shared create/readback response selector. Google's documented partial-response syntax requires `extendedProperties/private` (or parentheses), and invalid selectors return HTTP 400: <https://developers.google.com/workspace/calendar/api/guides/performance>. The original raw Google error text was not retained, so the persisted code alone does not prove the precise provider message.

The follow-up changes:

- Correct the shared selector in `backend/src/plugins/google-calendar/calendar-api.ts` for create and readback.
- Recognize a write's explicit `Invalid field selection` 400 in `calendar-api-http.ts` as an uncertain response-projection failure, not rejection of event details.
- In `tools.ts`, perform exactly one bounded readback of the original event ID for this failure. Existing target, action, private operation linkage, and request-hash checks must match before creating a success receipt. Never send another POST. An absent, mismatched, or unavailable readback remains unknown.
- In `calendar-loop.ts`, return failed and unknown write outcomes directly, without model narration. Only pre-write availability clarification retains the conversational path.

The new reproduction first failed with a stored event followed by `definitely-failed`. It now passes: a matched readback produces one durable success event with no further LLM request; absent/mismatched/unavailable readbacks produce unknown outcomes without another model request or write. A genuine event-details rejection remains failed and is also reported without another LLM call.

Follow-up verification:

- 311 targeted Calendar API, transport, runtime, recovery, publication, and observability tests passed across 28 files.
- Backend build and lint passed (lint warnings remain).
- Broad backend check excluding the two previously reproduced failing suites and the intermittent built-import suite: **2,453 passed, 10 skipped**, across 277 passing and two skipped files. Exclusions are not passing evidence; the complete suite is not certified green.
- Built assembly test passed separately after the follow-up build; `git diff --check HEAD` passed.
- No live Google/OpenRouter calls were made, no existing Calendar event was altered, and no historical operation record was repaired. The new tests simulate the committed-write/error-response sequence; live behavior still needs verification.

## Approved behavior

The user approved this focused fix on 3 November 2026 and requested execution in this single session without further skills or delegation.

Confirm executes the authorized Calendar request. A durable success receipt finalizes the turn without another LLM request or another create, and the existing Aurvin Calendar canvas opens using its existing right-to-left entrance animation. Failed or uncertain writes do not become success artifacts. No redesign, live provider calls, or infrastructure changes are included.

## Changes

- `backend/src/chat-runtime/calendar-loop.ts`: successful creates now seal locally even when a model dispatch preceded the write. Previously that case returned to model decision-making, allowing another model response to contradict a successful write.
- `frontend/src/features/canvas/canvas-artifacts.ts`: receipt-only Calendar artifacts are merged even without live voice projections.
- `frontend/src/features/chat/ChatView.tsx`: a new successful turn waits for its matching artifact rather than selecting an unrelated older Calendar artifact or marking a nonexistent artifact handled.
- Regression tests cover single delivery, no post-success model request, durable success frames and completion after confirmation, receipt-only projection, and no success artifact for failed/unknown/pending operations. Existing accounting tests now expect one fewer dispatch; recovery tests inject persistence failure rather than failure of the removed narration request.
- Existing uncommitted changes were preserved. No commit was created.

## Verification

- Regression tests first failed on the extra model dispatch and missing receipt-only artifact, then passed after the fixes.
- Frontend: all 75 test files / 597 tests passed; build and lint passed (warnings remain).
- Backend: build and lint passed (lint warnings remain).
- Backend end-to-end configuration: 22 tests passed; 138 skipped because their prerequisites were not available. Skips are not passing integration evidence.
- Final targeted backend check: confirmation, concurrency/retry, accounting/recovery, and built assembly — 21 tests passed across four files.
- Broader backend check excluding the two independently reproduced failing suites: 2,446 passed, 10 skipped, one built-assembly import failure. That built test passes in the targeted run but fails during broad discovery with `Cannot find module '/dist/plugins/google-calendar/tools.js'`.
- Full backend run also reported 17 performance/context-limit failures and one authority/clarification failure. These same 18 failures were reproduced with the original post-create continuation behavior temporarily restored; that temporary diagnostic change was removed. They were not changed or hidden by this fix.
- `git diff --check HEAD` passed.

## Limitations

The overall backend suite is not green. No live Google/OpenRouter calls, paid checks, or interactive browser confirmation were performed. The existing CSS entrance animation (`translateX(100%)` to `translateX(0)`) was inspected and left unchanged, including reduced-motion behavior. Unified review was skipped, not passed.
