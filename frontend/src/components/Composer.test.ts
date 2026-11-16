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
 *    - Finalizing preserves Stop and blocked submission; input stays editable
 *    - Terminal outcomes restore Send
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client.ts';
import { chatReducer, initialChatState } from '../features/chat/state/chat-reducer.ts';
import type { ChatAction, ChatState } from '../features/chat/state/chat-types.ts';
import { useChatActions } from '../features/chat/state/use-chat.ts';
import { Composer } from './Composer.tsx';

const dictation = vi.hoisted(() => ({ current: {
  config: null, locked: false, phase: 'idle', status: '', notice: null,
  start: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
} as { config: import('../api/voice-protocol.ts').PublicVoiceConfig | null;
  locked: boolean; phase: string; status: string; notice: string | null;
  start: () => void; stop: () => void; cancel: () => void } }));
vi.mock('../features/voice/dictation/useDictation.ts', () => ({ useDictation: () => dictation.current }));

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
  beforeEach(() => {
    dictation.current.locked = false;
    dictation.current.phase = 'idle';
    dictation.current.status = '';
    dictation.current.config = null;
    dictation.current.notice = null;
  });

  it.each(['centered', 'docked'] as const)('keeps %s composer visible/read-only and Send disabled through dictation', variant => {
    for (const phase of ['requesting_permission', 'connecting', 'recording', 'finalizing']) {
      context.state = { ...initialChatState, draftInput: 'Review me',
        voiceInput: { token: 'lease-1', mode: 'dictation' } };
      dictation.current.locked = true;
      dictation.current.phase = phase;
      dictation.current.status = phase;
      const html = renderToStaticMarkup(createElement(Composer, { variant }));
      expect(html).toContain(`aurvin-composer-${variant}`);
      expect(html).toMatch(/<textarea[^>]*readOnly=""/);
      expect(html).not.toMatch(/<textarea[^>]*disabled=""/);
      expect(html).toContain('Review me');
      expect(html).toMatch(/<button[^>]*class="aurvin-send-btn"[^>]*disabled=""/);
      expect(html).toContain('aria-label="Cancel dictation"');
    }
  });

  it('is exported as a React functional component', () => {
    expect(typeof Composer).toBe('function');
  });


  it.each(['accepted', 'generating', 'finalizing'] as const)(
    'keeps submission locked and input editable during %s',
    async (status) => {
      const state = chatReducer(acceptedState(), {
        type: 'STREAM_STATUS', payload: { status, truncated: false },
      });
      expect(state.isStreaming).toBe(true);
      expect(state.isSubmitting).toBe(false);
      const html = renderComposer(state);
      expect(html).not.toMatch(/<textarea\b[^>]*\bdisabled=""/);
      expect(html).toContain('Follow-up');
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
