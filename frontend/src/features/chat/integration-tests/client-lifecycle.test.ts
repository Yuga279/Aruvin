/**
 * ============================================================================
 * FILE: client-lifecycle.test.ts
 * LOCATION: frontend/src/features/chat/integration-tests/client-lifecycle.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify two clients, idempotent submit bodies, and honest reducer statuses.
 *
 * ROLE IN PROJECT:
 *    P10 frontend integration evidence without CSS, jsdom, or Testing Library.
 *
 * KEY COMPONENTS:
 *    - ApiClient: Scripted fetch records bodies without userId/model overrides.
 *    - chatReducer: Truncated completion, temp user replacement, NEW_CHAT.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { ApiClient } from '../../../api/client.ts';
import type { VisibleMessage } from '../../../api/protocol.ts';
import { chatReducer, initialChatState } from '../state/chat-reducer.ts';

describe('P10 client lifecycle', () => {
  it('lets two clients list sessions without identity or model overrides', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchFn: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ items: [], nextCursor: null });
    };
    const first = new ApiClient({ fetch: fetchFn });
    const second = new ApiClient({ fetch: fetchFn });
    await first.listSessions();
    await second.listSessions();
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const body = typeof request.init?.body === 'string' ? request.init.body : '';
      expect(body).not.toContain('userId');
      expect(body).not.toContain('model');
    }
  });

  it('repeats the same submitTurn JSON without override fields', async () => {
    const bodies: string[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return Response.json({
        sessionId: 'sess_1', turnId: 'turn_1', attemptId: 'att_1',
        userMessageId: 'msg_1', streamPath: '/sessions/sess_1/turns/turn_1/stream',
      }, { status: 202 });
    };
    const client = new ApiClient({ fetch: fetchFn });
    const payload = { sessionId: null, content: 'Same input', idempotencyKey: 'p10-ui-request-1' };
    await client.submitTurn(payload);
    await client.submitTurn(payload);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[0])).toEqual(payload);
    expect(bodies[0]).not.toContain('userId');
    expect(bodies[0]).not.toContain('"model"');
  });

  it('keeps truncated as truncated after finalizing', () => {
    let state = chatReducer(initialChatState, { type: 'STREAM_DELTA', payload: { text: 'Partial' } });
    state = chatReducer(state, { type: 'STREAM_STATUS', payload: { status: 'finalizing', truncated: true } });
    state = chatReducer(state, { type: 'STREAM_COMPLETED', payload: { assistantMessageId: 'msg_a', outcome: 'truncated' } });
    expect(state.turnStatus).toBe('truncated');
    expect(state.turnStatus).not.toBe('completed');
  });

  it('does not duplicate the user row on generating or TURN_ACCEPTED', () => {
    const user: VisibleMessage = {
      messageId: 'msg_user', turnId: 'turn_1', eventId: 'evt_1', sequence: 1, role: 'user',
      content: 'Hello', createdAt: '2026-10-06T12:00:00Z', completionStatus: 'accepted', truncated: false,
    };
    const failed: VisibleMessage = {
      messageId: 'msg_asst', turnId: 'turn_1', eventId: 'evt_2', sequence: 2, role: 'assistant',
      content: 'Nope', createdAt: '2026-10-06T12:00:01Z', completionStatus: 'failed', truncated: false,
    };
    let state = { ...initialChatState, messages: [user, failed] };
    state = chatReducer(state, { type: 'STREAM_STATUS', payload: { status: 'generating', truncated: false } });
    expect(state.messages.filter((item) => item.role === 'user')).toHaveLength(1);

    const withTemp = chatReducer(initialChatState, {
      type: 'TURN_SUBMIT_START', payload: { userContent: 'Hello', idempotencyKey: 'p10-ui-request-2' },
    });
    expect(withTemp.messages.some((item) => item.messageId.startsWith('temp_user_'))).toBe(true);
    const accepted = chatReducer(withTemp, {
      type: 'TURN_ACCEPTED',
      payload: { sessionId: 'sess_1', turnId: 'turn_1', attemptId: 'att_1', userMessageId: 'msg_user' },
    });
    expect(accepted.messages.filter((item) => item.role === 'user')).toHaveLength(1);
    expect(accepted.messages.some((item) => item.messageId.startsWith('temp_user_'))).toBe(false);
  });

  it('NEW_CHAT clears the active session without posting', () => {
    const requests: unknown[] = [];
    const fetchFn: typeof fetch = async (url, init) => {
      requests.push({ url, init });
      throw new Error('NEW_CHAT must not fetch');
    };
    new ApiClient({ fetch: fetchFn });
    const next = chatReducer({ ...initialChatState, activeSessionId: 'sess_1' }, { type: 'NEW_CHAT' });
    expect(next.activeSessionId).toBeNull();
    expect(requests).toHaveLength(0);
  });
});
