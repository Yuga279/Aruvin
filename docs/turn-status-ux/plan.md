# Turn Status UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a text-shimmering Generating… placeholder only before live assistant text arrives, hide all finalizing labels, and preserve the existing send lock and terminal badges.

**Architecture:** Add one small pure presentation helper beside `MessageItem`; it resolves live versus durable status and returns the generating class or terminal status. `MessageItem` renders the placeholder instead of empty Markdown, with CSS scoped to those words. Keep the existing reducer, transport, transcript, composer, and submit-action logic unchanged; prove the finalizing lock with real reducer transitions, server-rendered composer markup, and the real submit action in Node tests.

**Tech Stack:** Existing React 19 / TypeScript / Vite frontend, Vitest 4 in Node, `react-dom/server` for supplementary markup checks, existing CSS tokens and reduced-motion media queries. No new dependencies or browser-DOM test environment.

---

## Plan 1 only: authorization and boundaries

- Source: approved `docs/turn-status-ux/goal.md`, latest goal commit `838803f`; approval is recorded in `docs/turn-status-ux/state.md`. The goal's older frontmatter/authorization wording is not a new approval gate.
- Three sequential tasks; each has a red test, minimal implementation, green checks, and a focused commit. Regression tests for an already-correct lock should pass immediately: do not deliberately break production code to manufacture a failure.
- This file is the implementation plan, not implementation or verification evidence. The planner commits only this document. The worker later owns the source/test files listed below.
- No backend, protocol, persistence, reducer status-enum, session rename/delete, retry-semantics, Markdown, or scroll changes. No spinner, skeleton, bouncing dots, new component/context, or second lock abstraction.
- Review remains **skipped**, not passed. The final report/state updates belong to the orchestrator, not these source commits.
- Preserve unrelated work, including `backend/src/main.ts`, `backend/test/operations/**`, `backend/scripts/**`, `docs/terminal-close-launcher/**`, `README.md`, `run.bat`, and `.openchamber/`. Never use `git add .`. Before each commit, inspect the index; stop if unrelated files are staged and request coordination rather than unstaging someone else's work.

## Existing flow confirmed during planning

1. `frontend/src/components/Transcript.tsx:57-71` creates a live assistant row only while `state.isStreaming`, passing `liveStatus={state.turnStatus}` and `content: state.streamText`.
2. `frontend/src/features/chat/state/chat-reducer.ts:219-240` sets `isStreaming=true` on `TURN_ACCEPTED`. `STREAM_DELTA` and `STREAM_STATUS` preserve that flag, including during finalizing (`253-263`). Terminal actions clear it (`265-325`). `TURN_SUBMIT_START` separately sets `isSubmitting=true`.
3. `frontend/src/components/Composer.tsx:47-49,67-92` disables Send for submitting/streaming, disables the textarea while streaming, and replaces Send with Stop. Its Enter handler delegates to `actions.submitMessage()`.
4. `frontend/src/features/chat/state/use-chat.ts:181-186` rejects submission while `isStreaming` or `isSubmitting`, regardless of `turnStatus`. Thus finalizing is already locked, including the action reached by Enter; no production composer edit is warranted.
5. `frontend/src/components/MessageItem.tsx:49-85` currently emits in-flight badges below Markdown. Its terminal labels and Retry callback already have the required copy and behavior.
6. `frontend/src/styles/chat.css:272-289` attaches the existing caret to `.aurvin-message-content` for generating/streaming. Rendering a separate placeholder instead of that content wrapper prevents an extra blinking caret beside Generating… without changing the existing answer-caret rules.
7. Existing `styles.test.ts` reads CSS in Node, and `features/chat/integration-tests/welcome-and-safe-render.test.ts` uses `renderToStaticMarkup`. Reuse those techniques; do not mount React or install jsdom/Testing Library.

## File map and ownership

