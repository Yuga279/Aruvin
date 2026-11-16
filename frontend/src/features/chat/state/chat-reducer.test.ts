/**
 * ============================================================================
 * FILE: chat-reducer.test.ts
 * LOCATION: frontend/src/features/chat/state/chat-reducer.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for chat reducer state transitions and ordering rules.
 *
 * ROLE IN PROJECT:
 *    Proves new-chat emptiness, stable session sort, streaming accumulation,
 *    and draft restoration without React or network dependencies.
 *
 * KEY COMPONENTS:
 *    - NEW_CHAT, SESSIONS_LOADED, STREAM_*, and TURN_SUBMIT_ERROR cases.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { chatReducer, initialChatState } from './chat-reducer.ts';
import type { ChatState } from './chat-types.ts';

describe('chatReducer', () => {
  it('replaces provisional calendar preambles with authoritative answer chunks', () => {
    let state = chatReducer(initialChatState, { type: 'STREAM_DELTA', payload: { text: 'Checking…' } });
    state = chatReducer(state, { type: 'STREAM_DELTA', payload: { text: 'You own ', reset: true } });
    state = chatReducer(state, { type: 'STREAM_DELTA', payload: { text: 'Personal.' } });
    state = chatReducer(state, { type: 'STREAM_COMPLETED', payload: {
      assistantMessageId: 'assistant-calendar', outcome: 'completed',
    } });
    expect(state.messages.at(-1)?.content).toBe('You own Personal.');
  });

  it('keeps a completed answer when flushed text arrives in the same action as completion', () => {
    const state = chatReducer(initialChatState, {
      type: 'STREAM_COMPLETED',
      payload: {
        assistantMessageId: 'assistant-created',
        outcome: 'completed',
        text: 'Created "Ball" from 2026-10-31T16:00:00+05:30 to 2026-10-31T19:00:00+05:30 (Asia/Kolkata).',
        reset: true,
      },
    });
    expect(state.messages.at(-1)?.content).toContain('Created "Ball"');
    expect(state.streamText).toBe('');
    expect(state.isStreaming).toBe(false);
  });
  it('pins older chats first, updates the selected title, and clears deleted selection', () => {
    const old = { sessionId: 'old', title: 'Old', createdAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-01T00:00:00Z' };
    const recent = { ...old, sessionId: 'recent', lastActivityAt: '2026-10-08T00:00:00Z' };
    let state = { ...initialChatState, sessions: [recent, old], activeSessionId: 'old' };
    state = chatReducer(state, { type: 'SESSION_UPDATED', payload: { ...old, pinned: true, title: 'Renamed' } }) as typeof state;
    expect(state.sessions.map(s => s.sessionId)).toEqual(['old', 'recent']);
    expect(state.activeSessionTitle).toBe('Renamed');
    const unpinned = chatReducer(state, { type: 'SESSION_UPDATED', payload: { ...old, pinned: false } });
    expect(unpinned.sessions.map(s => s.sessionId)).toEqual(['recent', 'old']);
    const deleted = chatReducer(state, { type: 'SESSION_DELETED', payload: 'old' });
    expect(deleted.activeSessionId).toBeNull();
    expect(deleted.messages).toEqual([]);
    expect(deleted.sessions.map(s => s.sessionId)).toEqual(['recent']);
  });
  it('handles NEW_CHAT by clearing active session and messages without mutation', () => {
    const modifiedState: ChatState = {
      ...initialChatState,
      activeSessionId: 'sess_123',
      messages: [
        {
          messageId: 'msg_1',
          turnId: 'turn_1',
          eventId: 'evt_1',
          sequence: 1,
          role: 'user',
          content: 'Hello',
          createdAt: '2026-10-06T12:00:00Z',
          completionStatus: 'completed',
          truncated: false,
        },
      ],
      draftInput: 'Draft unsent',
    };

    const nextState = chatReducer(modifiedState, { type: 'NEW_CHAT' });
    expect(nextState.activeSessionId).toBeNull();
    expect(nextState.messages).toEqual([]);
    expect(nextState.activeTurnId).toBeNull();
    expect(nextState.turnStatus).toBe('idle');
    expect(modifiedState.activeSessionId).toBe('sess_123');
  });

  it('orders sessions by lastActivityAt DESC with sessionId tie-breaker', () => {
    const rawSessions = [
      {
        sessionId: 'sess_b',
        title: 'B',
        createdAt: '2026-10-06T10:00:00Z',
        lastActivityAt: '2026-10-06T11:00:00Z',
      },
      {
        sessionId: 'sess_a',
        title: 'A',
        createdAt: '2026-10-06T10:00:00Z',
        lastActivityAt: '2026-10-06T12:00:00Z',
      },
      {
        sessionId: 'sess_c',
        title: 'C',
        createdAt: '2026-10-06T10:00:00Z',
        lastActivityAt: '2026-10-06T11:00:00Z',
      },
    ];

    const nextState = chatReducer(initialChatState, {
      type: 'SESSIONS_LOADED',
      payload: { items: rawSessions, nextCursor: null },
    });

    expect(nextState.sessions.map((s) => s.sessionId)).toEqual([
      'sess_a',
      'sess_c',
      'sess_b',
    ]);
  });

  it('appends streaming delta and tracks generating status', () => {
    const s1 = chatReducer(initialChatState, {
      type: 'TURN_SUBMIT_START',
      payload: { userContent: 'Hi', idempotencyKey: 'key_1' },
    });

    const s2 = chatReducer(s1, {
      type: 'STREAM_STATUS',
      payload: { status: 'generating', truncated: false },
    });
    expect(s2.turnStatus).toBe('generating');

    const s3 = chatReducer(s2, {
      type: 'STREAM_DELTA',
      payload: { text: 'Hello' },
    });
    expect(s3.streamText).toBe('Hello');

    const s4 = chatReducer(s3, {
      type: 'STREAM_DELTA',
      payload: { text: ' world' },
    });
    expect(s4.streamText).toBe('Hello world');
  });

  it('omits the user bubble for hidden calendar confirmation replies', () => {
    const started = chatReducer(initialChatState, {
      type: 'TURN_SUBMIT_START',
      payload: { userContent: 'yes', idempotencyKey: 'cal-yes', hideFromTranscript: true },
    });
    expect(started.messages).toEqual([]);
    expect(started.isSubmitting).toBe(true);

    const accepted = chatReducer(started, {
      type: 'TURN_ACCEPTED',
      payload: {
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
        userMessageId: 'msg_yes',
      },
    });
    expect(accepted.messages).toEqual([]);
    expect(accepted.isStreaming).toBe(true);
  });

  it('preserves draft input on submit error', () => {
    const stateWithDraft: ChatState = {
      ...initialChatState,
      draftInput: 'Important prompt that failed',
    };

    const s1 = chatReducer(stateWithDraft, {
      type: 'TURN_SUBMIT_START',
      payload: { userContent: 'Important prompt that failed', idempotencyKey: 'k' },
    });
    expect(s1.draftInput).toBe('');

    const s2 = chatReducer(s1, {
      type: 'TURN_SUBMIT_ERROR',
      payload: {
        error: { code: 'NETWORK_ERROR', message: 'Failed to send', retryable: true },
        preservedContent: 'Important prompt that failed',
      },
    });

    expect(s2.draftInput).toBe('Important prompt that failed');
    expect(s2.turnError?.code).toBe('NETWORK_ERROR');
  });

  it('handles VOICE_SESSION_COMMITTED by immediately appending a provisional voice message with duration', () => {
    const s1 = chatReducer(initialChatState, {
      type: 'VOICE_SESSION_COMMITTED',
      payload: {
        sessionId: 'chat-1',
        voiceSessionId: 'voice-call-1',
        durationSeconds: 45,
        createdAt: '2026-10-15T12:00:00.000Z',
      },
    });

    expect(s1.activeSessionId).toBe('chat-1');
    expect(s1.messages).toHaveLength(1);
    expect(s1.messages[0].voiceSessionId).toBe('voice-call-1');
    expect(s1.messages[0].voiceDurationSeconds).toBe(45);
    expect(s1.messages[0].messageId).toBe('voice_provisional_voice-call-1');
  });

  it('retains pending provisional voice messages in MESSAGES_LOADED until matching server messages arrive', () => {
    const stateWithProvisional: ChatState = {
      ...initialChatState,
      activeSessionId: 'chat-1',
      messages: [
        {
          messageId: 'voice_provisional_v1',
          turnId: 'turn_v1',
          eventId: 'evt_v1',
          sequence: 1,
          role: 'assistant',
          content: '',
          createdAt: '2026-10-15T12:00:00.000Z',
          completionStatus: 'completed',
          truncated: false,
          mode: 'live',
          voiceSessionId: 'v1',
          voiceDurationSeconds: 30,
        },
      ],
    };

    // 1. Server returns text message, but v1 is still pending async write on server
    const s1 = chatReducer(stateWithProvisional, {
      type: 'MESSAGES_LOADED',
      payload: {
        items: [
          {
            messageId: 'text_1',
            turnId: 't1',
            eventId: 'e1',
            sequence: 1,
            role: 'user',
            content: 'Hello',
            createdAt: '2026-10-15T11:59:00.000Z',
            completionStatus: 'completed',
            truncated: false,
          },
        ],
        nextCursor: null,
        olderAvailable: false,
      },
    });

    // Provisional message is preserved
    expect(s1.messages).toHaveLength(2);
    expect(s1.messages[0].messageId).toBe('text_1');
    expect(s1.messages[1].messageId).toBe('voice_provisional_v1');

    // 2. Server later returns the actual v1 message
    const s2 = chatReducer(s1, {
      type: 'MESSAGES_LOADED',
      payload: {
        items: [
          {
            messageId: 'text_1',
            turnId: 't1',
            eventId: 'e1',
            sequence: 1,
            role: 'user',
            content: 'Hello',
            createdAt: '2026-10-15T11:59:00.000Z',
            completionStatus: 'completed',
            truncated: false,
          },
          {
            messageId: 'msg_v1_server',
            turnId: 'turn_v1',
            eventId: 'evt_v1',
            sequence: 2,
            role: 'assistant',
            content: '',
            createdAt: '2026-10-15T12:00:00.000Z',
            completionStatus: 'completed',
            truncated: false,
            voiceSessionId: 'v1',
          },
        ],
        nextCursor: null,
        olderAvailable: false,
      },
    });

    // Provisional message is replaced by server message
    expect(s2.messages).toHaveLength(2);
    expect(s2.messages.map((m) => m.messageId)).toEqual(['text_1', 'msg_v1_server']);
  });

  it('tracks Calendar progress, preserves durable receipts across failed/interrupted narration, and resets session Calendar state on NEW_CHAT while keeping draftInput', () => {
    let state: ChatState = {
      ...initialChatState,
      activeSessionId: 'sess_cal',
      activeTurnId: 'turn_cal_1',
      isStreaming: true,
      turnStatus: 'generating',
      draftInput: 'Keep this unsent draft',
    };

    state = chatReducer(state, {
      type: 'CALENDAR_PROGRESS',
      payload: { turnId: 'turn_cal_1', phase: 'repairing' },
    });
    expect(state.calendarProgress).toBe('repairing');

    const receiptOp = {
      operationId: 'op_1',
      state: 'succeeded' as const,
      narration: 'pending' as const,
      retryAction: 'none' as const,
      receipt: {
        durable: true as const,
        eventId: 'evt_cal_999',
        htmlLink: 'https://www.google.com/calendar/event?eid=999',
        expiresAt: '2026-10-22T00:00:00.000Z',
      },
    };

    state = chatReducer(state, {
      type: 'CALENDAR_OPERATION',
      payload: { turnId: 'turn_cal_1', operation: receiptOp },
    });
    expect(state.calendarProgress).toBeNull();
    expect(state.calendarOperationsByTurn['turn_cal_1']?.receipt?.eventId).toBe('evt_cal_999');

    // Final narration fails after Calendar write succeeded
    state = chatReducer(state, {
      type: 'STREAM_ERROR',
      payload: { code: 'PROVIDER_ERROR', message: 'Narration failed', retryable: true },
    });
    expect(state.turnStatus).toBe('failed');
    expect(state.calendarOperationsByTurn['turn_cal_1']).toEqual({
      ...receiptOp,
      narration: 'failed',
    });

    // NEW_CHAT resets session Calendar state without losing draftInput
    const reset = chatReducer(state, { type: 'NEW_CHAT' });
    expect(reset.activeSessionId).toBeNull();
    expect(reset.calendarProgress).toBeNull();
    expect(reset.calendarOperationsByTurn).toEqual({});
    expect(reset.calendarTurnOrder).toEqual([]);
    expect(reset.draftInput).toBe('Keep this unsent draft');
  });
});
