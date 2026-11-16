/**
 * ============================================================================
 * FILE: composer-followup-draft.test.ts
 * LOCATION: frontend/src/components/composer-followup-draft.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Regression: text drafting stays available during stream/finalization.
 *
 * ROLE IN PROJECT:
 *    Worker 3 AC1 check that the textarea is editable while Send stays gated
 *    until durable terminal/release, without queued send or voice lock bypass.
 *
 * KEY COMPONENTS:
 *    - Streaming/finalizing markup: enabled textarea, Cancel not Send
 *    - Voice readOnly exclusivity and Enter/Shift+Enter/IME while busy
 * ============================================================================
 */

import { Children, createElement, isValidElement, type KeyboardEvent, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useRef: () => ({ current: null }), useEffect: () => {} };
});
import { ApiClient } from '../api/client.ts';
import { chatReducer, initialChatState } from '../features/chat/state/chat-reducer.ts';
import type { ChatAction, ChatState } from '../features/chat/state/chat-types.ts';
import { useChatActions } from '../features/chat/state/use-chat.ts';
import { Composer } from './Composer.tsx';

const dictation = vi.hoisted(() => ({
  current: {
    config: null,
    locked: false,
    phase: 'idle',
    status: '',
    notice: null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  } as {
    config: import('../api/voice-protocol.ts').PublicVoiceConfig | null;
    locked: boolean;
    phase: string;
    status: string;
    notice: string | null;
    start: () => void;
    stop: () => void;
    cancel: () => void;
  },
}));
vi.mock('../features/voice/dictation/useDictation.ts', () => ({
  useDictation: () => dictation.current,
}));

const context = vi.hoisted(() => ({
  state: {} as ChatState,
  submit: vi.fn(),
  dispatch: vi.fn(),
  voiceLocked: false,
}));
vi.mock('../features/chat/state/chat-context.tsx', () => ({
  useChat: () => ({
    state: context.state,
    actions: {
      submitMessage: context.submit,
      isVoiceInputLocked: () => context.voiceLocked,
      cancelCurrentTurn: vi.fn(),
    },
    dispatch: context.dispatch,
  }),
}));

function acceptedWithDraft(draft = 'Follow-up while streaming'): ChatState {
  const submitting = chatReducer(initialChatState, {
    type: 'TURN_SUBMIT_START',
    payload: { userContent: 'First prompt', idempotencyKey: 'key_1' },
  });
  const accepted = chatReducer(submitting, {
    type: 'TURN_ACCEPTED',
    payload: {
      sessionId: 'session_1',
      turnId: 'turn_1',
      attemptId: 'attempt_1',
      userMessageId: 'user_1',
    },
  });
  return chatReducer(accepted, { type: 'SET_DRAFT', payload: draft });
}

type Props = {
  children?: import('react').ReactNode;
  'aria-label'?: string;
  disabled?: boolean;
  readOnly?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
};

function elements(element: ReactElement): ReactElement<Props>[] {
  // Follow the context wrapper's memoized view; hooks are stubbed above.
  if (typeof element.type === 'object' && 'type' in element.type) {
    return elements((element.type as { type: (props: unknown) => ReactElement }).type(element.props));
  }
  const own = element as ReactElement<Props>;
  return [
    own,
    ...Children.toArray(own.props.children).flatMap((child) =>
      isValidElement(child) ? elements(child as ReactElement) : [],
    ),
  ];
}

function enter(key = 'Enter', shiftKey = false, isComposing = false) {
  const preventDefault = vi.fn();
  const event = { key, shiftKey, nativeEvent: { isComposing }, preventDefault };
  return { event: event as unknown as KeyboardEvent<HTMLTextAreaElement>, preventDefault };
}

function renderComposer(state: ChatState) {
  context.state = state;
  return renderToStaticMarkup(createElement(Composer));
}

describe('composer follow-up drafting during generation', () => {
  beforeEach(() => {
    dictation.current.locked = false;
    dictation.current.phase = 'idle';
    dictation.current.status = '';
    dictation.current.config = null;
    dictation.current.notice = null;
    context.submit.mockReset();
    context.dispatch.mockReset();
    context.voiceLocked = false;
  });

  it.each(['accepted', 'generating', 'finalizing'] as const)(
    'keeps the textarea editable and Send replaced by Cancel during %s',
    async (status) => {
      const state = chatReducer(acceptedWithDraft(), {
        type: 'STREAM_STATUS',
        payload: { status, truncated: false },
      });
      expect(state.isStreaming).toBe(true);
      const html = renderComposer(state);
      expect(html).toContain('Follow-up while streaming');
      expect(html).not.toMatch(/<textarea\b[^>]*\bdisabled="/);
      expect(html).not.toMatch(/<textarea\b[^>]*\breadOnly="/);
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

  it('keeps dictation/live readOnly exclusivity while a response is streaming', () => {
    dictation.current.locked = true;
    dictation.current.phase = 'recording';
    const html = renderComposer({
      ...acceptedWithDraft('Dictation draft'),
      voiceInput: { token: 'lease-1', mode: 'dictation' },
    });
    expect(html).toMatch(/<textarea[^>]*readOnly=""/);
    expect(html).not.toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toContain('Dictation draft');
  });

  it('does not send on Enter/Shift+Enter/IME while streaming, and restores Send after terminal', () => {
    const streaming = chatReducer(acceptedWithDraft('Ready to send'), {
      type: 'STREAM_STATUS',
      payload: { status: 'generating', truncated: false },
    });
    context.state = streaming;
    const nodes = elements(Composer({}) as ReactElement);
    const input = nodes.find((node) => node.props['aria-label'] === 'Message input')!;
    const shift = enter('Enter', true);
    const ime = enter('Enter', false, true);
    const sendKey = enter();
    input.props.onKeyDown!(shift.event);
    input.props.onKeyDown!(ime.event);
    input.props.onKeyDown!(sendKey.event);
    expect(shift.preventDefault).not.toHaveBeenCalled();
    expect(ime.preventDefault).not.toHaveBeenCalled();
    expect(sendKey.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.submit).not.toHaveBeenCalled();

    input.props.onChange!({ target: { value: 'typed during stream' } });
    expect(context.dispatch).toHaveBeenCalledWith({
      type: 'SET_DRAFT',
      payload: 'typed during stream',
    });

    const terminals: ChatAction[] = [
      { type: 'STREAM_COMPLETED', payload: { assistantMessageId: 'assistant_1', outcome: 'completed' } },
      { type: 'STREAM_CANCELLED' },
      { type: 'STREAM_ERROR', payload: { code: 'FAILED', message: 'Failed', retryable: true } },
      { type: 'STREAM_INTERRUPTED' },
    ];
    for (const action of terminals) {
      const drafted = { ...streaming, draftInput: 'Keep me' };
      const terminal = chatReducer(drafted, action);
      expect(terminal.isStreaming).toBe(false);
      expect(terminal.draftInput).toBe('Keep me');
      const html = renderComposer(terminal);
      expect(html).toContain('Keep me');
      expect(html).toContain('aria-label="Send message"');
      expect(html).not.toContain('aria-label="Cancel response"');
      expect(html).not.toMatch(/<textarea\b[^>]*\bdisabled="/);
    }
  });
});