| File | Action | Responsibility |
| --- | --- | --- |
| `frontend/src/components/message-presentation.ts` | Create | Pure live-placeholder and terminal-status selection |
| `frontend/src/components/message-presentation.test.ts` | Create | Complete presentation-table tests in Node |
| `frontend/src/components/MessageItem.tsx` | Modify | Consume helper; top placeholder versus Markdown; terminal markup after content |
| `frontend/src/components/MessageItem.test.ts` | Create | Server-rendered placement, class exclusivity, user/Markdown/Retry regressions |
| `frontend/src/components/Composer.test.ts` | Modify | Existing component smoke plus finalizing lock/terminal unlock coverage |
| `frontend/src/styles/chat.css` | Modify | Word-only shimmer, static fallback, reduced motion |
| `frontend/src/styles/styles.test.ts` | Modify | CSS shimmer/reduced-motion contracts |

Read-only references: `Transcript.tsx`, `chat-reducer.ts`, `chat-types.ts`, `use-chat.ts`, `chat-context.tsx`, `api/client.ts`, `api/protocol.ts`, `index.css`, `vitest.config.ts`, `package.json`. All production logic changes stay in the helper, `MessageItem`, and `chat.css`.

## Command conventions and prerequisites

Run npm commands in `D:\Peter\Aurvin Agent\Aurvin\frontend`; run Git commands in the repository root. On PowerShell, use each displayed command separately, not shell `&&`. Use the repository-supported Node version (`^22.22.3 || ^24.15.0 || >=26.0.0`). Existing `node_modules` can be reused; if absent, run `npm ci` in `frontend` without changing manifests/lockfiles. No service, MongoDB, backend startup, provider credentials, or paid requests are needed.

Before implementation, run `git status --short` and `git diff --cached --name-only`. An existing file that now contains someone else's edits requires coordination before applying the planned replacement. All new source/test files below include the mandatory header; preserve existing headers, updating their descriptions when replacing most of a file.

### Task 1: Encode the presentation contract in one pure helper

**Files:**
- Create: `frontend/src/components/message-presentation.ts`
- Create/test: `frontend/src/components/message-presentation.test.ts`

- [ ] **Step 1: Write the failing presentation-table tests.** Create the complete test file:

```typescript
/**
 * ============================================================================
 * FILE: message-presentation.test.ts
 * LOCATION: frontend/src/components/message-presentation.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify live placeholders and terminal assistant presentation rules.
 *
 * ROLE IN PROJECT:
 *    Exercises the approved presentation table in Node without React or DOM.
 *    Protects durable and user messages from live-only generating labels.
 *
 * KEY COMPONENTS:
 *    - Empty versus non-empty live assistant cases
 *    - Terminal status, live precedence, and user-message cases
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import type { VisibleMessage } from '../api/protocol.ts';
import { getMessagePresentation } from './message-presentation.ts';

const message: VisibleMessage = {
  messageId: 'assistant_1',
  turnId: 'turn_1',
  eventId: 'event_1',
  sequence: 2,
  role: 'assistant',
  content: '',
  createdAt: '2026-10-08T00:00:00Z',
  completionStatus: 'streaming',
  truncated: false,
};

describe('getMessagePresentation', () => {
  it.each(['submitting', 'accepted', 'generating', 'streaming'])(
    'shows the generating class for empty live %s only',
    (status) => {
      expect(getMessagePresentation(message, status)).toEqual({
        generatingClassName: 'aurvin-generating-placeholder',
        terminalStatus: null,
      });
      for (const content of ['H', ' ', '\n', '**Hello**']) {
        expect(getMessagePresentation({ ...message, content }, status)).toEqual({
          generatingClassName: null,
          terminalStatus: null,
        });
      }
    },
  );

  it.each(['finalizing', 'completed', 'idle', 'unknown'])(
    'shows neither placeholder nor badge for %s',
    (status) => {
      for (const content of ['', 'Answer']) {
        expect(getMessagePresentation({ ...message, content }, status)).toEqual({
          generatingClassName: null,
          terminalStatus: null,
        });
      }
    },
  );

  it.each(['truncated', 'cancelled', 'failed', 'interrupted'] as const)(
    'preserves terminal %s for live and durable messages',
    (status) => {
      for (const content of ['', 'Partial answer']) {
        const durable = { ...message, content, completionStatus: status };
        const expected = { generatingClassName: null, terminalStatus: status };
        expect(getMessagePresentation(durable)).toEqual(expected);
        expect(getMessagePresentation({ ...message, content }, status)).toEqual(expected);
      }
    },
  );

  it.each(['accepted', 'streaming', 'completed'] as const)(
    'never shows a generating placeholder on durable %s',
    (completionStatus) => {
      expect(getMessagePresentation({ ...message, completionStatus })).toEqual({
        generatingClassName: null,
        terminalStatus: null,
      });
    },
  );

  it('uses live status rather than a stale durable terminal status', () => {
    expect(getMessagePresentation(
      { ...message, completionStatus: 'truncated' }, 'finalizing',
    )).toEqual({ generatingClassName: null, terminalStatus: null });
  });

  it.each(['accepted', 'generating', 'streaming', 'finalizing', 'cancelled', 'failed'])(
    'does not decorate a user message with %s',
    (status) => {
      expect(getMessagePresentation({ ...message, role: 'user' }, status)).toEqual({
        generatingClassName: null,
        terminalStatus: null,
      });
    },
  );
});
```

