/**
 * ============================================================================
 * FILE: chat-followup-generation-safety.test.ts
 * LOCATION: frontend/src/features/chat/state/chat-followup-generation-safety.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Regressions for stale submit/retry cleanup versus a newer draft or stream.
 *
 * ROLE IN PROJECT:
 *    Worker 3 AC1: old abort/error/finally must not overwrite typed follow-up
 *    text or cancel a newer coalescer; Send stays serialized with no queue.
 *
 * KEY COMPONENTS:
 *    - Generation ownership across submit, retry, cancel, and navigation
 *    - TURN_SUBMIT_ERROR draft preservation when the user already typed
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from '../../../api/client.ts';
import type { CalendarCompatibleEnvelope } from '../../../api/calendar-protocol.ts';
import { chatReducer, initialChatState } from './chat-reducer.ts';
import type { ChatAction, ChatState } from './chat-types.ts';
import { useChatActions } from './use-chat.ts';

function envelope(overrides?: Partial<CalendarCompatibleEnvelope>): CalendarCompatibleEnvelope {
  return {
    protocolVersion: 2,
    sessionId: 'sess_1',
    turnId: 'turn_1',
    attemptId: 'att_1',
    sequence: 1,
    event: { type: 'delta', text: '' },
    ...overrides,
  } as CalendarCompatibleEnvelope;
}

function sessionSummary(sessionId = 'sess_1') {
  return {
    sessionId,
    title: 'Known chat',
    createdAt: '2026-10-06T10:00:00.000Z',
    lastActivityAt: '2026-10-06T10:05:00.000Z',
    pinned: true,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(initial: ChatState, client: ApiClient) {
  let state = initial;
  const dispatched: ChatAction[] = [];
  const dispatch = (action: ChatAction) => {
    dispatched.push(action);
    state = chatReducer(state, action);
  };
  let actions!: ReturnType<typeof useChatActions>;
  const render = () => {
    function Harness() {
      actions = useChatActions(state, dispatch, client);
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
  };
  render();
  return {
    get state() {
      return state;
    },
    dispatched,
    get actions() {
      return actions;
    },
    render,
    dispatch,
  };
}

describe('follow-up generation ownership', () => {
  it('sends the displayed proposal revision on Confirm without guessing for typed replies or old frames', async () => {
    const client = new ApiClient({ fetch: vi.fn() });
    const submit = vi.spyOn(client, 'submitTurn').mockResolvedValue({
      sessionId: 'sess_1', turnId: 'turn_confirm', attemptId: 'att_confirm',
      userMessageId: 'msg_confirm', streamPath: '/stream/confirm',
    });
    vi.spyOn(client, 'connectTurnStream').mockResolvedValue(undefined);
    for (const mode of ['confirm', 'typed', 'legacy'] as const) {
      const harness = createHarness({ ...initialChatState, activeSessionId: 'sess_1',
        calendarClarification: { turnId: 'turn_proposal', event: {
          type: 'calendar-clarification', proposalId: 'proposal_1',
          ...(mode === 'legacy' ? {} : { proposalRevision: 3 }),
          reason: 'details', expiresAt: '2099-01-01T00:00:00Z', message: 'Confirm this event', candidates: [],
        } },
      }, client);
      await harness.actions.submitMessage('yes', { hideFromTranscript: mode !== 'typed' });
      const request = submit.mock.calls.at(-1)![0];
      if (mode === 'confirm') expect(request).toHaveProperty('calendarReplyTo', { proposalId: 'proposal_1', revision: 3 });
      else expect(request).not.toHaveProperty('calendarReplyTo');
    }
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not let an old stream finally cancel a newer follow-up coalescer', async () => {
    let releaseFirstStream: () => void = () => {};
    const firstStream = new Promise<void>((resolve) => {
      releaseFirstStream = resolve;
    });
    let firstHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    let secondHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn')
      .mockResolvedValueOnce({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
        userMessageId: 'msg_1',
        streamPath: '/stream/1',
      })
      .mockResolvedValueOnce({
        sessionId: 'sess_1',
        turnId: 'turn_2',
        attemptId: 'att_2',
        userMessageId: 'msg_2',
        streamPath: '/stream/2',
      });
    vi.spyOn(client, 'connectTurnStream').mockImplementationOnce(async (_path, handlers) => {
      firstHandler = handlers.onEvent ?? null;
      return firstStream;
    }).mockImplementationOnce(async (_path, handlers) => {
      secondHandler = handlers.onEvent ?? null;
      return new Promise<void>(() => {});
    });

    const harness = createHarness(
      { ...initialChatState, activeSessionId: 'sess_1', sessions: [sessionSummary()] },
      client,
    );
    void harness.actions.submitMessage('First');
    await flush();
    expect(firstHandler).not.toBeNull();

    firstHandler!(
      { type: 'completed', assistantMessageId: 'asst_1', outcome: 'completed' },
      envelope(),
    );
    expect(harness.state.isStreaming).toBe(false);

    // Same hook instance: production keeps coalescer/abort refs across the
    // completed-to-follow-up render. Remounting would hide a stale finally.
    void harness.actions.submitMessage('Follow-up');
    await flush();
    expect(secondHandler).not.toBeNull();

    releaseFirstStream();
    await flush();

    secondHandler!(
      { type: 'delta', text: 'Second answer' },
      envelope({ sessionId: 'sess_1', turnId: 'turn_2', attemptId: 'att_2' }),
    );
    vi.advanceTimersByTime(16);
    expect(harness.state.streamText).toBe('Second answer');
    expect(harness.dispatched.filter((a) => a.type === 'STREAM_DELTA')).toHaveLength(1);
  });

  it('keeps a draft typed during submit when the old request fails', async () => {
    let failSubmit: (err: unknown) => void = () => {};
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockImplementation(
      () =>
        new Promise((_, reject) => {
          failSubmit = reject;
        }),
    );

    const harness = createHarness({ ...initialChatState, activeSessionId: 'sess_1' }, client);
    void harness.actions.submitMessage('Original prompt');
    await flush();
    expect(harness.state.draftInput).toBe('');
    expect(harness.state.isSubmitting).toBe(true);

    harness.dispatch({ type: 'SET_DRAFT', payload: 'Typed follow-up' });
    expect(harness.state.draftInput).toBe('Typed follow-up');

    failSubmit(new ApiClientError('NETWORK_ERROR', 'Submission failed', 0, true));
    await flush();

    expect(harness.state.draftInput).toBe('Typed follow-up');
    expect(harness.state.turnError?.code).toBe('NETWORK_ERROR');
    expect(harness.state.isSubmitting).toBe(false);
  });

  it('restores preserved content when submit fails and the draft is still empty', async () => {
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockRejectedValue(
      new ApiClientError('NETWORK_ERROR', 'Submission failed', 0, true),
    );
    const harness = createHarness({ ...initialChatState, activeSessionId: 'sess_1' }, client);
    void harness.actions.submitMessage('Original prompt');
    await flush();
    expect(harness.state.draftInput).toBe('Original prompt');
    expect(harness.state.turnError?.code).toBe('NETWORK_ERROR');
  });

  it('does not apply STREAM_CANCELLED from an aborted submit after New Chat', async () => {
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockImplementation(
      (_request, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(new ApiClientError('ABORTED', 'Request was cancelled', 0, false));
          });
        }),
    );
    const harness = createHarness(
      { ...initialChatState, activeSessionId: 'sess_1', draftInput: 'going away' },
      client,
    );
    void harness.actions.submitMessage('going away');
    await flush();
    harness.actions.startNewChat();
    await flush();
    expect(harness.state.activeSessionId).toBeNull();
    expect(harness.state.turnStatus).toBe('idle');
    expect(harness.state.isStreaming).toBe(false);
    expect(harness.dispatched.filter((a) => a.type === 'STREAM_CANCELLED')).toEqual([]);
  });

  it('does not let a retry finally cancel a newer submit coalescer', async () => {
    let releaseRetryStream: () => void = () => {};
    const retryStream = new Promise<void>((resolve) => {
      releaseRetryStream = resolve;
    });
    let retryHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    let submitHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'retryTurn').mockResolvedValue({
      sessionId: 'sess_1',
      turnId: 'turn_retry',
      attemptId: 'att_retry',
      userMessageId: 'msg_user_retry',
      streamPath: '/stream/retry',
    });
    vi.spyOn(client, 'submitTurn').mockResolvedValue({
      sessionId: 'sess_1',
      turnId: 'turn_2',
      attemptId: 'att_2',
      userMessageId: 'msg_2',
      streamPath: '/stream/2',
    });
    vi.spyOn(client, 'connectTurnStream').mockImplementationOnce(async (_path, handlers) => {
      retryHandler = handlers.onEvent ?? null;
      return retryStream;
    }).mockImplementationOnce(async (_path, handlers) => {
      submitHandler = handlers.onEvent ?? null;
      return new Promise<void>(() => {});
    });

    const harness = createHarness({ ...initialChatState, activeSessionId: 'sess_1' }, client);
    void harness.actions.retryTurn('turn_retry');
    await flush();
    retryHandler!(
      { type: 'completed', assistantMessageId: 'asst_retry', outcome: 'completed' },
      envelope({ turnId: 'turn_retry', attemptId: 'att_retry' }),
    );
    void harness.actions.submitMessage('After retry');
    await flush();
    releaseRetryStream();
    await flush();
    submitHandler!(
      { type: 'delta', text: 'After' },
      envelope({ turnId: 'turn_2', attemptId: 'att_2' }),
    );
    vi.advanceTimersByTime(16);
    expect(harness.state.streamText).toBe('After');
  });

  it('does not start a second generation while accepted/generating/finalizing', async () => {
    const client = new ApiClient({ fetch: vi.fn() });
    const submitSpy = vi.spyOn(client, 'submitTurn');
    const retrySpy = vi.spyOn(client, 'retryTurn');
    const streaming = chatReducer(
      chatReducer(initialChatState, {
        type: 'TURN_SUBMIT_START',
        payload: { userContent: 'First', idempotencyKey: 'k' },
      }),
      {
        type: 'TURN_ACCEPTED',
        payload: {
          sessionId: 'sess_1',
          turnId: 'turn_1',
          attemptId: 'att_1',
          userMessageId: 'user_1',
        },
      },
    );
    for (const status of ['accepted', 'generating', 'finalizing'] as const) {
      const state = chatReducer(streaming, {
        type: 'STREAM_STATUS',
        payload: { status, truncated: false },
      });
      const harness = createHarness({ ...state, draftInput: 'Follow-up' }, client);
      await harness.actions.submitMessage();
      await harness.actions.retryTurn('turn_1');
    }
    expect(submitSpy).not.toHaveBeenCalled();
    expect(retrySpy).not.toHaveBeenCalled();
  });

  it('does not automatically queue a leftover draft when a turn completes', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    const submitSpy = vi.spyOn(client, 'submitTurn').mockResolvedValue({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      userMessageId: 'msg_1',
      streamPath: '/stream',
    });
    vi.spyOn(client, 'connectTurnStream').mockImplementation(async (_path, handlers) => {
      streamHandler = handlers.onEvent ?? null;
      return new Promise<void>(() => {});
    });
    const harness = createHarness({ ...initialChatState, activeSessionId: 'sess_1' }, client);
    void harness.actions.submitMessage('First');
    await flush();
    harness.dispatch({ type: 'SET_DRAFT', payload: 'Leftover' });
    streamHandler!(
      { type: 'completed', assistantMessageId: 'asst_1', outcome: 'completed' },
      envelope(),
    );
    await flush();
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(harness.state.draftInput).toBe('Leftover');
    expect(harness.state.isStreaming).toBe(false);
  });
});

describe('TURN_SUBMIT_ERROR draft ownership in the reducer', () => {
  it('does not overwrite a newer typed draft with preservedContent', () => {
    const started = chatReducer(initialChatState, {
      type: 'TURN_SUBMIT_START',
      payload: { userContent: 'Original prompt', idempotencyKey: 'k' },
    });
    const typed = chatReducer(started, { type: 'SET_DRAFT', payload: 'Newer follow-up' });
    const failed = chatReducer(typed, {
      type: 'TURN_SUBMIT_ERROR',
      payload: {
        error: { code: 'NETWORK_ERROR', message: 'Failed to send', retryable: true },
        preservedContent: 'Original prompt',
      },
    });
    expect(failed.draftInput).toBe('Newer follow-up');
  });

  it('restores preservedContent when the composer is still empty', () => {
    const started = chatReducer(initialChatState, {
      type: 'TURN_SUBMIT_START',
      payload: { userContent: 'Original prompt', idempotencyKey: 'k' },
    });
    const failed = chatReducer(started, {
      type: 'TURN_SUBMIT_ERROR',
      payload: {
        error: { code: 'NETWORK_ERROR', message: 'Failed to send', retryable: true },
        preservedContent: 'Original prompt',
      },
    });
    expect(failed.draftInput).toBe('Original prompt');
  });
});
