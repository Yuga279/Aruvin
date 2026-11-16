---
objective: turn-status-ux
workflow: maw-lite
artifact: goal
date: 2026-10-08
status: pending-approval
source: User request in this chat — ChatGPT-style in-flight turn labels; approach A approved; Generating… shimmer added on approval
state: docs/turn-status-ux/state.md
---

# Goal: ChatGPT-style turn status labels

## 1. Outcome

Change only how the live assistant bubble presents in-flight turn states so they match common enterprise chat apps (ChatGPT, Gemini):

- Show **Generating…** at the top of the assistant message, and only before the first token, with a light shimmer across the words (ChatGPT/Gemini-style shine, not a spinner or skeleton).
- Hide that label as soon as any streamed text exists.
- Never show **Finalizing…**.
- Keep Send locked until the current turn is durably terminal, so a follow-up cannot be submitted during generating or finalizing.
- Keep terminal labels (cancelled, failed, interrupted, truncated) after the answer text.

This is a frontend presentation change. Do not change the stream protocol, reducer status values, persistence, or retry semantics.

## 2. Current behavior

`frontend/src/components/MessageItem.tsx` renders status badges **below** assistant content:

- `generating` and `streaming` → **Generating…**
- `finalizing` → **Finalizing…**
- truncated / cancelled / failed / interrupted stay after the body (failed and interrupted also show Retry)

The live bubble is the in-flight `MessageItem` in `Transcript` (`liveStatus={state.turnStatus}`). A caret already appears on generating/streaming content via CSS.

The composer already blocks a new submit while `isSubmitting` or `isStreaming`. `isStreaming` stays true from `TURN_ACCEPTED` through generating and finalizing until a terminal stream action (`STREAM_COMPLETED`, `STREAM_ERROR`, `STREAM_CANCELLED`, `STREAM_INTERRUPTED`). Hiding **Finalizing…** must not reopen Send during that window.

## 3. Confirmed product decisions

- Approach **A**: render-only in the assistant message presentation. No new UI status machine in the reducer.
- **Generating…** occupies the top of the message body only while the live assistant content is empty.
- That placeholder uses a CSS shimmer on the text itself: a highlight sweeping across **Generating…**. No extra icon, bouncing dots, skeleton bars, or bubble pulse.
- After the first token, no in-flight label and no shimmer. Streamed Markdown only (caret may remain while live).
- If the user prefers reduced motion, show static **Generating…** with no shimmer.
- **Finalizing…** is never shown.
- Send / Enter stay disabled until the turn is terminal (completed, truncated, cancelled, failed, or interrupted). Stop remains the in-flight composer action.
- **Cancelled** appears after whatever partial text was kept.
- Failed and interrupted keep the existing after-content badge plus Retry.
- Truncated keeps **Response reached maximum length** after the content.
- A completed answer has no status badge.

## 4. Presentation contract

Let `content` be the text shown in the live or durable assistant bubble, and `status` be `liveStatus` for the in-flight row else `message.completionStatus`.

| Condition | Label | Placement |
| --- | --- | --- |
| In-flight (`generating`, `streaming`, `accepted`, `submitting` if shown on the assistant row) and `content` is empty | Generating… with text shimmer | Top of message body, in place of the answer |
| In-flight and `content` is non-empty | none | — |
| `finalizing` | none | — |
| `completed` | none | — |
| `truncated` | Response reached maximum length | After content |
| `cancelled` | Cancelled | After content |
| `failed` | Generation failed + Retry | After content |
| `interrupted` | Generation interrupted + Retry | After content |

User messages are unchanged (plain bubble, no status labels).

## 5. Composer lock

While the current view has an in-flight turn, including finalizing:

- Send is not available (Stop is).
- Enter must not submit a new user message.
- A new turn must not start until the in-flight turn is terminal.

Do not weaken the existing `isStreaming` / `isSubmitting` lock. If a focused test shows a gap during `finalizing`, close that gap in the composer without adding a second lock abstraction.

The textarea may stay disabled while streaming, as it does today. Do not add a “type ahead but don’t send” mode.

## 6. Scope boundaries

**In scope**

- `MessageItem` (and a small pure helper if that is the smallest way to test the table in Node Vitest).
- CSS for (1) placing empty-state **Generating…** at the top of the message body and (2) the text shimmer on that label, including `prefers-reduced-motion`.
- Composer only if the finalizing send-lock needs a test-backed guard.
- Focused frontend tests for the presentation table and the send-lock invariant.

**Out of scope**

- Session rename, delete, archive, search, or header titles.
- Error toasts, spinners, skeleton paragraphs, bouncing dots, model picker, copy/edit/regenerate.
- Backend, protocol, persistence, or LangGraph changes.
- Changing Retry, truncation copy, Markdown rendering, or scroll behavior.
- Showing **Generating…** on durable (non-live) messages.

## 7. Architecture

Keep ChatView / Transcript / reducer / `use-chat` orchestration as they are unless a test proves the composer lock is open during finalizing.

Preferred shape: one pure function that, given `status` and `content`, returns whether to show the generating placeholder vs an after-content terminal badge. `MessageItem` calls it. Node tests assert that function; they do not mount React (frontend Vitest is Node, not a browser DOM).

Do not add a new component, context, or status enum.

## 8. Acceptance criteria

| ID | Criterion |
| --- | --- |
| AC1 | Live assistant with empty content and an in-flight status shows **Generating…** at the top of the message body, not below empty content. |
| AC1b | That **Generating…** label has the shimmer CSS class (animated shine on the words). Streamed answer text and terminal badges do not. Reduced-motion users get the same words without animation. |
| AC2 | Live assistant with any non-empty streamed text shows no Generating… or Finalizing… label, and no shimmer. |
| AC3 | Status `finalizing` never renders a Finalizing… (or Generating…) label. |
| AC4 | Composer cannot submit a new message while `isStreaming` is true, including while `turnStatus` is `finalizing`. |
| AC5 | Cancelled durable/live terminal content shows **Cancelled** after the text. |
| AC6 | Failed and interrupted still show their badge and Retry after the text. |
| AC7 | Truncated still shows **Response reached maximum length** after the text. |
| AC8 | Completed assistant messages show no turn-status label. |
| AC9 | User bubbles and existing Markdown / caret / Retry behavior stay unchanged aside from the label rules above. |

## 9. Verification

Frontend package, existing Vitest Node discovery:

- Focused unit tests for the presentation table (AC1–AC3, AC5–AC8). Shimmer is a CSS class on the generating placeholder; tests assert the class name is applied only in the AC1 case, not that pixels animate.
- Existing composer/orchestration coverage or a small addition proving AC4 (submit disabled while `isStreaming` is true even if `turnStatus` is `finalizing`).
- `npm test` and `npm run lint` in `frontend/`. Do not claim backend suites as evidence for this UI change.

Skipped review is not a pass. A missing Generating… on an empty live bubble, a leftover Finalizing…, or a sendable composer during finalizing is a defect.

## 10. Authorization

Planning and implementation wait on explicit user approval of this file. This document does not authorize backend work, persistence changes, or deployment.