Literal emptiness matters: a whitespace token is still received text. Do not use `.trim()` to decide whether generation has begun. Passing `liveStatus` is the live-row marker; a durable `completionStatus='streaming'` is not sufficient.

- [ ] **Step 2: Run the red check.**

```powershell
npm test -- src/components/message-presentation.test.ts
```

Expected: FAIL because `./message-presentation.ts` cannot be resolved. This is the intended red phase, not a dependency or environment failure.

- [ ] **Step 3: Create the complete minimal helper.**

```typescript
/**
 * ============================================================================
 * FILE: message-presentation.ts
 * LOCATION: frontend/src/components/message-presentation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Select live generating placeholders and after-content terminal statuses.
 *
 * ROLE IN PROJECT:
 *    Keeps MessageItem presentation rules pure and testable in Node.
 *    Does not alter lifecycle state, submission locks, or transport contracts.
 *
 * KEY COMPONENTS:
 *    - getMessagePresentation: Live-only placeholder and terminal selection
 * ============================================================================
 */

import type { VisibleMessage } from '../api/protocol.ts';

export function getMessagePresentation(message: VisibleMessage, liveStatus?: string) {
  const status = liveStatus ?? message.completionStatus;
  const isAssistant = message.role === 'assistant';
  const showGenerating = isAssistant && liveStatus !== undefined &&
    message.content.length === 0 &&
    ['submitting', 'accepted', 'generating', 'streaming'].includes(status);

  return {
    generatingClassName: showGenerating ? 'aurvin-generating-placeholder' : null,
    terminalStatus: isAssistant &&
      ['truncated', 'cancelled', 'failed', 'interrupted'].includes(status)
      ? status : null,
  };
}
```

No status enum, generic abstraction, label-copy map, or new dependency is needed. `MessageItem` retains its existing terminal-copy/Retry markup.

- [ ] **Step 4: Verify the helper is green.**

```powershell
npm test -- src/components/message-presentation.test.ts
npm run lint
```

Expected: presentation table passes and lint exits zero. No skipped presentation cases.

- [ ] **Step 5: Commit only the two task files.** From the repository root:

```powershell
git diff --cached --name-only
git add frontend/src/components/message-presentation.ts frontend/src/components/message-presentation.test.ts
git diff --cached --stat
git commit -m "feat(turn-status-ux): define live message presentation rules"
```

### Task 2: Wire MessageItem and prove the existing finalizing send lock

**Files:**
- Modify: `frontend/src/components/MessageItem.tsx:20-91`
- Create/test: `frontend/src/components/MessageItem.test.ts`
- Modify/test: `frontend/src/components/Composer.test.ts`
- Read only: `frontend/src/components/Composer.tsx`, `frontend/src/features/chat/state/chat-reducer.ts`, `frontend/src/features/chat/state/use-chat.ts`

- [ ] **Step 1: Create the failing markup tests.** This supplements, not replaces, the pure table tests. Server rendering performs no React DOM mount and does not run provider effects.

