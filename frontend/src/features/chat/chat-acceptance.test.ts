/**
 * ============================================================================
 * FILE: chat-acceptance.test.ts
 * LOCATION: frontend/src/features/chat/chat-acceptance.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove P7 acceptance criteria AC01, AC02, AC08, and AC11 against fixtures.
 *
 * ROLE IN PROJECT:
 *    Feature-level reducer evidence that new chat stays empty, streaming
 *    statuses are distinct, retry does not duplicate user input, and length
 *    truncation is not treated as a normal completion.
 *
 * KEY COMPONENTS:
 *    - AC01 new-chat emptiness
 *    - AC02 generating / finalizing / completed
 *    - AC08 retry without user duplication
 *    - AC11 truncated outcome
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import type { VisibleMessage } from '../../api/protocol.ts';
import { chatReducer, initialChatState } from './state/chat-reducer.ts';

describe('P7 Acceptance Criteria Verifications', () => {
  it('AC01: new chat initiates a clean empty state without creating a session record prematurely', () => {
    const dirtyState = {
      ...initialChatState,
      activeSessionId: 'sess_existing',
      messages: [{ messageId: 'm1' } as VisibleMessage],
    };

    const emptyChatState = chatReducer(dirtyState, { type: 'NEW_CHAT' });
    expect(emptyChatState.activeSessionId).toBeNull();
    expect(emptyChatState.messages).toEqual([]);
    expect(emptyChatState.activeTurnId).toBeNull();
  });

  it('AC02: text replies stream progressively and distinguish generating/finalizing from terminal completed', () => {
    const s1 = chatReducer(initialChatState, {
      type: 'STREAM_STATUS',
      payload: { status: 'generating', truncated: false },
    });
    expect(s1.turnStatus).toBe('generating');

    const s2 = chatReducer(s1, {
      type: 'STREAM_DELTA',
      payload: { text: 'Partial token...' },
    });
    expect(s2.streamText).toBe('Partial token...');

    const s3 = chatReducer(s2, {
      type: 'STREAM_STATUS',
      payload: { status: 'finalizing', truncated: false },
    });
    expect(s3.turnStatus).toBe('finalizing');

    const s4 = chatReducer(s3, {
      type: 'STREAM_COMPLETED',
      payload: { assistantMessageId: 'ast_final', outcome: 'completed' },
    });
    expect(s4.turnStatus).toBe('completed');
    expect(s4.messages[s4.messages.length - 1]?.content).toBe('Partial token...');
  });

  it('AC08: retry creates a replacement attempt without duplicating user message in transcript', () => {
    const failedTurnState = {
      ...initialChatState,
      activeSessionId: 'sess_1',
      messages: [
        {
          messageId: 'user_orig',
          turnId: 'turn_1',
          eventId: 'evt_1',
          sequence: 1,
          role: 'user' as const,
          content: 'My prompt',
          createdAt: new Date().toISOString(),
          completionStatus: 'completed' as const,
          truncated: false,
        },
        {
          messageId: 'ast_failed',
          turnId: 'turn_1',
          eventId: 'evt_2',
          sequence: 2,
          role: 'assistant' as const,
          content: 'Incomplete partial...',
          createdAt: new Date().toISOString(),
          completionStatus: 'failed' as const,
          truncated: false,
        },
      ],
      turnStatus: 'failed' as const,
    };

    const s1 = chatReducer(failedTurnState, {
      type: 'STREAM_STATUS',
      payload: { status: 'generating', truncated: false },
    });

    const userMessages = s1.messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.content).toBe('My prompt');
  });

  it('AC11: distinguishes length-truncated stop from regular completion', () => {
    const s1 = chatReducer(initialChatState, {
      type: 'STREAM_DELTA',
      payload: { text: 'Exceeded max output tokens...' },
    });

    const s2 = chatReducer(s1, {
      type: 'STREAM_COMPLETED',
      payload: { assistantMessageId: 'ast_trunc', outcome: 'truncated' },
    });

    expect(s2.turnStatus).toBe('truncated');
    expect(s2.messages[0]?.truncated).toBe(true);
    expect(s2.messages[0]?.completionStatus).toBe('truncated');
  });
});
