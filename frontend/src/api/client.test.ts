/**
 * ============================================================================
 * FILE: client.test.ts
 * LOCATION: frontend/src/api/client.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for the Aurvin HTTP API client and SSE stream consumer.
 *
 * ROLE IN PROJECT:
 *    Locks P7 client routing, error mapping, stream framing, comment skipping,
 *    and abort behavior against P1 protocol contracts without live services.
 *
 * KEY COMPONENTS:
 *    - HTTP operation tests: Sessions, turns, retry, cancel, and error bodies.
 *    - SSE consumer tests: Envelope parsing, interruption, and AbortSignal.
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client.ts';
import { API_ROUTES } from './protocol.ts';

describe('ApiClient HTTP operations', () => {
  it('updates session names and pins and deletes through the session resource', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sessionId: 's1', title: 'New', pinned: true })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new ApiClient({ fetch: fetcher, baseUrl: '/api' });
    await expect(client.updateSession('s1', { title: 'New', pinned: true })).resolves.toMatchObject({ title: 'New', pinned: true });
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/sessions/s1', expect.objectContaining({ method: 'PATCH',
      body: JSON.stringify({ title: 'New', pinned: true }) }));
    await expect(client.deleteSession('s1')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/sessions/s1', expect.objectContaining({ method: 'DELETE' }));
  });
  it('instantiates with custom baseUrl and custom fetcher', () => {
    const customFetch = vi.fn();
    const client = new ApiClient({ baseUrl: '/custom-api', fetch: customFetch });
    expect(client.baseUrl).toBe('/custom-api');
  });

  it('lists sessions with query pagination parameters', async () => {
    const mockResponse = {
      items: [
        {
          sessionId: 'sess_1',
          title: 'First Chat',
          createdAt: '2026-10-06T10:00:00.000Z',
          lastActivityAt: '2026-10-06T10:05:00.000Z',
        },
      ],
      nextCursor: 'cursor_abc',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    const result = await client.listSessions({ cursor: 'cursor_123', limit: 15 });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sessions?cursor=cursor_123&limit=15',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('submits turn to /sessions when sessionId is null (new chat)', async () => {
    const mockResponse = {
      sessionId: 'sess_new',
      turnId: 'turn_1',
      attemptId: 'att_1',
      userMessageId: 'msg_1',
      streamPath: '/sessions/sess_new/turns/turn_1/stream',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => mockResponse,
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    const result = await client.submitTurn({
      sessionId: null,
      content: 'Hello world',
      idempotencyKey: 'idem_key_12345',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: null,
          content: 'Hello world',
          idempotencyKey: 'idem_key_12345',
        }),
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('submits turn to /sessions/:id/turns when sessionId is provided', async () => {
    const mockResponse = {
      sessionId: 'sess_1',
      turnId: 'turn_2',
      attemptId: 'att_2',
      userMessageId: 'msg_2',
      streamPath: '/sessions/sess_1/turns/turn_2/stream',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => mockResponse,
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    const result = await client.submitTurn({
      sessionId: 'sess_1',
      content: 'Follow up question',
      idempotencyKey: 'idem_key_99999',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sessions/sess_1/turns',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess_1',
          content: 'Follow up question',
          idempotencyKey: 'idem_key_99999',
        }),
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('calls retryTurn endpoint with idempotency key', async () => {
    const mockResponse = {
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_retry',
      userMessageId: 'msg_1',
      streamPath: '/sessions/sess_1/turns/turn_1/stream',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    const result = await client.retryTurn('sess_1', 'turn_1', {
      idempotencyKey: 'idem_retry_1111',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api' + API_ROUTES.retryTurn('sess_1', 'turn_1'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: 'idem_retry_1111' }),
      }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('calls cancelTurn endpoint with attemptId', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => '',
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    await client.cancelTurn('sess_1', 'turn_1', 'att_1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api' + API_ROUTES.cancelTurn('sess_1', 'turn_1'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ attemptId: 'att_1' }),
      }),
    );
  });

  it('parses structured ClientErrorBody from non-2xx responses', async () => {
    const errorBody = {
      code: 'CONFLICT_ACTIVE_TURN',
      message: 'Another turn is already in progress.',
      retryable: false,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => errorBody,
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });

    await expect(
      client.submitTurn({
        sessionId: 'sess_1',
        content: 'Concurrent message',
        idempotencyKey: 'idem_12345678',
      }),
    ).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'CONFLICT_ACTIVE_TURN',
      status: 409,
      message: 'Another turn is already in progress.',
      retryable: false,
    });
  });

  it('falls back to generic error when response is not JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Not JSON');
      },
      statusText: 'Bad Gateway',
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });

    await expect(client.getSession('sess_1')).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'HTTP_502',
      status: 502,
      retryable: true,
    });
  });
});

describe('ApiClient SSE Stream Consumer', () => {
  function makeReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index]));
          index++;
        } else {
          controller.close();
        }
      },
    });
  }

  it('parses sse envelopes, emits deltas, and finishes on completed event', async () => {
    const ssePayload = [
      ': keepalive ping\n\n',
      'data: {"protocolVersion":1,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":1,"event":{"type":"turn-accepted","userMessageId":"msg_user_1"}}\n\n',
      'data: {"protocolVersion":1,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":2,"event":{"type":"delta","text":"Hello "}}\n\n',
      'data: {"protocolVersion":1,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":3,"event":{"type":"delta","text":"world!"}}\n\n',
      'data: {"protocolVersion":1,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":4,"event":{"type":"completed","assistantMessageId":"msg_ast_1","outcome":"completed"}}\n\n',
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: makeReadableStream(ssePayload),
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    const receivedEnvelopes: unknown[] = [];
    let completedOutcome: string | null = null;

    await client.connectTurnStream('/sessions/sess_1/turns/turn_1/stream', {
      onEnvelope: (env) => receivedEnvelopes.push(env),
      onComplete: (outcome) => {
        completedOutcome = outcome;
      },
    });

    expect(receivedEnvelopes).toHaveLength(4);
    expect(completedOutcome).toBe('completed');
  });

  it('detects abrupt EOF before terminal completed event as interrupted outcome', async () => {
    const partialPayload = [
      'data: {"protocolVersion":1,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":1,"event":{"type":"delta","text":"Half answer..."}}\n\n',
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeReadableStream(partialPayload),
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    let caughtCode = '';

    await client.connectTurnStream('/sessions/sess_1/turns/turn_1/stream', {
      onError: (err) => {
        caughtCode = err.code;
      },
    });

    expect(caughtCode).toBe('STREAM_INTERRUPTED');
  });

  it('stops reading cleanly without error when aborted via AbortSignal', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();

    const mockStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(
          encoder.encode(
            'data: {"protocolVersion":1,"sessionId":"s","turnId":"t","attemptId":"a","sequence":1,"event":{"type":"delta","text":"first"}}\n\n',
          ),
        );
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: mockStream,
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    let errorCalled = false;

    const streamPromise = client.connectTurnStream('/sessions/s/turns/t/stream', {
      signal: controller.signal,
      onError: () => {
        errorCalled = true;
      },
    });

    controller.abort();
    await streamPromise;

    expect(errorCalled).toBe(false);
  });

  it('parses protocolVersion 2 calendar-progress and calendar-operation stream frames', async () => {
    const ssePayload = [
      'data: {"protocolVersion":2,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":1,"event":{"type":"calendar-progress","phase":"repairing"}}\n\n',
      'data: {"protocolVersion":2,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":2,"event":{"type":"calendar-operation","operation":{"operationId":"op_1","state":"succeeded","narration":"pending","retryAction":"none","receipt":{"durable":true,"eventId":"evt_12345","htmlLink":"https://www.google.com/calendar/event?eid=123","expiresAt":"2026-10-22T00:00:00.000Z"}}}}\n\n',
      'data: {"protocolVersion":2,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":3,"event":{"type":"completed","assistantMessageId":"msg_ast_1","outcome":"completed"}}\n\n',
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: makeReadableStream(ssePayload),
    });

    const client = new ApiClient({ baseUrl: '/api', fetch: mockFetch });
    const events: string[] = [];

    await client.connectTurnStream('/sessions/sess_1/turns/turn_1/stream', {
      onEvent: (event) => events.push(event.type),
    });

    expect(events).toEqual(['calendar-progress', 'calendar-operation', 'completed']);
  });
});