```typescript
/**
 * ============================================================================
 * FILE: MessageItem.test.ts
 * LOCATION: frontend/src/components/MessageItem.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Check placeholder placement and unchanged terminal/user message markup.
 *
 * ROLE IN PROJECT:
 *    Supplements pure presentation tests with static React markup in Node.
 *    Ensures shimmer is attached only to the live generating words.
 *
 * KEY COMPONENTS:
 *    - Top placeholder and first-token removal
 *    - Terminal badge ordering, Retry, and user plaintext preservation
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiClient } from '../api/client.ts';
import type { VisibleMessage } from '../api/protocol.ts';
import { ChatProvider } from '../features/chat/state/chat-context.tsx';
import { MessageItem } from './MessageItem.tsx';

const message: VisibleMessage = {
  messageId: 'assistant_1', turnId: 'turn_1', eventId: 'event_1', sequence: 2,
  role: 'assistant', content: '', createdAt: '2026-10-08T00:00:00Z',
  completionStatus: 'streaming', truncated: false,
};

function renderMessage(overrides: Partial<VisibleMessage> = {}, liveStatus?: string) {
  const client = new ApiClient({ fetch: async () => { throw new Error('No network in markup tests'); } });
  return renderToStaticMarkup(createElement(ChatProvider, {
    client,
    children: createElement(MessageItem, { message: { ...message, ...overrides }, liveStatus }),
  }));
}

describe('MessageItem turn status presentation', () => {
  it.each(['submitting', 'accepted', 'generating', 'streaming'])(
    'puts empty live %s placeholder first without an empty Markdown/caret wrapper',
    (status) => {
      const html = renderMessage({}, status);
      expect(html).toContain(
        '<div class="aurvin-message-body"><span class="aurvin-generating-placeholder">Generating…</span>',
      );
      expect(html).not.toContain('aurvin-message-content');
      expect(html).not.toContain('aurvin-status-badge');
      expect(html).not.toContain('Finalizing…');
    },
  );

  it.each(['accepted', 'generating', 'streaming', 'finalizing'])(
    'shows Markdown without in-flight labels/shimmer after text arrives during %s',
    (status) => {
      const html = renderMessage({ content: '**Answer**' }, status);
      expect(html).toContain('<strong>Answer</strong>');
      expect(html).toContain('aurvin-message-content');
      expect(html).not.toContain('Generating…');
      expect(html).not.toContain('Finalizing…');
      expect(html).not.toContain('aurvin-generating-placeholder');
    },
  );

  it('renders no in-flight label or shimmer even when finalizing is empty', () => {
    const html = renderMessage({}, 'finalizing');
    expect(html).not.toContain('Generating…');
    expect(html).not.toContain('Finalizing…');
    expect(html).not.toContain('aurvin-generating-placeholder');
  });

  it.each([
    ['cancelled', 'Cancelled', false],
    ['failed', 'Generation failed', true],
    ['interrupted', 'Generation interrupted', true],
    ['truncated', 'Response reached maximum length', false],
  ] as const)('keeps %s after partial text and preserves Retry availability', (status, label, retry) => {
    for (const liveStatus of [undefined, status]) {
      const html = renderMessage({ content: 'Partial answer', completionStatus: status }, liveStatus);
      expect(html).toContain(label);
      expect(html.indexOf(label)).toBeGreaterThan(html.indexOf('Partial answer'));
      expect(html.includes('aria-label="Retry generation"')).toBe(retry);
      expect(html).not.toContain('aurvin-generating-placeholder');
    }
  });

  it('leaves completed messages and durable streaming records unlabelled', () => {
    for (const completionStatus of ['completed', 'streaming'] as const) {
      const html = renderMessage({ completionStatus });
      expect(html).not.toContain('aurvin-status-badge');
      expect(html).not.toContain('Generating…');
      expect(html).not.toContain('aurvin-generating-placeholder');
    }
  });

  it('keeps user bubbles as escaped plaintext without assistant decorations', () => {
    const html = renderMessage({ role: 'user', content: '**User** <script>' }, 'generating');
    expect(html).toContain('<div class="aurvin-bubble">**User** &lt;script&gt;</div>');
    expect(html).not.toContain('aurvin-message-body');
    expect(html).not.toContain('Generating…');
    expect(html).not.toContain('aurvin-generating-placeholder');
  });
});
```

- [ ] **Step 2: Run the markup tests red.**

```powershell
npm test -- src/components/MessageItem.test.ts
```

Expected: FAIL on the missing top placeholder and on the old generating/finalizing labels. Existing terminal and user cases should already pass.

- [ ] **Step 3: Replace the imports/component below the existing MessageItem header with this minimal implementation.** Retain its valid file header; update PURPOSE to “Render safe message content with live placeholders and terminal badges.” and the ROLE lines to describe a live-only placeholder and after-content terminal statuses.

