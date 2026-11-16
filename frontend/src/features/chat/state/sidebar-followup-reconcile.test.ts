/**
 * ============================================================================
 * FILE: sidebar-followup-reconcile.test.ts
 * LOCATION: frontend/src/features/chat/state/sidebar-followup-reconcile.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Regressions for skipping/aborting session list GET on the follow-up path.
 *
 * ROLE IN PROJECT:
 *    Worker 3 AC1 sidebar: reuse known sidebar rows, insert new sessions from
 *    the list API, and never invent stream timestamps or titles.
 *
 * KEY COMPONENTS:
 *    - Known-session complete does not call listSessions immediately
 *    - Known sessions still idle-reconcile from the list API after a bound delay
 *    - Missing session reconciles; in-flight GET aborts when a send starts
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../api/client.ts';
import type { CalendarCompatibleEnvelope } from '../../../api/calendar-protocol.ts';
import type { ListSessionsResponse, SessionSummary } from '../../../api/protocol.ts';
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

function session(overrides: Partial<SessionSummary> & Pick<SessionSummary, 'sessionId'>): SessionSummary {
  return {
    title: 'Known chat',
    createdAt: '2026-10-06T10:00:00.000Z',
    lastActivityAt: '2026-10-06T10:05:00.000Z',
    pinned: true,
    ...overrides,
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
  function Harness() {
    actions = useChatActions(state, dispatch, client);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return {
    get state() {
      return state;
    },
    dispatched,
    get actions() {
      return actions;
    },
  };
}

async function completeSubmit(
  client: ApiClient,
  harness: ReturnType<typeof createHarness>,
  ids: { sessionId: string; turnId: string; attemptId: string },
) {
  let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
  vi.spyOn(client, 'submitTurn').mockResolvedValue({
    sessionId: ids.sessionId,
    turnId: ids.turnId,
    attemptId: ids.attemptId,
    userMessageId: `user_${ids.turnId}`,
    streamPath: `/stream/${ids.turnId}`,
  });
  vi.spyOn(client, 'connectTurnStream').mockImplementation(async (_path, handlers) => {
    streamHandler = handlers.onEvent ?? null;
    return new Promise<void>(() => {});
  });
  void harness.actions.submitMessage(`prompt ${ids.turnId}`);
  await flush();
  streamHandler!(
    { type: 'completed', assistantMessageId: `asst_${ids.turnId}`, outcome: 'completed' },
    envelope(ids),
  );
  await flush();
  return streamHandler;
}

describe('sidebar follow-up reconcile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not GET sessions after completing a turn on a known sidebar row', async () => {
    const known = session({ sessionId: 'sess_1', pinned: true, title: 'Pinned title' });
    const older = session({
      sessionId: 'sess_old',
      pinned: false,
      title: 'Older page row',
      lastActivityAt: '2026-09-01T00:00:00.000Z',
    });
    const client = new ApiClient({ fetch: vi.fn() });
    const listSpy = vi.spyOn(client, 'listSessions').mockResolvedValue({
      items: [known],
      nextCursor: 'should-not-replace',
    });
    const harness = createHarness(
      {
        ...initialChatState,
        activeSessionId: 'sess_1',
        sessions: [known, older],
        sessionsCursor: 'page_2',
        hasMoreSessions: true,
      },
      client,
    );

    await completeSubmit(client, harness, {
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
    });

    expect(listSpy).not.toHaveBeenCalled();
    expect(harness.state.sessions).toEqual([known, older]);
    expect(harness.state.sessionsCursor).toBe('page_2');
    expect(harness.state.hasMoreSessions).toBe(true);
    expect(harness.dispatched.some((a) => a.type === 'SESSIONS_LOADED')).toBe(false);
    expect(harness.dispatched.some((a) => a.type === 'SESSION_UPDATED')).toBe(false);
    expect(harness.dispatched.filter((a) => a.type === 'STREAM_COMPLETED')).toHaveLength(1);
  });

  describe('bounded idle reconcile for known sessions', () => {
    it('does not GET immediately but reconciles authoritative activity after idle', async () => {
      const known = session({
        sessionId: 'sess_1',
        pinned: false,
        title: 'Local title',
        lastActivityAt: '2026-10-01T00:00:00.000Z',
      });
      const paged = session({
        sessionId: 'sess_page',
        pinned: false,
        title: 'Older page row',
        lastActivityAt: '2026-09-01T00:00:00.000Z',
      });
      const serverKnown = session({
        sessionId: 'sess_1',
        pinned: false,
        title: 'Server title',
        lastActivityAt: '2026-10-10T12:00:00.000Z',
      });
      const client = new ApiClient({ fetch: vi.fn() });
      const listSpy = vi.spyOn(client, 'listSessions').mockResolvedValue({
        items: [serverKnown],
        nextCursor: 'first_page_cursor',
      });
      const harness = createHarness(
        {
          ...initialChatState,
          activeSessionId: 'sess_1',
          sessions: [known, paged],
          sessionsCursor: 'page_2',
          hasMoreSessions: true,
        },
        client,
      );

      await completeSubmit(client, harness, {
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
      });
      expect(listSpy).not.toHaveBeenCalled();
      expect(harness.state.sessions.map((item) => item.sessionId)).toEqual(['sess_1', 'sess_page']);
      expect(harness.state.sessionsCursor).toBe('page_2');

      await vi.advanceTimersByTimeAsync(1_000);

      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(harness.dispatched.some((a) => a.type === 'SESSIONS_LOADED')).toBe(false);
      expect(harness.state.sessionsCursor).toBe('page_2');
      expect(harness.state.hasMoreSessions).toBe(true);
      expect(harness.state.sessions.map((item) => item.sessionId)).toEqual(['sess_1', 'sess_page']);
      expect(harness.state.sessions[0]).toEqual(serverKnown);
      expect(harness.state.sessions[1]).toEqual(paged);
      expect(harness.state.activeSessionTitle).toBe('Server title');
    });

    it('cancels a pending known-session refresh when a follow-up send starts, then reconciles after later idle', async () => {
      const known = session({ sessionId: 'sess_1', pinned: false, lastActivityAt: '2026-10-01T00:00:00.000Z' });
      const serverLater = session({
        sessionId: 'sess_1',
        pinned: false,
        title: 'After follow-up',
        lastActivityAt: '2026-10-10T13:00:00.000Z',
      });
      const client = new ApiClient({ fetch: vi.fn() });
      const listSpy = vi.spyOn(client, 'listSessions').mockResolvedValue({
        items: [serverLater],
        nextCursor: null,
      });

      let firstHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
      let secondHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
      vi.spyOn(client, 'submitTurn')
        .mockResolvedValueOnce({
          sessionId: 'sess_1',
          turnId: 'turn_1',
          attemptId: 'att_1',
          userMessageId: 'user_1',
          streamPath: '/stream/1',
        })
        .mockResolvedValueOnce({
          sessionId: 'sess_1',
          turnId: 'turn_2',
          attemptId: 'att_2',
          userMessageId: 'user_2',
          streamPath: '/stream/2',
        });
      vi.spyOn(client, 'connectTurnStream').mockImplementationOnce(async (_path, handlers) => {
        firstHandler = handlers.onEvent ?? null;
        return new Promise<void>(() => {});
      }).mockImplementationOnce(async (_path, handlers) => {
        secondHandler = handlers.onEvent ?? null;
        return new Promise<void>(() => {});
      });

      const harness = createHarness(
        { ...initialChatState, activeSessionId: 'sess_1', sessions: [known] },
        client,
      );
      void harness.actions.submitMessage('First');
      await flush();
      firstHandler!(
        { type: 'completed', assistantMessageId: 'asst_1', outcome: 'completed' },
        envelope({ sessionId: 'sess_1', turnId: 'turn_1', attemptId: 'att_1' }),
      );
      await flush();
      expect(listSpy).not.toHaveBeenCalled();

      void harness.actions.submitMessage('Follow-up');
      await flush();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(listSpy).not.toHaveBeenCalled();

      secondHandler!(
        { type: 'completed', assistantMessageId: 'asst_2', outcome: 'completed' },
        envelope({ sessionId: 'sess_1', turnId: 'turn_2', attemptId: 'att_2' }),
      );
      await flush();
      expect(listSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(harness.state.sessions[0]?.title).toBe('After follow-up');
      expect(harness.state.sessions[0]?.lastActivityAt).toBe('2026-10-10T13:00:00.000Z');
    });

    it('aborts an in-flight known-session GET when a follow-up starts and ignores the stale list', async () => {
      const known = session({ sessionId: 'sess_1', pinned: true, title: 'Pinned title' });
      const paged = session({
        sessionId: 'sess_page',
        pinned: false,
        title: 'Older page row',
        lastActivityAt: '2026-09-01T00:00:00.000Z',
      });
      const client = new ApiClient({ fetch: vi.fn() });
      let resolveList: (value: ListSessionsResponse) => void = () => {};
      const firstList = new Promise<ListSessionsResponse>((resolve) => {
        resolveList = resolve;
      });
      const signals: Array<AbortSignal | undefined> = [];
      const listSpy = vi.spyOn(client, 'listSessions').mockImplementationOnce(async (options) => {
        signals.push(options?.signal);
        return firstList;
      });

      let firstHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
      vi.spyOn(client, 'submitTurn')
        .mockResolvedValueOnce({
          sessionId: 'sess_1',
          turnId: 'turn_1',
          attemptId: 'att_1',
          userMessageId: 'user_1',
          streamPath: '/stream/1',
        })
        .mockResolvedValueOnce({
          sessionId: 'sess_1',
          turnId: 'turn_2',
          attemptId: 'att_2',
          userMessageId: 'user_2',
          streamPath: '/stream/2',
        });
      vi.spyOn(client, 'connectTurnStream').mockImplementationOnce(async (_path, handlers) => {
        firstHandler = handlers.onEvent ?? null;
        return new Promise<void>(() => {});
      }).mockImplementationOnce(async (_path) => {
        return new Promise<void>(() => {});
      });

      const harness = createHarness(
        {
          ...initialChatState,
          activeSessionId: 'sess_1',
          sessions: [known, paged],
          sessionsCursor: 'page_2',
          hasMoreSessions: true,
        },
        client,
      );
      void harness.actions.submitMessage('First');
      await flush();
      firstHandler!(
        { type: 'completed', assistantMessageId: 'asst_1', outcome: 'completed' },
        envelope({ sessionId: 'sess_1', turnId: 'turn_1', attemptId: 'att_1' }),
      );
      await flush();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(signals[0]).toBeInstanceOf(AbortSignal);

      void harness.actions.submitMessage('Follow-up');
      await flush();
      expect(signals[0]?.aborted).toBe(true);

      resolveList({
        items: [session({ sessionId: 'stale', title: 'Stale', lastActivityAt: '2026-01-01T00:00:00.000Z' })],
        nextCursor: 'stale_cursor',
      });
      await flush();
      expect(harness.state.sessions).toEqual([known, paged]);
      expect(harness.state.sessionsCursor).toBe('page_2');
      expect(harness.dispatched.some((a) => a.type === 'SESSIONS_LOADED')).toBe(false);
      expect(harness.dispatched.some((a) => a.type === 'SESSION_UPDATED')).toBe(false);
    });

    it('aborts an in-flight known-session GET on navigation and ignores the stale page', async () => {
      const known = session({ sessionId: 'sess_1', pinned: false, title: 'Local title' });
      const paged = session({
        sessionId: 'sess_page',
        pinned: false,
        title: 'Older page row',
        lastActivityAt: '2026-09-01T00:00:00.000Z',
      });
      const client = new ApiClient({ fetch: vi.fn() });
      let resolveList: (value: ListSessionsResponse) => void = () => {};
      const firstList = new Promise<ListSessionsResponse>((resolve) => {
        resolveList = resolve;
      });
      const signals: Array<AbortSignal | undefined> = [];
      vi.spyOn(client, 'listSessions').mockImplementationOnce(async (options) => {
        signals.push(options?.signal);
        return firstList;
      });
      vi.spyOn(client, 'listMessages').mockResolvedValue({
        items: [],
        nextCursor: null,
        olderAvailable: false,
      });
      const harness = createHarness(
        {
          ...initialChatState,
          activeSessionId: 'sess_1',
          sessions: [known, paged],
          sessionsCursor: 'page_2',
          hasMoreSessions: true,
        },
        client,
      );

      await completeSubmit(client, harness, {
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(signals[0]).toBeInstanceOf(AbortSignal);

      await harness.actions.selectSession('sess_page', 'Older page row');
      await flush();
      expect(signals[0]?.aborted).toBe(true);

      resolveList({
        items: [session({ sessionId: 'stale', title: 'Stale', lastActivityAt: '2026-01-01T00:00:00.000Z' })],
        nextCursor: 'stale_cursor',
      });
      await flush();
      expect(harness.state.sessions.map((item) => item.sessionId)).toEqual(['sess_1', 'sess_page']);
      expect(harness.state.sessionsCursor).toBe('page_2');
      expect(harness.dispatched.some((a) => a.type === 'SESSIONS_LOADED')).toBe(false);
    });
  });

  it('reconciles through listSessions when the completed session is missing (new chat)', async () => {
    const created: SessionSummary = session({
      sessionId: 'sess_new',
      title: 'Hello there',
      pinned: false,
      lastActivityAt: '2026-10-06T12:00:00.000Z',
    });
    const client = new ApiClient({ fetch: vi.fn() });
    const listSpy = vi.spyOn(client, 'listSessions').mockResolvedValue({
      items: [created],
      nextCursor: null,
    });
    const harness = createHarness(initialChatState, client);

    await completeSubmit(client, harness, {
      sessionId: 'sess_new',
      turnId: 'turn_new',
      attemptId: 'att_new',
    });

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(harness.state.sessions.map((item) => item.sessionId)).toEqual(['sess_new']);
    expect(harness.state.sessions[0]?.title).toBe('Hello there');
    expect(harness.state.sessions[0]?.lastActivityAt).toBe('2026-10-06T12:00:00.000Z');
    expect(
      harness.dispatched.some(
        (a) => a.type === 'SESSION_UPDATED' && a.payload.lastActivityAt !== created.lastActivityAt,
      ),
    ).toBe(false);
  });

  it('aborts an in-flight new-session GET when a follow-up send starts and ignores the stale list', async () => {
    const client = new ApiClient({ fetch: vi.fn() });
    let resolveList: (value: ListSessionsResponse) => void = () => {};
    const firstList = new Promise<ListSessionsResponse>((resolve) => {
      resolveList = resolve;
    });
    const signals: Array<AbortSignal | undefined> = [];
    const listSpy = vi.spyOn(client, 'listSessions').mockImplementationOnce(async (options) => {
      signals.push(options?.signal);
      return firstList;
    }).mockResolvedValue({
      items: [
        session({
          sessionId: 'sess_new',
          title: 'From retry reconcile',
          lastActivityAt: '2026-10-06T13:00:00.000Z',
        }),
      ],
      nextCursor: null,
    });

    let firstHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    let secondHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    vi.spyOn(client, 'submitTurn')
      .mockResolvedValueOnce({
        sessionId: 'sess_new',
        turnId: 'turn_1',
        attemptId: 'att_1',
        userMessageId: 'user_1',
        streamPath: '/stream/1',
      })
      .mockResolvedValueOnce({
        sessionId: 'sess_new',
        turnId: 'turn_2',
        attemptId: 'att_2',
        userMessageId: 'user_2',
        streamPath: '/stream/2',
      });
    vi.spyOn(client, 'connectTurnStream').mockImplementationOnce(async (_path, handlers) => {
      firstHandler = handlers.onEvent ?? null;
      return new Promise<void>(() => {});
    }).mockImplementationOnce(async (_path, handlers) => {
      secondHandler = handlers.onEvent ?? null;
      return new Promise<void>(() => {});
    });

    const harness = createHarness(initialChatState, client);
    void harness.actions.submitMessage('First');
    await flush();
    firstHandler!(
      { type: 'completed', assistantMessageId: 'asst_1', outcome: 'completed' },
      envelope({ sessionId: 'sess_new', turnId: 'turn_1', attemptId: 'att_1' }),
    );
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);

    void harness.actions.submitMessage('Follow-up');
    await flush();
    expect(signals[0]?.aborted).toBe(true);

    resolveList({
      items: [session({ sessionId: 'stale', title: 'Stale page', lastActivityAt: '2026-01-01T00:00:00.000Z' })],
      nextCursor: 'stale_cursor',
    });
    await flush();
    expect(harness.state.sessions.map((item) => item.sessionId)).not.toContain('stale');
    expect(harness.state.sessionsCursor).not.toBe('stale_cursor');
    expect(harness.dispatched.filter((a) => a.type === 'SESSIONS_LOADED')).toHaveLength(0);

    secondHandler!(
      { type: 'completed', assistantMessageId: 'asst_2', outcome: 'completed' },
      envelope({ sessionId: 'sess_new', turnId: 'turn_2', attemptId: 'att_2' }),
    );
    await flush();
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(harness.state.sessions.map((item) => item.sessionId)).toEqual(['sess_new']);
    expect(harness.state.sessions[0]?.title).toBe('From retry reconcile');
  });

  it('still loads messages on selectSession and appends pages after skipping a known-session GET', async () => {
    const known = session({ sessionId: 'sess_1' });
    const client = new ApiClient({ fetch: vi.fn() });
    const listSpy = vi.spyOn(client, 'listSessions').mockResolvedValue({
      items: [known],
      nextCursor: 'next',
    });
    const messagesSpy = vi.spyOn(client, 'listMessages').mockResolvedValue({
      items: [],
      nextCursor: null,
      olderAvailable: false,
    });
    const moreSpy = vi.spyOn(client, 'listSessions');
    const harness = createHarness(
      {
        ...initialChatState,
        activeSessionId: 'sess_1',
        sessions: [known],
        sessionsCursor: 'page_2',
        hasMoreSessions: true,
      },
      client,
    );

    await completeSubmit(client, harness, {
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
    });
    expect(listSpy).not.toHaveBeenCalled();

    await harness.actions.selectSession('sess_1', 'Known chat');
    await flush();
    expect(messagesSpy).toHaveBeenCalledWith('sess_1');

    await harness.actions.loadMoreSessions();
    await flush();
    expect(moreSpy).toHaveBeenCalled();
  });

  it('skips listSessions after retry completion on a known session', async () => {
    const known = session({ sessionId: 'sess_1' });
    const client = new ApiClient({ fetch: vi.fn() });
    const listSpy = vi.spyOn(client, 'listSessions');
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    vi.spyOn(client, 'retryTurn').mockResolvedValue({
      sessionId: 'sess_1',
      turnId: 'turn_retry',
      attemptId: 'att_retry',
      userMessageId: 'user_retry',
      streamPath: '/stream/retry',
    });
    vi.spyOn(client, 'connectTurnStream').mockImplementation(async (_path, handlers) => {
      streamHandler = handlers.onEvent ?? null;
      return new Promise<void>(() => {});
    });
    const harness = createHarness(
      { ...initialChatState, activeSessionId: 'sess_1', sessions: [known] },
      client,
    );
    void harness.actions.retryTurn('turn_retry');
    await flush();
    streamHandler!(
      { type: 'completed', assistantMessageId: 'asst_retry', outcome: 'completed' },
      envelope({ turnId: 'turn_retry', attemptId: 'att_retry' }),
    );
    await flush();
    expect(listSpy).not.toHaveBeenCalled();
    expect(harness.state.sessions).toEqual([known]);
  });
});
