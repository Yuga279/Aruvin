/**
 * ============================================================================
 * FILE: chat-stream-coalescing.test.ts
 * LOCATION: frontend/src/features/chat/state/chat-stream-coalescing.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic unit tests for SSE delta coalescing at presentation boundary.
 *
 * ROLE IN PROJECT:
 *    Validates Opportunity O4: buffers high-frequency text deltas, batches
 *    STREAM_DELTA per animation frame/tick, flushes before terminal states,
 *    and isolates session/abort/reset without DOM dependency.
 *
 * KEY COMPONENTS:
 *    - Burst coalescing test (submit and retry paths)
 *    - Reset semantics and pre-reset text discarding
 *    - Synchronous flush before completed/error/interrupted/cancelled
 *    - Session switch and new chat isolation (no stale callbacks)
 *    - Bounded background-tab timeout fallback
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
import { agenda } from '../../canvas/testing/calendar-view-fixtures.ts';

function createMockEnvelope(overrides?: Partial<CalendarCompatibleEnvelope>): CalendarCompatibleEnvelope {
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

describe('Opportunity O4: SSE delta coalescing at presentation boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces high-frequency SSE deltas during submitMessage into a single frame dispatch', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });

    vi.spyOn(client, 'submitTurn').mockResolvedValue({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      userMessageId: 'msg_user_1',
      streamPath: '/stream/sess_1/turn_1',
    });
    vi.spyOn(client, 'connectTurnStream').mockImplementation(async (_path, handlers) => {
      streamHandler = handlers.onEvent ?? null;
      return new Promise<void>(() => {});
    });

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1', draftInput: 'Hello' };
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

    void actions.submitMessage('Hello');
    await Promise.resolve();
    await Promise.resolve();

    expect(streamHandler).not.toBeNull();

    // Send a burst of 4 rapid delta events
    const env = createMockEnvelope();
    streamHandler!({ type: 'delta', text: 'The ' }, env);
    streamHandler!({ type: 'delta', text: 'quick ' }, env);
    streamHandler!({ type: 'delta', text: 'brown ' }, env);
    streamHandler!({ type: 'delta', text: 'fox' }, env);

    // Before timer advances: deltas must be buffered, not immediately dispatched 4 times
    const deltasBeforeTick = dispatched.filter((a) => a.type === 'STREAM_DELTA');
    expect(deltasBeforeTick).toHaveLength(0);

    // Advance by 1 frame / timer interval (16ms)
    vi.advanceTimersByTime(16);

    // Exactly 1 coalesced STREAM_DELTA should have been dispatched
    const deltasAfterTick = dispatched.filter((a) => a.type === 'STREAM_DELTA');
    expect(deltasAfterTick).toHaveLength(1);
    expect(deltasAfterTick[0]).toEqual({
      type: 'STREAM_DELTA',
      payload: { text: 'The quick brown fox' },
    });
    expect(state.streamText).toBe('The quick brown fox');
  });

  it('coalesces high-frequency SSE deltas during retryTurn identically', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });

    vi.spyOn(client, 'retryTurn').mockResolvedValue({
      sessionId: 'sess_1',
      turnId: 'turn_retry',
      attemptId: 'att_retry',
      userMessageId: 'msg_user_retry',
      streamPath: '/stream/sess_1/turn_retry',
    });
    vi.spyOn(client, 'connectTurnStream').mockImplementation(async (_path, handlers) => {
      streamHandler = handlers.onEvent ?? null;
      return new Promise<void>(() => {});
    });

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1' };
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

    void actions.retryTurn('turn_retry');
    await Promise.resolve();
    await Promise.resolve();

    expect(streamHandler).not.toBeNull();

    const env = createMockEnvelope({ turnId: 'turn_retry', attemptId: 'att_retry' });
    streamHandler!({ type: 'delta', text: 'Retry ' }, env);
    streamHandler!({ type: 'delta', text: 'part 1, ' }, env);
    streamHandler!({ type: 'delta', text: 'part 2' }, env);

    expect(dispatched.filter((a) => a.type === 'STREAM_DELTA')).toHaveLength(0);

    vi.advanceTimersByTime(16);

    const deltasAfterTick = dispatched.filter((a) => a.type === 'STREAM_DELTA');
    expect(deltasAfterTick).toHaveLength(1);
    expect(deltasAfterTick[0]).toEqual({
      type: 'STREAM_DELTA',
      payload: { text: 'Retry part 1, part 2' },
    });
    expect(state.streamText).toBe('Retry part 1, part 2');
  });

  it('preserves reset flag and latest text when reset occurs within a buffered burst', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockResolvedValue({
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

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1' };
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

    void actions.submitMessage('test reset');
    await Promise.resolve();
    await Promise.resolve();

    const env = createMockEnvelope();
    // Delta 1 before reset
    streamHandler!({ type: 'delta', text: 'Stale text to discard' }, env);
    // Delta 2 with reset
    streamHandler!({ type: 'delta', text: 'Corrected start ', reset: true }, env);
    // Delta 3 after reset
    streamHandler!({ type: 'delta', text: 'continuation' }, env);

    // In uncoalesced code, this will fail because Stale text was already dispatched as STREAM_DELTA
    expect(dispatched.filter((a) => a.type === 'STREAM_DELTA')).toHaveLength(0);

    vi.advanceTimersByTime(16);

    const deltas = dispatched.filter((a) => a.type === 'STREAM_DELTA');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual({
      type: 'STREAM_DELTA',
      payload: { text: 'Corrected start continuation', reset: true },
    });
    expect(state.streamText).toBe('Corrected start continuation');
  });

  it('synchronously flushes pending buffered text before STREAM_COMPLETED', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockResolvedValue({
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

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1' };
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

    void actions.submitMessage('test completed flush');
    await Promise.resolve();
    await Promise.resolve();

    const env = createMockEnvelope();
    streamHandler!({ type: 'delta', text: 'Final complete sentence.' }, env);
    // Before completed arrives, delta is buffered and not yet dispatched
    expect(dispatched.filter((a) => a.type === 'STREAM_DELTA')).toHaveLength(0);

    // Completed event arrives immediately before timer tick. Buffered text
    // is applied on STREAM_COMPLETED so React batching cannot drop it.
    streamHandler!({ type: 'completed', assistantMessageId: 'asst_msg_1', outcome: 'completed' }, env);

    const completed = dispatched.find((a) => a.type === 'STREAM_COMPLETED');
    expect(completed).toMatchObject({
      type: 'STREAM_COMPLETED',
      payload: { assistantMessageId: 'asst_msg_1', text: 'Final complete sentence.' },
    });

    const assistantMsg = state.messages.find((m) => m.messageId === 'asst_msg_1');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.content).toBe('Final complete sentence.');
  });

  it('synchronously flushes pending buffered text before transport error STREAM_INTERRUPTED', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    let errorHandler: ((err: ApiClientError) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockResolvedValue({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      userMessageId: 'msg_1',
      streamPath: '/stream',
    });
    vi.spyOn(client, 'connectTurnStream').mockImplementation(async (_path, handlers) => {
      streamHandler = handlers.onEvent ?? null;
      errorHandler = handlers.onError ?? null;
      return new Promise<void>(() => {});
    });

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1' };
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

    void actions.submitMessage('test interrupted flush');
    await Promise.resolve();
    await Promise.resolve();

    const env = createMockEnvelope();
    streamHandler!({ type: 'delta', text: 'Partial text before cut off' }, env);
    expect(dispatched.filter((a) => a.type === 'STREAM_DELTA')).toHaveLength(0);

    errorHandler!(new ApiClientError('STREAM_INTERRUPTED', 'Premature close', 200, true));

    const deltaIndex = dispatched.findIndex((a) => a.type === 'STREAM_DELTA');
    const interruptedIndex = dispatched.findIndex((a) => a.type === 'STREAM_INTERRUPTED');
    expect(deltaIndex).toBeGreaterThan(-1);
    expect(interruptedIndex).toBeGreaterThan(-1);
    expect(deltaIndex).toBeLessThan(interruptedIndex);

    const interruptedMsg = state.messages.find((m) => m.completionStatus === 'interrupted');
    expect(interruptedMsg).toBeDefined();
    expect(interruptedMsg?.content).toBe('Partial text before cut off');
  });

  it('synchronously flushes pending buffered text before STREAM_CANCELLED on cancelCurrentTurn', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockResolvedValue({
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
    vi.spyOn(client, 'cancelTurn').mockResolvedValue(undefined);

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1' };
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

    void actions.submitMessage('test user cancel');
    await Promise.resolve();
    await Promise.resolve();

    const env = createMockEnvelope();
    streamHandler!({ type: 'delta', text: 'Words before user stopped' }, env);
    expect(dispatched.filter((a) => a.type === 'STREAM_DELTA')).toHaveLength(0);

    await actions.cancelCurrentTurn();

    const deltaIndex = dispatched.findIndex((a) => a.type === 'STREAM_DELTA');
    const cancelledIndex = dispatched.findIndex((a) => a.type === 'STREAM_CANCELLED');
    expect(deltaIndex).toBeGreaterThan(-1);
    expect(cancelledIndex).toBeGreaterThan(-1);
    expect(deltaIndex).toBeLessThan(cancelledIndex);

    const cancelledMsg = state.messages.find((m) => m.completionStatus === 'cancelled');
    expect(cancelledMsg).toBeDefined();
    expect(cancelledMsg?.content).toBe('Words before user stopped');
  });

  it('cancels and discards buffered text on startNewChat without applying stale text', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockResolvedValue({
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

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1' };
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

    void actions.submitMessage('abandon this');
    await Promise.resolve();
    await Promise.resolve();

    const env = createMockEnvelope();
    streamHandler!({ type: 'delta', text: 'Should never appear in new chat' }, env);

    actions.startNewChat();

    vi.advanceTimersByTime(50);

    expect(dispatched.some((a) => a.type === 'STREAM_DELTA')).toBe(false);
    expect(state.activeSessionId).toBeNull();
    expect(state.streamText).toBe('');
  });

  it('cancels and discards buffered text on selectSession without applying stale text to the new session', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockResolvedValue({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      userMessageId: 'msg_1',
      streamPath: '/stream',
    });
    vi.spyOn(client, 'listMessages').mockResolvedValue({ items: [], nextCursor: null, olderAvailable: false });
    vi.spyOn(client, 'connectTurnStream').mockImplementation(async (_path, handlers) => {
      streamHandler = handlers.onEvent ?? null;
      return new Promise<void>(() => {});
    });

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1' };
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

    void actions.submitMessage('abandon this for session 2');
    await Promise.resolve();
    await Promise.resolve();

    const env = createMockEnvelope();
    streamHandler!({ type: 'delta', text: 'Old session stale text' }, env);

    void actions.selectSession('sess_2', 'Session Two');
    await Promise.resolve();
    await Promise.resolve();

    vi.advanceTimersByTime(50);

    expect(dispatched.some((a) => a.type === 'STREAM_DELTA')).toBe(false);
    expect(state.activeSessionId).toBe('sess_2');
    expect(state.streamText).toBe('');
  });

  it('supports injecting a custom scheduler into useChatActions or ChatProvider', async () => {
    let triggeredCallback: (() => void) | null = null;
    const manualScheduler = {
      schedule: (cb: () => void) => {
        triggeredCallback = cb;
        return () => {
          triggeredCallback = null;
        };
      },
    };

    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockResolvedValue({
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

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1' };
    const dispatched: ChatAction[] = [];
    const dispatch = (action: ChatAction) => {
      dispatched.push(action);
      state = chatReducer(state, action);
    };

    let actions!: ReturnType<typeof useChatActions>;
    function Harness() {
      actions = useChatActions(state, dispatch, client, undefined, { scheduler: manualScheduler });
      return null;
    }
    renderToStaticMarkup(createElement(Harness));

    void actions.submitMessage('custom scheduler test');
    await Promise.resolve();
    await Promise.resolve();

    const env = createMockEnvelope();
    streamHandler!({ type: 'delta', text: 'Buffered chunk' }, env);

    expect(dispatched.filter((a) => a.type === 'STREAM_DELTA')).toHaveLength(0);
    expect(triggeredCallback).not.toBeNull();

    // Manually trigger the scheduled flush
    triggeredCallback!();

    expect(dispatched.filter((a) => a.type === 'STREAM_DELTA')).toHaveLength(1);
    expect(state.streamText).toBe('Buffered chunk');
  });

  it('discards un-flushed deltas when unmount/cancel cleanup runs', async () => {
    let streamHandler: ((event: any, envelope: CalendarCompatibleEnvelope) => void) | null = null;
    const client = new ApiClient({ fetch: vi.fn() });
    vi.spyOn(client, 'submitTurn').mockResolvedValue({
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

    let state: ChatState = { ...initialChatState, activeSessionId: 'sess_1' };
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

    void actions.submitMessage('unmount test');
    await Promise.resolve();
    await Promise.resolve();

    const env = createMockEnvelope();
    streamHandler!({ type: 'delta', text: 'Pending before unmount' }, env);

    // Cancel / unmount abort
    actions.startNewChat();

    vi.advanceTimersByTime(50);
    expect(dispatched.filter((a) => a.type === 'STREAM_DELTA')).toHaveLength(0);
  });

  it('publishes Calendar completion before any visual rendering or frame tick', async () => {
    const client = new ApiClient({fetch:vi.fn()});
    vi.spyOn(client,'submitTurn').mockResolvedValue({sessionId:'sess_1',turnId:'turn_1',attemptId:'att_1',userMessageId:'u',streamPath:'/stream'});
    let handler!: NonNullable<Parameters<ApiClient['connectTurnStream']>[1]['onEvent']>;
    vi.spyOn(client,'connectTurnStream').mockImplementation(async (_path,h) => {
      handler=h.onEvent!;
      return new Promise<void>(() => {});
    });
    let state:ChatState = {...initialChatState,activeSessionId:'sess_1'};
    const dispatch = (a:ChatAction) => {state=chatReducer(state,a);};
    let actions!:ReturnType<typeof useChatActions>;
    function Harness(){actions=useChatActions(state,dispatch,client);return null;}
    renderToStaticMarkup(createElement(Harness));
    void actions.submitMessage('Check my calendar');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const envelope=createMockEnvelope({protocolVersion:3});
    handler({type:'delta',text:'One event.'},envelope);
    handler({type:'completed',assistantMessageId:'m',outcome:'completed',calendarView:agenda()},
      {...envelope,sequence:2});
    expect(state.messages.at(-1)).toMatchObject({content:'One event.',calendarView:agenda()});
    expect(state.isStreaming).toBe(false);
    expect(state.canvasOpen).toBe(false);
  });
});