```typescript
import type { VisibleMessage } from '../api/protocol.ts';
import { SafeMarkdown } from '../features/chat/markdown/safe-markdown.tsx';
import { useChat } from '../features/chat/state/chat-context.tsx';
import { getMessagePresentation } from './message-presentation.ts';

export function MessageItem({
  message,
  liveStatus,
}: {
  message: VisibleMessage;
  liveStatus?: string;
}) {
  const { actions } = useChat();
  const isUser = message.role === 'user';
  const status = liveStatus ?? message.completionStatus;
  const { generatingClassName, terminalStatus } = getMessagePresentation(message, liveStatus);

  return (
    <article
      className={`aurvin-message ${isUser ? 'aurvin-message-user' : 'aurvin-message-assistant'}`}
      data-role={message.role}
      data-status={status}
    >
      {isUser ? (
        <div className="aurvin-bubble">{message.content}</div>
      ) : (
        <>
          <div className="aurvin-avatar" aria-hidden="true">
            A
          </div>
          <div className="aurvin-message-body">
            {generatingClassName ? (
              <span className={generatingClassName}>Generating…</span>
            ) : (
              <div className="aurvin-message-content">
                <SafeMarkdown content={message.content} />
              </div>
            )}

            {terminalStatus === 'truncated' ? (
              <span className="aurvin-status-badge aurvin-badge-truncated">
                Response reached maximum length
              </span>
            ) : null}

            {terminalStatus === 'cancelled' ? (
              <span className="aurvin-status-badge aurvin-badge-failed">Cancelled</span>
            ) : null}

            {terminalStatus === 'failed' || terminalStatus === 'interrupted' ? (
              <div className="aurvin-retry-row">
                <span className="aurvin-status-badge aurvin-badge-failed">
                  {terminalStatus === 'failed' ? 'Generation failed' : 'Generation interrupted'}
                </span>
                <button
                  type="button"
                  className="aurvin-retry-btn"
                  onClick={() => void actions.retryTurn(message.turnId)}
                  aria-label="Retry generation"
                >
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </article>
  );
}
```

Keep `data-status` unchanged so the original caret still applies to generating/streaming answer content. No `.aurvin-message-content` exists during the placeholder, so the only visual indicator then is the shimmer on the words. The terminal fallback now follows the approved `liveStatus ?? completionStatus` precedence instead of also showing a stale durable truncated badge during a live status.

- [ ] **Step 4: Add regression coverage for the lock, without changing correct production code.** Replace `frontend/src/components/Composer.test.ts` with the following complete test file. The mock is scoped to this test module; the tested reducer and submit action are real.

