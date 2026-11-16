/**
 * ============================================================================
 * FILE: calendar-chat-state.test.ts
 * LOCATION: frontend/src/features/chat/state/calendar-chat-state.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Test suite for Calendar clarification routing and session/attempt/sequence fencing in chat state.
 *
 * ROLE IN PROJECT:
 *    Verifies that calendar proposals, operations, and progress events are strictly fenced
 *    to active turn/session/attempt and monotonically increasing sequences without affecting drafts.
 *
 * KEY COMPONENTS:
 *    - activeState: Test fixture providing an active streaming chat state.
 *    - chatReducer: Tests CALENDAR_CLARIFICATION, CALENDAR_OPERATION, and NEW_CHAT behavior.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { chatReducer, initialChatState } from './chat-reducer.ts';
import type { ChatState } from './chat-types.ts';
import {
  clarification,
  createdOperation,
} from '../../plugins/google-calendar/testing/multi-calendar-fixtures.ts';
import { agenda } from '../../canvas/testing/calendar-view-fixtures.ts';

const activeState = (): ChatState => ({
  ...initialChatState,
  activeSessionId: 'session-1',
  activeTurnId: 'turn-1',
  activeAttemptId: 'attempt-1',
  isStreaming: true,
  draftInput: 'Keep my draft',
});

describe('calendar-chat-state routing and fencing', () => {
  it('stores one current clarification without generating approval or changing the draft', () => {
    const state = chatReducer(activeState(), {
      type: 'CALENDAR_CLARIFICATION',
      payload: {
        sessionId: 'session-1',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        sequence: 3,
        clarification: clarification(),
      },
    });
    expect(state.calendarClarification?.event.reason).toBe('conflict');
    expect(state.draftInput).toBe('Keep my draft');
    expect(state.calendarOperationsByTurn).toEqual({});
  });

  it('ignores wrong-session, old-attempt and duplicate Calendar stream responses', () => {
    const state = activeState();
    for (const patch of [
      { sessionId: 'other-session' },
      { attemptId: 'old-attempt' },
      { turnId: 'old-turn' },
    ]) {
      expect(
        chatReducer(state, {
          type: 'CALENDAR_OPERATION',
          payload: {
            sessionId: 'session-1',
            turnId: 'turn-1',
            attemptId: 'attempt-1',
            sequence: 4,
            operation: createdOperation(),
            ...patch,
          },
        }),
      ).toBe(state);
    }
    const accepted = chatReducer(state, {
      type: 'CALENDAR_OPERATION',
      payload: {
        sessionId: 'session-1',
        turnId: 'turn-1',
        attemptId: 'attempt-1',
        sequence: 4,
        operation: createdOperation(),
      },
    });
    expect(
      chatReducer(accepted, {
        type: 'CALENDAR_OPERATION',
        payload: {
          sessionId: 'session-1',
          turnId: 'turn-1',
          attemptId: 'attempt-1',
          sequence: 4,
          operation: { ...createdOperation(), state: 'unknown', receipt: null },
        },
      }),
    ).toBe(accepted);
  });

  it('preserves the durable original target after narration failure and a new chat keeps only the draft', () => {
    let state = chatReducer(activeState(), {
      type: 'CALENDAR_OPERATION',
      payload: {
        turnId: 'turn-1',
        operation: { ...createdOperation(), narration: 'pending' },
      },
    });
    state = chatReducer(state, {
      type: 'STREAM_ERROR',
      payload: {
        code: 'PROVIDER_ERROR',
        message: 'Narration failed',
        retryable: true,
      },
    });
    expect(state.calendarOperationsByTurn['turn-1']?.receipt).toMatchObject({
      calendarLabel: 'Original Team',
    });
    const reset = chatReducer(state, { type: 'NEW_CHAT' });
    expect(reset.calendarClarification).toBeNull();
    expect(reset.calendarOperationsByTurn).toEqual({});
    expect(reset.draftInput).toBe('Keep my draft');
  });

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
});
