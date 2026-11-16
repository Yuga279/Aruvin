/**
 * ============================================================================
 * FILE: memory-save-state.test.ts
 * LOCATION: frontend/src/features/chat/state/memory-save-state.test.ts
 * PURPOSE: Verify independent save facts and stale navigation reconciliation.
 * ROLE IN PROJECT: Pure reducer tests for pending memory chat UI behavior.
 * KEY COMPONENTS: Optimistic sidebar, version ordering and unsaved history.
 * ============================================================================
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ApiClient } from '../../../api/client.ts';
import { parseVoiceControl } from '../../../api/voice-protocol.ts';
import { Composer } from '../../../components/Composer.tsx';
import { Sidebar } from '../../../components/Sidebar.tsx';
import { Transcript } from '../../../components/Transcript.tsx';
import { ChatView } from '../ChatView.tsx';
import { initialLiveVoice } from '../../voice/state/live-voice-reducer.ts';
import type { LiveVoiceSurface } from '../../voice/state/useLiveVoice.ts';
import { chatReducer, initialChatState } from './chat-reducer.ts';
import type { ChatAction, ChatState } from './chat-types.ts';
import {
  startRestoredBusyPollEffect,
  startSavePollEffect,
  useChatActions,
} from './use-chat.ts';

const context = vi.hoisted(() => ({
  state: {} as ChatState,
  dispatch: vi.fn(),
  actions: {
    startNewChat: vi.fn(),
    selectSession: vi.fn(),
    loadSessions: vi.fn(),
    loadMoreSessions: vi.fn(),
    loadOlderMessages: vi.fn(),
    reloadMessages: vi.fn(),
    commitVoiceSession: vi.fn(),
    submitMessage: vi.fn(),
    restoreSubmission: vi.fn(),
    retryRecoveredTurn: vi.fn(),
    allowNewAttempt: vi.fn(),
    retrySave: vi.fn(),
    cancelCurrentTurn: vi.fn(),
    retryTurn: vi.fn(),
    setDraft: vi.fn(),
    isVoiceInputLocked: vi.fn(() => false),
    claimVoiceInput: vi.fn(() => null),
    writeVoiceDraft: vi.fn(() => false),
    releaseVoiceInput: vi.fn(),
    bindVoiceConversation: vi.fn(() => false),
  },
  client: {} as ApiClient,
}));
vi.mock('./chat-context.tsx', () => ({ useChat: () => context }));
vi.mock('../../voice/dictation/useDictation.ts', () => ({
  useDictation: () => ({
    config: null,
    locked: false,
    phase: 'idle',
    status: '',
    notice: null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
}));

function createHarness(initial: ChatState, client: ApiClient) {
  let state = initial;
  const dispatch = (action: ChatAction) => {
    state = chatReducer(state, action);
  };
  const holder: { current: ReturnType<typeof useChatActions> | null } = { current: null };
  const render = () => {
    function Harness() {
      holder.current = useChatActions(state, dispatch, client);
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
  };
  render();
  return {
    get state() {
      return state;
    },
    get actions() {
      return holder.current!;
    },
    dispatch,
    render,
  };
}

const pending = { state: 'saving' as const, epoch: 'process-one', version: 1, durableVersion: 0 };
function completed() {
  let state = chatReducer(initialChatState, { type: 'TURN_SUBMIT_START', payload: { userContent: 'First question', idempotencyKey: 'request-one' } });
  state = chatReducer(state, { type: 'TURN_ACCEPTED', payload: { sessionId: 'session-one', turnId: 'turn-one', attemptId: 'attempt-one', userMessageId: 'user-one', processEpoch: 'process-one' } });
  state = chatReducer(state, { type: 'STREAM_DELTA', payload: { text: 'My answer' } });
  state = chatReducer(state, { type: 'STREAM_COMPLETED', payload: { assistantMessageId: 'assistant-one', outcome: 'completed' } });
  return chatReducer(state, { type: 'SAVE_STATE', payload: { sessionId: 'session-one', turnId: 'turn-one', save: pending } });
}

it('adds a pending sidebar on acceptance and preserves it against an older durable list', () => {
  const state = completed();
  expect(state.sessions[0]).toMatchObject({ sessionId: 'session-one', title: 'First question' });
  expect(state.turnStatus).toBe('completed');
  const reconciled = chatReducer(state, { type: 'SESSIONS_LOADED', payload: { items: [], nextCursor: null } });
  expect(reconciled.sessions).toEqual(state.sessions);
  expect(reconciled.saves['session-one'].value.state).toBe('saving');
});

it('retains unsaved messages through navigation and rejects regressing save/history responses', () => {
  const original = completed();
  let state = chatReducer(original, { type: 'NEW_CHAT' });
  state = chatReducer(state, { type: 'SELECT_SESSION', payload: { sessionId: 'session-one', title: 'First question' } });
  state = chatReducer(state, { type: 'MESSAGES_LOADED', payload: { sessionId: 'session-one', items: [], nextCursor: null, olderAvailable: false } });
  expect(state.messages.map(m => m.content)).toEqual(['First question', 'My answer']);
  state = chatReducer(state, { type: 'SAVE_STATE', payload: { sessionId: 'session-one', turnId: 'turn-two', save: { ...pending, version: 2 } } });
  const stale = chatReducer(state, { type: 'SAVE_STATE', payload: { sessionId: 'session-one', turnId: 'turn-one', save: { ...pending, state: 'saved', durableVersion: 1 } } });
  expect(stale.saves['session-one'].value.version).toBe(2);
  expect(chatReducer(state, { type: 'MESSAGES_LOADED', payload: { sessionId: 'another-session', items: [], nextCursor: null, olderAvailable: false } })).toBe(state);
});

it('keeps rename and pin changes made after a session list request started', () => {
  let state = completed();
  const revision = state.sessionsRevision;
  state = chatReducer(state, { type: 'SESSION_UPDATED', payload: { ...state.sessions[0], title: 'Renamed', pinned: true } });
  state = chatReducer(state, { type: 'SESSIONS_LOADED', payload: { items: [{ ...state.sessions[0], title: 'Old title', pinned: false }], nextCursor: null, revision } });
  expect(state.sessions[0]).toMatchObject({ title: 'Renamed', pinned: true });
});

it('tracks live voice pending sidebar and save state across same-call follow-ups with blocked saves and polls without provider calls', async () => {
  const parsed = parseVoiceControl(
    JSON.stringify({
      protocolVersion: 1,
      sessionId: 'vs-1',
      connectionEpoch: 1,
      eventId: 'evt-bound-1',
      sequence: 1,
      type: 'conversation.bound',
      conversationId: 'voice-conv-1',
      turnId: 'vturn-1',
      save: { state: 'pending', epoch: 'process-one', version: 1, durableVersion: 0 },
    }),
    'server',
    'live',
  );
  expect(parsed.type).toBe('conversation.bound');
  expect(() =>
    parseVoiceControl(
      JSON.stringify({
        protocolVersion: 1,
        sessionId: 'vs-1',
        connectionEpoch: 1,
        eventId: 'evt-bound-bad',
        sequence: 2,
        type: 'conversation.bound',
        conversationId: 'voice-conv-1',
        turnId: 'vturn-1',
      }),
      'server',
      'live',
    ),
  ).toThrow('INVALID_VOICE_CONTROL');

  let state = chatReducer(initialChatState, {
    type: 'CLAIM_VOICE_INPUT',
    payload: { token: 'lease-live-1', mode: 'live' },
  });
  state = chatReducer(state, {
    type: 'BIND_VOICE_CONVERSATION',
    payload: {
      token: 'lease-live-1',
      conversationId: 'voice-conv-1',
      turnId: 'vturn-1',
      save: { state: 'pending', epoch: 'process-one', version: 1, durableVersion: 0 },
    },
  });
  expect(state.sessions[0]).toMatchObject({ sessionId: 'voice-conv-1', title: 'New chat' });
  expect(state.saves['voice-conv-1']).toMatchObject({
    turnId: 'vturn-1',
    mode: 'live',
    value: { state: 'pending', version: 1 },
  });

  // Stale session list must not drop the unsaved live voice sidebar row.
  state = chatReducer(state, { type: 'SESSIONS_LOADED', payload: { items: [], nextCursor: null } });
  expect(state.sessions.map((s) => s.sessionId)).toEqual(['voice-conv-1']);

  // Turn 1 save fails while live call stays open; Turn 2 follow-up advances version to 2 and also blocks.
  state = chatReducer(state, {
    type: 'BIND_VOICE_CONVERSATION',
    payload: {
      token: 'lease-live-1',
      conversationId: 'voice-conv-1',
      turnId: 'vturn-1',
      save: { state: 'failed', epoch: 'process-one', version: 1, durableVersion: 0 },
    },
  });
  state = chatReducer(state, {
    type: 'BIND_VOICE_CONVERSATION',
    payload: {
      token: 'lease-live-1',
      conversationId: 'voice-conv-1',
      turnId: 'vturn-2',
      save: { state: 'failed', epoch: 'process-one', version: 2, durableVersion: 0 },
    },
  });
  // Stale Turn 1 save event is rejected.
  const afterStale = chatReducer(state, {
    type: 'BIND_VOICE_CONVERSATION',
    payload: {
      token: 'lease-live-1',
      conversationId: 'voice-conv-1',
      turnId: 'vturn-1',
      save: { state: 'saved', epoch: 'process-one', version: 1, durableVersion: 1 },
    },
  });
  expect(afterStale.saves['voice-conv-1']).toMatchObject({
    turnId: 'vturn-2',
    value: { state: 'failed', version: 2 },
  });

  // Active live voice renders operational save failure + Retry saving without leaking draft or transcript.
  const liveSurface: LiveVoiceSurface = {
    view: { ...initialLiveVoice, phase: 'active', connection: 'connected', conversationId: 'voice-conv-1' },
    start: vi.fn(),
    toggleMute: vi.fn(),
    interrupt: vi.fn(),
    exit: vi.fn(),
    resume: vi.fn(),
  };
  context.state = {
    ...afterStale,
    draftInput: 'SECRET_LIVE_DRAFT',
    messages: [
      {
        messageId: 'm-secret',
        turnId: 't-secret',
        eventId: 'e-secret',
        sequence: 1,
        role: 'user',
        content: 'SECRET_TRANSCRIPT_BODY',
        createdAt: '2026-11-07T00:00:00Z',
        completionStatus: 'completed',
        truncated: false,
      },
    ],
  };
  const liveHtml = renderToStaticMarkup(createElement(ChatView, { liveVoice: liveSurface }));
  expect(liveHtml).toContain('Saving failed. Keep a copy of this conversation.');
  expect(liveHtml).toContain('Retry saving');
  expect(liveHtml).not.toContain('SECRET_LIVE_DRAFT');
  expect(liveHtml).not.toContain('SECRET_TRANSCRIPT_BODY');
  expect(liveHtml).not.toContain('<textarea');

  // Live save polling uses listMessages(limit: 1) and never calls getTurnStatus or submit/retry endpoints.
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        items: [],
        nextCursor: null,
        olderAvailable: false,
        saveTurnId: 'vturn-2',
        save: { state: 'saved', epoch: 'process-one', version: 2, durableVersion: 2 },
      }),
    );
    const client = new ApiClient({ fetch: fetcher, recoveryStorage: null });
    const getTurnStatusSpy = vi.spyOn(client, 'getTurnStatus');
    let polledState: ChatState = {
      ...afterStale,
      saves: {
        'voice-conv-1': {
          turnId: 'vturn-2',
          mode: 'live',
          value: { state: 'saving', epoch: 'process-one', version: 2, durableVersion: 0 },
        },
      },
    };
    const cleanup = startSavePollEffect({
      client,
      dispatch: (action) => {
        polledState = chatReducer(polledState, action);
      },
      sessionId: 'voice-conv-1',
      activeSave: polledState.saves['voice-conv-1'],
      isStreaming: false,
    });
    await vi.advanceTimersByTimeAsync(1100);
    cleanup?.();
    expect(getTurnStatusSpy).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('/sessions/voice-conv-1/messages?limit=1');
    expect(polledState.saves['voice-conv-1']?.value.state).toBe('saved');
    expect(polledState.localSessionIds).not.toContain('voice-conv-1');
  } finally {
    vi.useRealTimers();
  }
});

it('recovers ambiguous retryTurn with original causal key and renders explicit retry notice', async () => {
  const values = new Map<string, string>();
  const recoveryStorage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); },
    removeItem: (k: string) => { values.delete(k); },
  };
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        sessionId: 'sess-retry',
        turnId: 'turn-1',
        attemptId: 'att-1',
        userMessageId: 'u-1',
        streamPath: '/sessions/sess-retry/turns/turn-1/stream',
        processEpoch: 'epoch-1',
      }),
    )
    .mockRejectedValueOnce(new Error('dropped retry POST'))
    .mockResolvedValueOnce(
      Response.json({
        sessionId: 'sess-retry',
        turnId: 'turn-1',
        attemptId: 'att-2',
        userMessageId: 'u-1',
        streamPath: '/sessions/sess-retry/turns/turn-1/stream',
        processEpoch: 'epoch-1',
      }),
    );
  const client = new ApiClient({ fetch: fetcher, recoveryStorage });
  vi.spyOn(client, 'connectTurnStream').mockImplementation(async (_path, handlers) => {
    handlers.onError?.(
      Object.assign(new Error('provider error'), {
        name: 'ApiClientError',
        code: 'PROVIDER_ERROR',
        status: 200,
        retryable: true,
      }) as import('../../../api/client.ts').ApiClientError,
    );
  });

  const harness = createHarness(initialChatState, client);
  await harness.actions.submitMessage('Initial prompt');
  harness.render();

  await harness.actions.retryTurn('turn-1');
  harness.render();
  expect(harness.state.retryRecovery).toMatchObject({
    sessionId: 'sess-retry',
    turnId: 'turn-1',
    request: { expectedEpoch: 'epoch-1', calendarProtocol: 2 },
  });
  const preservedKey = harness.state.retryRecovery!.request.idempotencyKey;

  context.state = harness.state;
  const html = renderToStaticMarkup(createElement(ChatView));
  expect(html).toContain('Retry original request');
  expect(html).toContain('Allow a new attempt');

  await harness.actions.retryRecoveredTurn();
  expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string)).toEqual({
    idempotencyKey: preservedKey,
    calendarProtocol: 2,
    expectedEpoch: 'epoch-1',
  });
  expect(harness.state.retryRecovery).toBeNull();
});

it('restores busy state after switching chats mid-generation, gates contention, and cleans up poll timers on navigation', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn<typeof fetch>()
      // 1: selectSession('sess-other') -> idle
      .mockResolvedValueOnce(
        Response.json({ items: [], nextCursor: null, olderAvailable: false }),
      )
      // 2: selectSession('sess-busy') -> activeTurn still generating
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              messageId: 'u-busy',
              turnId: 'turn-busy',
              eventId: 'e-busy',
              sequence: 1,
              role: 'user',
              content: 'Keep working',
              createdAt: '2026-11-07T00:00:00Z',
              completionStatus: 'accepted',
              truncated: false,
            },
          ],
          nextCursor: null,
          olderAvailable: false,
          activeTurn: {
            turnId: 'turn-busy',
            attemptId: 'att-busy',
            status: 'generating',
            mode: 'text',
          },
        }),
      )
      // 3: restored busy poll getTurnStatus -> completed
      .mockResolvedValueOnce(
        Response.json({
          sessionId: 'sess-busy',
          turnId: 'turn-busy',
          attemptId: 'att-busy',
          status: 'completed',
          truncated: false,
          error: null,
          save: { state: 'saved', epoch: 'epoch-1', version: 1, durableVersion: 1 },
        }),
      )
      // 4: restored busy poll listMessages -> full completed transcript
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              messageId: 'u-busy',
              turnId: 'turn-busy',
              eventId: 'e-busy',
              sequence: 1,
              role: 'user',
              content: 'Keep working',
              createdAt: '2026-11-07T00:00:00Z',
              completionStatus: 'accepted',
              truncated: false,
            },
            {
              messageId: 'a-busy',
              turnId: 'turn-busy',
              eventId: 'ea-busy',
              sequence: 2,
              role: 'assistant',
              content: 'Finished while you navigated away.',
              createdAt: '2026-11-07T00:00:02Z',
              completionStatus: 'completed',
              truncated: false,
            },
          ],
          nextCursor: null,
          olderAvailable: false,
          save: { state: 'saved', epoch: 'epoch-1', version: 1, durableVersion: 1 },
          saveTurnId: 'turn-busy',
        }),
      );

    const client = new ApiClient({ fetch: fetcher, recoveryStorage: null });
    let initial = chatReducer(initialChatState, {
      type: 'TURN_SUBMIT_START',
      payload: { userContent: 'Keep working', idempotencyKey: 'k-busy' },
    });
    initial = chatReducer(initial, {
      type: 'TURN_ACCEPTED',
      payload: {
        sessionId: 'sess-busy',
        turnId: 'turn-busy',
        attemptId: 'att-busy',
        userMessageId: 'u-busy',
        processEpoch: 'epoch-1',
      },
    });

    const harness = createHarness(initial, client);
    await harness.actions.selectSession('sess-other', 'Other chat');
    expect(harness.state.activeSessionId).toBe('sess-other');
    expect(harness.state.turnStatus).toBe('idle');

    harness.render();
    await harness.actions.selectSession('sess-busy', 'Keep working');
    expect(harness.state.activeSessionId).toBe('sess-busy');
    expect(harness.state.turnStatus).toBe('generating');
    expect(harness.state.activeTurnId).toBe('turn-busy');
    expect(harness.state.activeAttemptId).toBe('att-busy');
    expect(harness.state.activeTurnMode).toBe('text');
    expect(harness.state.isStreaming).toBe(false);

    // Contention gates while restored busy: submitMessage, retryTurn, claimVoiceInput, Composer, Sidebar delete, Transcript placeholder.
    harness.render();
    await harness.actions.submitMessage('Blocked follow-up');
    await harness.actions.retryTurn('turn-busy');
    expect(harness.actions.claimVoiceInput('live', () => {})).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);

    context.state = { ...harness.state, draftInput: 'Queued draft' };
    const composerHtml = renderToStaticMarkup(createElement(Composer));
    expect(composerHtml).toContain('aria-label="Cancel response"');
    expect(composerHtml).not.toContain('aria-label="Send message"');
    const sidebarHtml = renderToStaticMarkup(createElement(Sidebar));
    expect(sidebarHtml).toMatch(/<button[^>]*disabled=""[^>]*><svg[^>]*>[\s\S]*?<\/svg>Delete<\/button>/);
    const transcriptHtml = renderToStaticMarkup(createElement(Transcript));
    expect(transcriptHtml).toContain('aurvin-generating-placeholder');
    expect(transcriptHtml).toContain('Generating…');

    // Navigation/unmount cleanup stops poll before firing if cancelled immediately.
    const abortedCleanup = startRestoredBusyPollEffect({
      client,
      dispatch: harness.dispatch,
      sessionId: 'sess-busy',
      activeTurnId: 'turn-busy',
      turnStatus: 'generating',
      mode: 'text',
      isStreaming: false,
      isSubmitting: false,
    });
    abortedCleanup?.();
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Active poll settles turnStatus to completed and loads finished assistant message.
    const activeCleanup = startRestoredBusyPollEffect({
      client,
      dispatch: harness.dispatch,
      sessionId: 'sess-busy',
      activeTurnId: 'turn-busy',
      turnStatus: harness.state.turnStatus,
      mode: harness.state.activeTurnMode,
      isStreaming: harness.state.isStreaming,
      isSubmitting: harness.state.isSubmitting,
    });
    await vi.advanceTimersByTimeAsync(1100);
    activeCleanup?.();
    expect(harness.state.turnStatus).toBe('completed');
    expect(harness.state.activeTurnId).toBeNull();
    expect(harness.state.messages.map((m) => m.content)).toEqual([
      'Keep working',
      'Finished while you navigated away.',
    ]);
  } finally {
    vi.useRealTimers();
  }
});