```typescript
/**
 * ============================================================================
 * FILE: Composer.test.ts
 * LOCATION: frontend/src/components/Composer.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify composer export and send locking through durable finalization.
 *
 * ROLE IN PROJECT:
 *    Exercises actual reducer transitions, static composer markup, and the
 *    real submit action without a browser DOM or network requests.
 *
 * KEY COMPONENTS:
 *    - Finalizing preserves Stop, disabled input, and blocked submission
 *    - Terminal outcomes restore Send
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client.ts';
import { chatReducer, initialChatState } from '../features/chat/state/chat-reducer.ts';
import type { ChatAction, ChatState } from '../features/chat/state/chat-types.ts';
import { useChatActions } from '../features/chat/state/use-chat.ts';
import { Composer } from './Composer.tsx';

const context = vi.hoisted(() => ({ state: {} as ChatState }));
vi.mock('../features/chat/state/chat-context.tsx', () => ({
  useChat: () => ({ state: context.state, actions: {}, dispatch: vi.fn() }),
}));

function acceptedState(): ChatState {
  const submitting = chatReducer(initialChatState, {
    type: 'TURN_SUBMIT_START',
    payload: { userContent: 'First prompt', idempotencyKey: 'key_1' },
  });
  const accepted = chatReducer(submitting, {
    type: 'TURN_ACCEPTED',
    payload: {
      sessionId: 'session_1', turnId: 'turn_1', attemptId: 'attempt_1', userMessageId: 'user_1',
    },
  });
  return chatReducer(accepted, { type: 'SET_DRAFT', payload: 'Follow-up' });
}

function renderComposer(state: ChatState) {
  context.state = state;
  return renderToStaticMarkup(createElement(Composer));
}

describe('Composer component', () => {
  it('is exported as a React functional component', () => {
    expect(typeof Composer).toBe('function');
  });

  it.each(['accepted', 'generating', 'finalizing'] as const)(
    'keeps input and submission locked during %s',
    async (status) => {
      const state = chatReducer(acceptedState(), {
        type: 'STREAM_STATUS', payload: { status, truncated: false },
      });
      expect(state.isStreaming).toBe(true);
      expect(state.isSubmitting).toBe(false);
      const html = renderComposer(state);
      expect(html).toMatch(/<textarea\b[^>]*\bdisabled=""/);
      expect(html).toContain('aria-label="Cancel response"');
      expect(html).not.toContain('aria-label="Send message"');

      const fetchSpy = vi.fn(async () => new Response('', { status: 500 }));
      const client = new ApiClient({ fetch: fetchSpy });
      const dispatch = vi.fn();
      let actions!: ReturnType<typeof useChatActions>;
      function ActionHarness() {
        actions = useChatActions(state, dispatch, client);
        return null;
      }
      renderToStaticMarkup(createElement(ActionHarness));
      await actions.submitMessage();
      await actions.submitMessage('Explicit follow-up');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it('keeps Send disabled during submission before stream acceptance', () => {
    const submitting = chatReducer(initialChatState, {
      type: 'TURN_SUBMIT_START',
      payload: { userContent: 'First prompt', idempotencyKey: 'key_1' },
    });
    const state = chatReducer(submitting, { type: 'SET_DRAFT', payload: 'Follow-up' });
    const html = renderComposer(state);
    expect(html).toMatch(/<button\b[^>]*class="aurvin-send-btn"[^>]*disabled=""/);
  });

  it.each([
    { type: 'STREAM_COMPLETED', payload: { assistantMessageId: 'assistant_1', outcome: 'completed' } },
    { type: 'STREAM_COMPLETED', payload: { assistantMessageId: 'assistant_1', outcome: 'truncated' } },
    { type: 'STREAM_CANCELLED' },
    { type: 'STREAM_ERROR', payload: { code: 'FAILED', message: 'Failed', retryable: true } },
    { type: 'STREAM_INTERRUPTED' },
  ] satisfies ChatAction[])('restores Send only after terminal $type', (action) => {
    const finalizing = chatReducer(acceptedState(), {
      type: 'STREAM_STATUS', payload: { status: 'finalizing', truncated: false },
    });
    const terminal = chatReducer(finalizing, action);
    expect(terminal.isStreaming).toBe(false);
    const html = renderComposer(terminal);
    expect(html).toContain('aria-label="Send message"');
    expect(html).not.toContain('aria-label="Cancel response"');
    expect(html).not.toMatch(/<textarea\b[^>]*\bdisabled=""/);
    expect(html).not.toMatch(/<button\b[^>]*class="aurvin-send-btn"[^>]*disabled=""/);
  });
});
```

The non-empty follow-up ensures the submit test is exercising the streaming guard, not the empty-input guard. This proves the same real action that Enter calls refuses work; static markup proves ordinary keyboard input is disabled. Do not claim this is a browser keyboard-interaction test. Lock tests should pass against today's production code. If they fail, diagnose the specific cause before adding any composer change; do not alter status enums or invent a second lock layer.

- [ ] **Step 5: Run the green and regression checks.**

```powershell
npm test -- src/components/MessageItem.test.ts src/components/message-presentation.test.ts src/components/Composer.test.ts
npm test -- src/components/Transcript.test.ts src/features/chat/state/chat-reducer.test.ts src/features/chat/state/chat-orchestration.test.ts
npm run build
npm run lint
```

Expected: all focused tests pass; build and lint exit zero. CSS animation arrives in Task 3, so the label is not yet visually shimmering. Verify `git diff --name-only` contains no production composer, reducer, transcript, orchestration, or protocol edits.

- [ ] **Step 6: Commit only the three task files.** From the repository root:

```powershell
git diff --cached --name-only
git add frontend/src/components/MessageItem.tsx frontend/src/components/MessageItem.test.ts frontend/src/components/Composer.test.ts
git diff --cached --stat
git commit -m "feat(turn-status-ux): show pre-token placeholder and preserve send lock"
```

### Task 3: Add word-only shimmer with static/reduced-motion fallbacks

**Files:**
- Modify: `frontend/src/styles/chat.css`, insert after `.aurvin-message-content` (`267-270` at planning time)
- Modify/test: `frontend/src/styles/styles.test.ts`, add cases inside its existing `describe`

- [ ] **Step 1: Add these failing CSS contract tests.** Reuse the existing `readFileSync`, `expect`, and `it` imports. Existing styles-test header remains valid; add “Text-only generating shimmer and reduced motion” to KEY COMPONENTS.

```typescript
  it('scopes the generating shine to the placeholder text', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    const base = css.match(/\.aurvin-generating-placeholder\s*\{([^}]*)\}/)?.[1];
    expect(base).toContain('display: inline-block;');
    expect(base).toContain('color: var(--aurvin-text-secondary);');
    expect(base).not.toContain('margin-top:');
    expect(css).toContain('@supports ((background-clip: text) or (-webkit-background-clip: text))');
    const shine = css.match(/\.aurvin-generating-placeholder\s*\{([^}]*animation: aurvin-generating-shimmer[^}]*)\}/)?.[1];
    expect(shine).toContain('background-image: linear-gradient(');
    expect(shine).toContain('background-size: 200% 100%;');
    expect(shine).toContain('background-clip: text;');
    expect(shine).toContain('-webkit-background-clip: text;');
    expect(shine).toContain('animation: aurvin-generating-shimmer 2s linear infinite;');
    expect(css).toMatch(/@keyframes aurvin-generating-shimmer\s*\{\s*from\s*\{\s*background-position: 200% 0;/);
    expect(css).toMatch(/to\s*\{\s*background-position: -200% 0;/);
    const animatedSelectors = [...css.matchAll(/([^{}]+)\{[^{}]*animation: aurvin-generating-shimmer[^{}]*\}/g)]
      .map((match) => match[1].trim());
    expect(animatedSelectors).toEqual(['.aurvin-generating-placeholder']);
  });

  it('makes reduced-motion Generating static and readable', () => {
    const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf-8');
    const reduced = css.match(
      /@media\s*\(prefers-reduced-motion: reduce\)\s*\{\s*\.aurvin-generating-placeholder\s*\{([^}]*)\}/,
    )?.[1];
    expect(reduced).toContain('animation: none;');
    expect(reduced).toContain('background: none;');
    expect(reduced).toContain('color: var(--aurvin-text-secondary);');
    expect(reduced).toContain('-webkit-text-fill-color: currentColor;');
  });
```

These are stylesheet contracts, not pixel/animation tests. MessageItem's separate markup tests prove that only the empty live placeholder receives this class, never Markdown or a terminal badge.

- [ ] **Step 2: Run the CSS tests red.**

```powershell
npm test -- src/styles/styles.test.ts
```

Expected: FAIL for missing `.aurvin-generating-placeholder`, shine support rule, and reduced-motion rule. Existing token/layout cases still pass.

- [ ] **Step 3: Insert this exact CSS after `.aurvin-message-content`.** Leave the caret and terminal-badge rules unchanged. This is a small edit to the existing stylesheet, not a >30% rewrite, so no new file header is required.

```css
.aurvin-generating-placeholder {
  display: inline-block;
  color: var(--aurvin-text-secondary);
}

@supports ((background-clip: text) or (-webkit-background-clip: text)) {
  .aurvin-generating-placeholder {
    background-image: linear-gradient(
      110deg,
      var(--aurvin-text-secondary) 35%,
      var(--aurvin-text-primary) 50%,
      var(--aurvin-text-secondary) 65%
    );
    background-size: 200% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
    animation: aurvin-generating-shimmer 2s linear infinite;
  }
}

@keyframes aurvin-generating-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aurvin-generating-placeholder {
    animation: none;
    background: none;
    color: var(--aurvin-text-secondary);
    -webkit-text-fill-color: currentColor;
  }
}
```

The span is intrinsic-width and the background is clipped to glyphs; no full-width shimmer, bubble animation, icon, pseudo-element, or skeleton. Existing light/dark text tokens provide both themes. Browsers without text clipping get readable static words; reduced-motion browsers explicitly get the same static words even when text clipping is supported.

- [ ] **Step 4: Run focused and complete frontend verification.**

```powershell
npm test -- src/styles/styles.test.ts src/components/MessageItem.test.ts src/components/message-presentation.test.ts src/components/Composer.test.ts
npm test
npm run lint
npm run build
```

Expected: focused tests and the full frontend suite pass, with no new skipped cases; lint/build exit zero. Record actual counts and any existing failures/skips separately. Do not use backend tests as evidence for this UI-only work.

- [ ] **Step 5: Commit only the CSS task files.** From the repository root:

```powershell
git diff --cached --name-only
git add frontend/src/styles/chat.css frontend/src/styles/styles.test.ts
git diff --cached --stat
git commit -m "feat(turn-status-ux): shimmer generating text with reduced motion"
```

## Final verification handoff (no fourth implementation task)

- [ ] Re-run the full frontend checks on the assembled three-commit set if the checkout changed after Task 3; report actual commit hashes, Node version, commands, results, failures, and skips to the orchestrator.
- [ ] Inspect `git diff <implementation-base>..HEAD --name-only` using the actual pre-worker commit hash captured before Task 1; the implementation diff must contain exactly the seven owned files listed in the file map. Do not include unrelated existing working-tree edits in the implementation report.
- [ ] Confirm no rendered `Finalizing…`, `aurvin-badge-finalizing`, or `aurvin-badge-generating` remains in `MessageItem.tsx`; tests may retain the strings as negative assertions. Confirm Retry still calls `actions.retryTurn(message.turnId)` and existing caret selectors are unchanged.
- [ ] If an already-authorized local deterministic UI fixture is available, visually check empty accepted/generating, first token, finalizing, and terminal states at desktop/mobile widths and light/dark themes; emulate reduced motion and confirm static Generating… stays readable. Do not start a live paid turn or provision a backend to obtain a screenshot. If no authorized fixture/browser check is available, report visual verification **unrun**; static markup/CSS checks do not prove rendered pixels.
- [ ] Orchestrator maintains `docs/turn-status-ux/state.md` and writes `docs/turn-status-ux/final_report.md`; do not mark completion based solely on implementation existence. Review is **skipped**.

## Acceptance coverage

| Criterion | Task and evidence |
| --- | --- |
| AC1 empty live Generating… at top | Task 1 table + Task 2 first-child markup assertions |
| AC1b word-only shimmer/static reduced motion | Task 1 class selection + Task 2 class exclusivity + Task 3 CSS contracts |
| AC2 first text removes label/shimmer | Task 1 includes whitespace tokens + Task 2 non-empty Markdown cases |
| AC3 finalizing never has either in-flight label | Task 1 finalizing empty/non-empty + Task 2 negative markup assertions |
| AC4 lock through finalizing | Task 2 real acceptance/status transitions, disabled textarea/Stop markup, real submit-action refusal with non-empty input, all terminal unlock cases |
| AC5 cancelled after text | Task 1 terminal table + Task 2 live/durable badge ordering |
| AC6 failed/interrupted badge and Retry after text | Task 1 terminal table + Task 2 Retry availability/order; callback remains unchanged |
| AC7 truncation copy after text | Task 1 terminal table + Task 2 exact copy/order |
| AC8 completed has no badge | Task 1 completed cases + Task 2 completed markup |
| AC9 user/Markdown/caret/Retry unchanged | Task 2 user plaintext and Markdown tests; production caret and Retry callback retained; existing frontend suites |

## Plan self-check

- All goal presentation rows are covered, including live accepted/submitting, durable streaming without a placeholder, literal whitespace first tokens, and empty finalizing.
- All defined names and imports are consistent: `getMessagePresentation` returns `generatingClassName` and `terminalStatus`; shimmer class is exclusively `aurvin-generating-placeholder`.
- Every implementation task includes concrete red test code, its command/expected failure, exact minimal implementation, green commands, named staging paths, and a commit message. Correct existing composer behavior receives passing regression checks within Task 2, not gratuitous lock changes.
- No backend or orchestration source edit, new dependency, React DOM mount, hidden paid test, or change to protocol/status enums is planned.
