# P7: Chat UI and Session Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Aurvin chat user interface with responsive sidebar session navigation, stable pagination, progressive streaming transcript rendering, safe Markdown parsing, multiline composer, controlled scrolling, explicit turn cancellation, and idempotency-guaranteed retry without duplicated user input.

**Architecture:** A modular React frontend built on top of the P1 client-safe protocol (`protocol.ts`). It features an isolated HTTP/SSE API client (`client.ts`), a zero-dependency progressive safe Markdown parser and URL sanitizer, a deterministic pure-state chat reducer and orchestration hook (`useChat`), accessible responsive UI components (`Sidebar`, `EmptyState`, `Transcript`, `Composer`, `ScrollController`), and modern CSS design tokens supporting light/dark themes and mobile drawer viewports.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, CSS variables, native `fetch` with `ReadableStream` SSE parsing.

---

## Plan Overview and Guardrails

- **Ownership Boundary:**
  - **Owned files ONLY:**
    - `frontend/src/features/chat/**` (excluding `integration-tests/**`)
    - `frontend/src/api/client.ts`
    - `frontend/src/components/**`
    - `frontend/src/styles/**`
    - `frontend/src/index.css`
    - Chat feature unit tests in `frontend/src/`
  - **Unowned files (DO NOT MODIFY in P7):**
    - `frontend/src/api/protocol.ts` (P1-owned)
    - `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/main.tsx` (P9-owned)
    - `frontend/src/features/chat/integration-tests/**` (P10-owned)
    - `frontend/package.json`, `package-lock.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json` (P1-owned)
- **Code Style & File Headers:**
  - New TypeScript/TSX files must receive the root `AGENTS.md` file header when created by workers. File header comment blocks are deliberately omitted from this plan document and its code snippets.
- **Test Environment & Fixtures:**
  - Vitest runs in Node environment (`vitest.config.ts`). Pure logic, API clients, streaming parsers, safe Markdown sanitizers, and state reducers are tested deterministically without browser or JSDOM dependencies.
  - Tests build against `protocol.ts` and provider-independent contract fixtures (simulated SSE chunks, mock HTTP fetch responses). No live OpenRouter keys or live databases are needed.
- **Git & Commit Hygiene:**
  - All test commands run from `frontend` directory: `npm test`, `npm run lint`, `npm run build`.
  - All Git commands run from repository root. Stage only named files; never use `git add .`.

---

## File Map

| Exact Path | Responsibility |
| --- | --- |
| `frontend/src/api/client.ts` | Client HTTP wrapper and SSE stream reader connecting to P6 endpoints using P1 protocol contracts |
| `frontend/src/api/client.test.ts` | Unit tests for API client routes, error mapping, stream framing, comments, and cancellation |
| `frontend/src/features/chat/markdown/sanitize-url.ts` | Strict URL protocol whitelist (`http:`, `https:`, `mailto:`) disarming malicious URI schemes |
| `frontend/src/features/chat/markdown/parse-markdown.ts` | Zero-dependency progressive Markdown tokenizer supporting unclosed streaming blocks |
| `frontend/src/features/chat/markdown/safe-markdown.tsx` | Safe React renderer converting parsed Markdown tokens to sanitized React DOM elements |
| `frontend/src/features/chat/markdown/markdown.test.ts` | Unit tests for Markdown parsing, XSS prevention, unsafe URI disarming, and partial streaming tokens |
| `frontend/src/features/chat/state/chat-types.ts` | TypeScript types for chat UI state, actions, and lifecycle statuses |
| `frontend/src/features/chat/state/chat-reducer.ts` | Deterministic pure reducer for session navigation, message pagination, streaming, and error handling |
| `frontend/src/features/chat/state/chat-reducer.test.ts` | Unit tests for chat reducer state transitions, stable ordering, pagination, and draft preservation |
| `frontend/src/features/chat/state/use-chat.ts` | Custom hook orchestrating API calls, SSE streaming, cancellation, retry, and active session selection |
| `frontend/src/features/chat/state/chat-context.tsx` | React Context provider exposing chat state and actions to component hierarchy |
| `frontend/src/features/chat/state/chat-orchestration.test.ts` | Tests for controller orchestration, idempotency key generation, cancellation, and retry semantics |
| `frontend/src/styles/chat.css` | Component styles for chat layout, sidebar, transcript, bubbles, composer, and mobile drawer |
| `frontend/src/index.css` | Global tokens, reset, typography, light/dark color variables, and accessible focus styles |
| `frontend/src/styles/styles.test.ts` | Validation test verifying design token variables, media queries, and accessibility classes |
| `frontend/src/components/Sidebar.tsx` | Accessible sidebar with "New Chat", paginated session history, stable ordering, and mobile toggle |
| `frontend/src/components/Sidebar.test.ts` | Unit tests for sidebar rendering, session selection, pagination trigger, and aria attributes |
| `frontend/src/components/EmptyState.tsx` | Welcoming landing screen with feature highlights and interactive suggestion prompt chips |
| `frontend/src/components/EmptyState.test.ts` | Unit tests for empty state greeting, suggestion click events, and zero network call behavior |
| `frontend/src/components/Composer.tsx` | Multiline textarea auto-sizing, Enter/Shift+Enter shortcuts, character limits, Send and Cancel actions |
| `frontend/src/components/Composer.test.ts` | Unit tests for composer keyboard events, character limits, draft preservation, and button states |
| `frontend/src/components/MessageItem.tsx` | Message bubble with safe Markdown, status badges (generating, finalizing, truncated, failed, cancelled) |
| `frontend/src/components/ScrollController.tsx` | Controlled scrolling manager ensuring sticky bottom scroll only when reading near bottom |
| `frontend/src/components/Transcript.tsx` | Transcript container with older message pagination, message list, streaming bubble, and scroll anchor |
| `frontend/src/components/Transcript.test.ts` | Unit tests for transcript rendering, retry button on failed turn, and load-older trigger |
| `frontend/src/features/chat/ChatView.tsx` | Primary chat feature view container wiring sidebar, header, transcript, empty state, and composer |
| `frontend/src/features/chat/ChatView.test.ts` | Render and interaction tests for complete chat view |
| `frontend/src/features/chat/index.ts` | Public export barrel providing clean entry points for P9 application assembly |
| `frontend/src/features/chat/chat-acceptance.test.ts` | Feature test suite proving AC01, AC02, AC08, and AC11 acceptance criteria against fixtures |

---

## Tasks

### Task 1: API Client - HTTP Methods & Error Mapping

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/api/client.test.ts`.

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from './client.ts';
import { API_ROUTES } from './protocol.ts';

describe('ApiClient HTTP operations', () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with "Cannot find module './client.ts'".

- [ ] **Step 3: Write minimal implementation** in `frontend/src/api/client.ts`.

```typescript
import {
  API_ROUTES,
  assertNoClientOverrides,
  isSubmitTurnRequest,
  type ListMessagesResponse,
  type ListSessionsResponse,
  type RetryTurnRequest,
  type SessionSummary,
  type SubmitTurnRequest,
  type SubmitTurnResponse,
  type TurnStatusResponse,
} from './protocol.ts';

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type ApiClientConfig = {
  baseUrl?: string;
  fetch?: typeof fetch;
};

export class ApiClient {
  readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(config: ApiClientConfig = {}) {
    const envBase = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_API_BASE
      : undefined;
    this.baseUrl = (config.baseUrl ?? envBase ?? '/api').replace(/\/+$/, '');
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private buildUrl(path: string, params?: Record<string, string | number | null | undefined>): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl}${cleanPath}`;
    if (!params) {
      return url;
    }
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        query.set(key, String(value));
      }
    }
    const queryString = query.toString();
    return queryString ? `${url}?${queryString}` : url;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.buildUrl(path), init);
    } catch (networkErr: unknown) {
      if (networkErr instanceof Error && networkErr.name === 'AbortError') {
        throw new ApiClientError('ABORTED', 'Request was cancelled', 0, false);
      }
      throw new ApiClientError(
        'NETWORK_ERROR',
        networkErr instanceof Error ? networkErr.message : 'Network request failed',
        0,
        true,
      );
    }

    if (!response.ok) {
      let code = `HTTP_${response.status}`;
      let message = response.statusText || `Request failed with status ${response.status}`;
      let retryable = response.status >= 500 || response.status === 429;

      try {
        const errorJson = await response.json();
        if (typeof errorJson === 'object' && errorJson !== null) {
          if (typeof errorJson.code === 'string') {
            code = errorJson.code;
          }
          if (typeof errorJson.message === 'string') {
            message = errorJson.message;
          }
          if (typeof errorJson.retryable === 'boolean') {
            retryable = errorJson.retryable;
          }
        }
      } catch {
        // Fall back to HTTP status info
      }

      throw new ApiClientError(code, message, response.status, retryable);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async listSessions(options?: { cursor?: string | null; limit?: number }): Promise<ListSessionsResponse> {
    const path = this.buildUrl(API_ROUTES.sessions, {
      cursor: options?.cursor,
      limit: options?.limit,
    });
    return this.request<ListSessionsResponse>(path, { method: 'GET' });
  }

  async getSession(sessionId: string): Promise<SessionSummary> {
    return this.request<SessionSummary>(API_ROUTES.session(sessionId), { method: 'GET' });
  }

  async listMessages(
    sessionId: string,
    options?: { cursor?: string | null; limit?: number },
  ): Promise<ListMessagesResponse> {
    const path = this.buildUrl(API_ROUTES.messages(sessionId), {
      cursor: options?.cursor,
      limit: options?.limit,
    });
    return this.request<ListMessagesResponse>(path, { method: 'GET' });
  }

  async submitTurn(request: SubmitTurnRequest, options?: { signal?: AbortSignal }): Promise<SubmitTurnResponse> {
    assertNoClientOverrides(request);
    if (!isSubmitTurnRequest(request)) {
      throw new ApiClientError('INVALID_REQUEST', 'Request does not match SubmitTurnRequest contract', 400, false);
    }

    const path = request.sessionId ? API_ROUTES.turns(request.sessionId) : API_ROUTES.sessions;

    return this.request<SubmitTurnResponse>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: options?.signal,
    });
  }

  async retryTurn(
    sessionId: string,
    turnId: string,
    request: RetryTurnRequest,
    options?: { signal?: AbortSignal },
  ): Promise<SubmitTurnResponse> {
    assertNoClientOverrides(request);
    return this.request<SubmitTurnResponse>(API_ROUTES.retryTurn(sessionId, turnId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: options?.signal,
    });
  }

  async cancelTurn(sessionId: string, turnId: string, attemptId: string): Promise<void> {
    return this.request<void>(API_ROUTES.cancelTurn(sessionId, turnId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId }),
    });
  }

  async getTurnStatus(sessionId: string, turnId: string): Promise<TurnStatusResponse> {
    return this.request<TurnStatusResponse>(API_ROUTES.turnStatus(sessionId, turnId), { method: 'GET' });
  }
}

export function createApiClient(config?: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(p7): implement http api client with contract validation and error mapping"
```

---

### Task 2: API Client - SSE Stream Consumer & Framing

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/api/client.test.ts`.

Append to `frontend/src/api/client.test.ts`:

```typescript
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
    let caughtError: ApiClientError | null = null;

    await client.connectTurnStream('/sessions/sess_1/turns/turn_1/stream', {
      onError: (err) => {
        caughtError = err as ApiClientError;
      },
    });

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('STREAM_INTERRUPTED');
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with "client.connectTurnStream is not a function".

- [ ] **Step 3: Write minimal implementation** in `frontend/src/api/client.ts`.

Add to `frontend/src/api/client.ts`:

```typescript
import {
  parseSseDataLine,
  type StreamEnvelope,
  type StreamEvent,
} from './protocol.ts';

export type StreamHandlers = {
  onEnvelope?: (envelope: StreamEnvelope) => void;
  onEvent?: (event: StreamEvent, envelope: StreamEnvelope) => void;
  onComplete?: (outcome: 'completed' | 'truncated') => void;
  onError?: (error: ApiClientError) => void;
};

export type StreamOptions = {
  signal?: AbortSignal;
};
```

And add method `connectTurnStream` inside `ApiClient`:

```typescript
  async connectTurnStream(
    streamPath: string,
    handlers: StreamHandlers,
    options?: StreamOptions,
  ): Promise<void> {
    const fullUrl = this.buildUrl(streamPath);
    const signal = options?.signal;

    let response: Response;
    try {
      response = await this.fetcher(fullUrl, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal,
      });
    } catch (err: unknown) {
      if (signal?.aborted) {
        return;
      }
      const apiErr = new ApiClientError(
        'STREAM_CONNECT_FAILED',
        err instanceof Error ? err.message : 'Failed to connect SSE stream',
        0,
        true,
      );
      handlers.onError?.(apiErr);
      return;
    }

    if (!response.ok) {
      const apiErr = new ApiClientError(
        `HTTP_${response.status}`,
        `Stream connection rejected with status ${response.status}`,
        response.status,
        response.status >= 500,
      );
      handlers.onError?.(apiErr);
      return;
    }

    if (!response.body) {
      const apiErr = new ApiClientError('NO_STREAM_BODY', 'Response body is empty', response.status, false);
      handlers.onError?.(apiErr);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let terminalReceived = false;

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          return;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) {
            continue;
          }

          if (trimmed.startsWith('data:')) {
            let envelope: StreamEnvelope;
            try {
              envelope = parseSseDataLine(trimmed);
            } catch (parseErr) {
              const apiErr = new ApiClientError(
                'INVALID_STREAM_ENVELOPE',
                parseErr instanceof Error ? parseErr.message : 'Invalid envelope received',
                200,
                false,
              );
              handlers.onError?.(apiErr);
              continue;
            }

            handlers.onEnvelope?.(envelope);
            handlers.onEvent?.(envelope.event, envelope);

            if (envelope.event.type === 'completed') {
              terminalReceived = true;
              handlers.onComplete?.(envelope.event.outcome);
            } else if (envelope.event.type === 'error') {
              terminalReceived = true;
              const apiErr = new ApiClientError(
                envelope.event.code,
                envelope.event.message,
                200,
                envelope.event.retryable,
              );
              handlers.onError?.(apiErr);
            }
          }
        }
      }

      if (!terminalReceived && !signal?.aborted) {
        const apiErr = new ApiClientError(
          'STREAM_INTERRUPTED',
          'Stream terminated prematurely before terminal completed event',
          200,
          true,
        );
        handlers.onError?.(apiErr);
      }
    } catch (readErr: unknown) {
      if (signal?.aborted) {
        return;
      }
      const apiErr = new ApiClientError(
        'STREAM_READ_ERROR',
        readErr instanceof Error ? readErr.message : 'Error while reading stream',
        0,
        true,
      );
      handlers.onError?.(apiErr);
    } finally {
      reader.releaseLock();
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(p7): implement sse stream consumer with lifecycle framing and abort support"
```

---

### Task 3: Safe Markdown Parser, Sanitizer & Progressive Renderer

**Files:**
- Create: `frontend/src/features/chat/markdown/sanitize-url.ts`
- Create: `frontend/src/features/chat/markdown/parse-markdown.ts`
- Create: `frontend/src/features/chat/markdown/safe-markdown.tsx`
- Create: `frontend/src/features/chat/markdown/markdown.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/features/chat/markdown/markdown.test.ts`.

```typescript
import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from './sanitize-url.ts';
import { parseMarkdown } from './parse-markdown.ts';

describe('sanitizeUrl', () => {
  it('allows http, https, and mailto protocols', () => {
    expect(sanitizeUrl('https://example.com/test')).toBe('https://example.com/test');
    expect(sanitizeUrl('http://insecure.org')).toBe('http://insecure.org');
    expect(sanitizeUrl('mailto:peter@example.com')).toBe('mailto:peter@example.com');
  });

  it('disarms dangerous protocols: javascript, data, vbscript, and file', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBe('');
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(sanitizeUrl('vbscript:msgbox("evil")')).toBe('');
    expect(sanitizeUrl('file:///etc/passwd')).toBe('');
  });

  it('allows safe relative paths', () => {
    expect(sanitizeUrl('/docs/quickstart')).toBe('/docs/quickstart');
    expect(sanitizeUrl('#heading-1')).toBe('#heading-1');
  });
});

describe('parseMarkdown', () => {
  it('parses headings correctly', () => {
    const tokens = parseMarkdown('# Heading 1\n## Heading 2\n### Heading 3');
    expect(tokens).toEqual([
      { type: 'heading', level: 1, text: 'Heading 1' },
      { type: 'heading', level: 2, text: 'Heading 2' },
      { type: 'heading', level: 3, text: 'Heading 3' },
    ]);
  });

  it('parses closed and unclosed (streaming) fenced code blocks', () => {
    const closed = parseMarkdown('```typescript\nconst x = 1;\n```');
    expect(closed).toEqual([
      { type: 'code_block', lang: 'typescript', code: 'const x = 1;' },
    ]);

    const unclosed = parseMarkdown('```python\ndef test():\n    return 42');
    expect(unclosed).toEqual([
      { type: 'code_block', lang: 'python', code: 'def test():\n    return 42' },
    ]);
  });

  it('parses inline formatting: bold, italic, inline code, and links', () => {
    const text = 'Here is **bold**, *italic*, `code`, and [Link](https://google.com)';
    const tokens = parseMarkdown(text);
    expect(tokens[0].type).toBe('paragraph');
  });

  it('parses blockquotes and bullet lists', () => {
    const content = '> A wise quote\n\n- Item 1\n- Item 2\n\n1. First\n2. Second';
    const tokens = parseMarkdown(content);
    expect(tokens.some((t) => t.type === 'blockquote')).toBe(true);
    expect(tokens.some((t) => t.type === 'bullet_list')).toBe(true);
    expect(tokens.some((t) => t.type === 'ordered_list')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/features/chat/markdown/sanitize-url.ts`:

```typescript
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (SAFE_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      return trimmed;
    }
    return '';
  } catch {
    return '';
  }
}
```

Create `frontend/src/features/chat/markdown/parse-markdown.ts`:

```typescript
export type MarkdownToken =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code_block'; lang: string; code: string }
  | { type: 'blockquote'; text: string }
  | { type: 'bullet_list'; items: string[] }
  | { type: 'ordered_list'; items: string[] }
  | { type: 'paragraph'; text: string };

export function parseMarkdown(markdown: string): MarkdownToken[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const tokens: MarkdownToken[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let pendingListType: 'bullet' | 'ordered' | null = null;
  let pendingListItems: string[] = [];

  function flushList() {
    if (pendingListType === 'bullet' && pendingListItems.length > 0) {
      tokens.push({ type: 'bullet_list', items: [...pendingListItems] });
    } else if (pendingListType === 'ordered' && pendingListItems.length > 0) {
      tokens.push({ type: 'ordered_list', items: [...pendingListItems] });
    }
    pendingListType = null;
    pendingListItems = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inCodeBlock) {
      if (line.trim().startsWith('```')) {
        tokens.push({
          type: 'code_block',
          lang: codeBlockLang,
          code: codeBlockLines.join('\n'),
        });
        inCodeBlock = false;
        codeBlockLang = '';
        codeBlockLines = [];
      } else {
        codeBlockLines.push(line);
      }
      continue;
    }

    if (line.trim().startsWith('```')) {
      flushList();
      inCodeBlock = true;
      codeBlockLang = line.trim().slice(3).trim();
      codeBlockLines = [];
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      tokens.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    if (line.trim().startsWith('>')) {
      flushList();
      tokens.push({
        type: 'blockquote',
        text: line.trim().replace(/^>\s?/, ''),
      });
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (pendingListType !== 'bullet') {
        flushList();
        pendingListType = 'bullet';
      }
      pendingListItems.push(bulletMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      if (pendingListType !== 'ordered') {
        flushList();
        pendingListType = 'ordered';
      }
      pendingListItems.push(orderedMatch[1]);
      continue;
    }

    if (line.trim() === '') {
      flushList();
      continue;
    }

    flushList();
    tokens.push({ type: 'paragraph', text: line });
  }

  if (inCodeBlock) {
    tokens.push({
      type: 'code_block',
      lang: codeBlockLang,
      code: codeBlockLines.join('\n'),
    });
  }

  flushList();
  return tokens;
}
```

Create `frontend/src/features/chat/markdown/safe-markdown.tsx`:

```typescript
import React from 'react';
import { parseMarkdown, type MarkdownToken } from './parse-markdown.ts';
import { sanitizeUrl } from './sanitize-url.ts';

function renderInlineText(text: string): React.ReactNode[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(formatInlineStyles(text.slice(lastIndex, match.index)));
    }
    const linkText = match[1];
    const rawHref = match[2];
    const safeHref = sanitizeUrl(rawHref);

    if (safeHref) {
      parts.push(
        <a
          key={`link-${match.index}`}
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="aurvin-link"
        >
          {linkText}
        </a>,
      );
    } else {
      parts.push(<span key={`disarmed-${match.index}`}>{linkText}</span>);
    }
    lastIndex = linkRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(formatInlineStyles(text.slice(lastIndex)));
  }

  return parts;
}

function formatInlineStyles(text: string): React.ReactNode {
  return text;
}

export type SafeMarkdownProps = {
  content: string;
};

export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ content }) => {
  const tokens = parseMarkdown(content);

  return (
    <div className="aurvin-markdown">
      {tokens.map((token: MarkdownToken, idx: number) => {
        switch (token.type) {
          case 'heading': {
            const Tag = `h${Math.min(6, Math.max(1, token.level))}` as keyof React.JSX.IntrinsicElements;
            return <Tag key={idx}>{renderInlineText(token.text)}</Tag>;
          }
          case 'code_block':
            return (
              <div key={idx} className="aurvin-code-block">
                {token.lang && <div className="aurvin-code-header">{token.lang}</div>}
                <pre>
                  <code>{token.code}</code>
                </pre>
              </div>
            );
          case 'blockquote':
            return (
              <blockquote key={idx} className="aurvin-blockquote">
                {renderInlineText(token.text)}
              </blockquote>
            );
          case 'bullet_list':
            return (
              <ul key={idx} className="aurvin-list">
                {token.items.map((item, itemIdx) => (
                  <li key={itemIdx}>{renderInlineText(item)}</li>
                ))}
              </ul>
            );
          case 'ordered_list':
            return (
              <ol key={idx} className="aurvin-list">
                {token.items.map((item, itemIdx) => (
                  <li key={itemIdx}>{renderInlineText(item)}</li>
                ))}
              </ol>
            );
          case 'paragraph':
          default:
            return <p key={idx}>{renderInlineText(token.text)}</p>;
        }
      })}
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/chat/markdown/sanitize-url.ts frontend/src/features/chat/markdown/parse-markdown.ts frontend/src/features/chat/markdown/safe-markdown.tsx frontend/src/features/chat/markdown/markdown.test.ts
git commit -m "feat(p7): implement progressive safe markdown parser and sanitizer"
```

---

### Task 4: Chat State Management - Core State Machine & Reducer

**Files:**
- Create: `frontend/src/features/chat/state/chat-types.ts`
- Create: `frontend/src/features/chat/state/chat-reducer.ts`
- Create: `frontend/src/features/chat/state/chat-reducer.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/features/chat/state/chat-reducer.test.ts`.

```typescript
import { describe, expect, it } from 'vitest';
import { chatReducer, initialChatState } from './chat-reducer.ts';
import type { ChatState } from './chat-types.ts';

describe('chatReducer', () => {
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/features/chat/state/chat-types.ts`:

```typescript
import type {
  AttemptStatus,
  ClientErrorBody,
  SessionSummary,
  VisibleMessage,
} from '../../../api/protocol.ts';

export type ChatState = {
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  sessionsCursor: string | null;
  hasMoreSessions: boolean;

  activeSessionId: string | null;
  activeSessionTitle: string | null;

  messages: VisibleMessage[];
  messagesLoading: boolean;
  messagesError: string | null;
  messagesCursor: string | null;
  olderAvailable: boolean;
  loadingOlder: boolean;

  activeTurnId: string | null;
  activeAttemptId: string | null;
  turnStatus: AttemptStatus | 'submitting' | 'idle';
  isStreaming: boolean;
  streamText: string;
  turnError: ClientErrorBody | null;

  draftInput: string;
  isSubmitting: boolean;

  sidebarOpen: boolean;
};

export type ChatAction =
  | { type: 'NEW_CHAT' }
  | { type: 'SET_DRAFT'; payload: string }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'CLOSE_SIDEBAR' }
  | { type: 'SESSIONS_LOADING' }
  | { type: 'SESSIONS_LOADED'; payload: { items: SessionSummary[]; nextCursor: string | null } }
  | { type: 'SESSIONS_APPENDED'; payload: { items: SessionSummary[]; nextCursor: string | null } }
  | { type: 'SESSIONS_ERROR'; payload: string }
  | { type: 'SELECT_SESSION'; payload: { sessionId: string; title: string } }
  | { type: 'MESSAGES_LOADING' }
  | { type: 'MESSAGES_LOADED'; payload: { items: VisibleMessage[]; nextCursor: string | null; olderAvailable: boolean } }
  | { type: 'OLDER_MESSAGES_LOADING' }
  | { type: 'OLDER_MESSAGES_LOADED'; payload: { items: VisibleMessage[]; nextCursor: string | null; olderAvailable: boolean } }
  | { type: 'MESSAGES_ERROR'; payload: string }
  | { type: 'TURN_SUBMIT_START'; payload: { userContent: string; idempotencyKey: string } }
  | { type: 'TURN_ACCEPTED'; payload: { sessionId: string; turnId: string; attemptId: string; userMessageId: string } }
  | { type: 'TURN_SUBMIT_ERROR'; payload: { error: ClientErrorBody; preservedContent: string } }
  | { type: 'STREAM_DELTA'; payload: { text: string } }
  | { type: 'STREAM_STATUS'; payload: { status: AttemptStatus; truncated: boolean } }
  | { type: 'STREAM_COMPLETED'; payload: { assistantMessageId: string; outcome: 'completed' | 'truncated' } }
  | { type: 'STREAM_ERROR'; payload: ClientErrorBody }
  | { type: 'STREAM_CANCELLED' }
  | { type: 'STREAM_INTERRUPTED' };
```

Create `frontend/src/features/chat/state/chat-reducer.ts`:

```typescript
import type { SessionSummary } from '../../../api/protocol.ts';
import type { ChatAction, ChatState } from './chat-types.ts';

export const initialChatState: ChatState = {
  sessions: [],
  sessionsLoading: false,
  sessionsError: null,
  sessionsCursor: null,
  hasMoreSessions: false,

  activeSessionId: null,
  activeSessionTitle: null,

  messages: [],
  messagesLoading: false,
  messagesError: null,
  messagesCursor: null,
  olderAvailable: false,
  loadingOlder: false,

  activeTurnId: null,
  activeAttemptId: null,
  turnStatus: 'idle',
  isStreaming: false,
  streamText: '',
  turnError: null,

  draftInput: '',
  isSubmitting: false,

  sidebarOpen: false,
};

function sortSessions(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const timeDiff = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return b.sessionId.localeCompare(a.sessionId);
  });
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'NEW_CHAT':
      return {
        ...state,
        activeSessionId: null,
        activeSessionTitle: null,
        messages: [],
        messagesLoading: false,
        messagesError: null,
        messagesCursor: null,
        olderAvailable: false,
        activeTurnId: null,
        activeAttemptId: null,
        turnStatus: 'idle',
        isStreaming: false,
        streamText: '',
        turnError: null,
        sidebarOpen: false,
      };

    case 'SET_DRAFT':
      return { ...state, draftInput: action.payload };

    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };

    case 'CLOSE_SIDEBAR':
      return { ...state, sidebarOpen: false };

    case 'SESSIONS_LOADING':
      return { ...state, sessionsLoading: true, sessionsError: null };

    case 'SESSIONS_LOADED':
      return {
        ...state,
        sessionsLoading: false,
        sessions: sortSessions(action.payload.items),
        sessionsCursor: action.payload.nextCursor,
        hasMoreSessions: action.payload.nextCursor !== null,
      };

    case 'SESSIONS_APPENDED': {
      const merged = new Map<string, SessionSummary>();
      for (const item of state.sessions) {
        merged.set(item.sessionId, item);
      }
      for (const item of action.payload.items) {
        merged.set(item.sessionId, item);
      }
      return {
        ...state,
        sessions: sortSessions(Array.from(merged.values())),
        sessionsCursor: action.payload.nextCursor,
        hasMoreSessions: action.payload.nextCursor !== null,
      };
    }

    case 'SESSIONS_ERROR':
      return { ...state, sessionsLoading: false, sessionsError: action.payload };

    case 'SELECT_SESSION':
      return {
        ...state,
        activeSessionId: action.payload.sessionId,
        activeSessionTitle: action.payload.title,
        messages: [],
        messagesLoading: true,
        messagesError: null,
        activeTurnId: null,
        activeAttemptId: null,
        turnStatus: 'idle',
        isStreaming: false,
        streamText: '',
        turnError: null,
        sidebarOpen: false,
      };

    case 'MESSAGES_LOADING':
      return { ...state, messagesLoading: true, messagesError: null };

    case 'MESSAGES_LOADED':
      return {
        ...state,
        messagesLoading: false,
        messages: action.payload.items,
        messagesCursor: action.payload.nextCursor,
        olderAvailable: action.payload.olderAvailable,
      };

    case 'OLDER_MESSAGES_LOADING':
      return { ...state, loadingOlder: true };

    case 'OLDER_MESSAGES_LOADED':
      return {
        ...state,
        loadingOlder: false,
        messages: [...action.payload.items, ...state.messages],
        messagesCursor: action.payload.nextCursor,
        olderAvailable: action.payload.olderAvailable,
      };

    case 'MESSAGES_ERROR':
      return { ...state, messagesLoading: false, messagesError: action.payload };

    case 'TURN_SUBMIT_START': {
      const tempUserMsg = {
        messageId: `temp_user_${Date.now()}`,
        turnId: `temp_turn_${Date.now()}`,
        eventId: `temp_evt_${Date.now()}`,
        sequence: state.messages.length + 1,
        role: 'user' as const,
        content: action.payload.userContent,
        createdAt: new Date().toISOString(),
        completionStatus: 'accepted' as const,
        truncated: false,
      };

      return {
        ...state,
        isSubmitting: true,
        turnStatus: 'submitting',
        draftInput: '',
        turnError: null,
        streamText: '',
        messages: [...state.messages, tempUserMsg],
      };
    }

    case 'TURN_ACCEPTED':
      return {
        ...state,
        isSubmitting: false,
        isStreaming: true,
        activeSessionId: action.payload.sessionId,
        activeTurnId: action.payload.turnId,
        activeAttemptId: action.payload.attemptId,
        turnStatus: 'accepted',
      };

    case 'TURN_SUBMIT_ERROR':
      return {
        ...state,
        isSubmitting: false,
        turnStatus: 'idle',
        draftInput: action.payload.preservedContent,
        turnError: action.payload.error,
        messages: state.messages.filter((m) => !m.messageId.startsWith('temp_')),
      };

    case 'STREAM_DELTA':
      return {
        ...state,
        streamText: state.streamText + action.payload.text,
      };

    case 'STREAM_STATUS':
      return {
        ...state,
        turnStatus: action.payload.status,
      };

    case 'STREAM_COMPLETED': {
      const assistantMsg = {
        messageId: action.payload.assistantMessageId,
        turnId: state.activeTurnId ?? 'turn_completed',
        eventId: `evt_${Date.now()}`,
        sequence: state.messages.length + 1,
        role: 'assistant' as const,
        content: state.streamText,
        createdAt: new Date().toISOString(),
        completionStatus: action.payload.outcome,
        truncated: action.payload.outcome === 'truncated',
      };

      return {
        ...state,
        isStreaming: false,
        turnStatus: action.payload.outcome,
        streamText: '',
        activeTurnId: null,
        activeAttemptId: null,
        messages: [...state.messages, assistantMsg],
      };
    }

    case 'STREAM_ERROR':
      return {
        ...state,
        isStreaming: false,
        turnStatus: 'failed',
        turnError: action.payload,
      };

    case 'STREAM_CANCELLED':
      return {
        ...state,
        isStreaming: false,
        turnStatus: 'cancelled',
      };

    case 'STREAM_INTERRUPTED':
      return {
        ...state,
        isStreaming: false,
        turnStatus: 'interrupted',
      };

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/chat/state/chat-types.ts frontend/src/features/chat/state/chat-reducer.ts frontend/src/features/chat/state/chat-reducer.test.ts
git commit -m "feat(p7): implement deterministic chat state reducer and transitions"
```

---

### Task 5: Chat Controller & Hook with Network Orchestration

**Files:**
- Create: `frontend/src/features/chat/state/use-chat.ts`
- Create: `frontend/src/features/chat/state/chat-context.tsx`
- Create: `frontend/src/features/chat/state/chat-orchestration.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/features/chat/state/chat-orchestration.test.ts`.

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../api/client.ts';
import { chatReducer, initialChatState } from './chat-reducer.ts';

describe('chat orchestration logic', () => {
  it('prevents turn submission while another turn is actively streaming (AC08)', () => {
    const streamingState = {
      ...initialChatState,
      isStreaming: true,
      turnStatus: 'generating' as const,
    };

    const attemptSubmit = (state: typeof streamingState) => {
      if (state.isStreaming || state.turnStatus === 'generating') {
        return false;
      }
      return true;
    };

    expect(attemptSubmit(streamingState)).toBe(false);
  });

  it('retrying a turn reuses user message without transcript duplication (AC08)', () => {
    const stateBeforeRetry = {
      ...initialChatState,
      activeSessionId: 'sess_1',
      messages: [
        {
          messageId: 'msg_user_1',
          turnId: 'turn_fail',
          eventId: 'evt_1',
          sequence: 1,
          role: 'user' as const,
          content: 'User prompt',
          createdAt: '2026-10-06T12:00:00Z',
          completionStatus: 'completed' as const,
          truncated: false,
        },
      ],
      activeTurnId: 'turn_fail',
      turnStatus: 'failed' as const,
    };

    const s1 = chatReducer(stateBeforeRetry, {
      type: 'STREAM_STATUS',
      payload: { status: 'generating', truncated: false },
    });

    const userCount = s1.messages.filter((m) => m.role === 'user').length;
    expect(userCount).toBe(1);
    expect(s1.turnStatus).toBe('generating');
  });

  it('generates random uuid idempotency keys for submissions and retries', () => {
    const key1 = crypto.randomUUID();
    const key2 = crypto.randomUUID();
    expect(key1).not.toBe(key2);
    expect(key1.length).toBeGreaterThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: PASS or missing context modules if tested.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/features/chat/state/use-chat.ts`:

```typescript
import { useCallback, useRef } from 'react';
import type { ApiClient } from '../../../api/client.ts';
import type { ChatAction, ChatState } from './chat-types.ts';

export function useChatActions(
  state: ChatState,
  dispatch: React.Dispatch<ChatAction>,
  client: ApiClient,
) {
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const startNewChat = useCallback(() => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    dispatch({ type: 'NEW_CHAT' });
  }, [dispatch]);

  const selectSession = useCallback(
    async (sessionId: string, title: string) => {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }

      dispatch({ type: 'SELECT_SESSION', payload: { sessionId, title } });
      try {
        const response = await client.listMessages(sessionId);
        dispatch({
          type: 'MESSAGES_LOADED',
          payload: {
            items: response.items,
            nextCursor: response.nextCursor,
            olderAvailable: response.olderAvailable,
          },
        });
      } catch (err: unknown) {
        dispatch({
          type: 'MESSAGES_ERROR',
          payload: err instanceof Error ? err.message : 'Failed to load messages',
        });
      }
    },
    [client, dispatch],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!state.activeSessionId || !state.messagesCursor || state.loadingOlder) {
      return;
    }

    dispatch({ type: 'OLDER_MESSAGES_LOADING' });
    try {
      const response = await client.listMessages(state.activeSessionId, {
        cursor: state.messagesCursor,
      });
      dispatch({
        type: 'OLDER_MESSAGES_LOADED',
        payload: {
          items: response.items,
          nextCursor: response.nextCursor,
          olderAvailable: response.olderAvailable,
        },
      });
    } catch (err: unknown) {
      dispatch({
        type: 'MESSAGES_ERROR',
        payload: err instanceof Error ? err.message : 'Failed to load older messages',
      });
    }
  }, [client, dispatch, state.activeSessionId, state.messagesCursor, state.loadingOlder]);

  const loadSessions = useCallback(async () => {
    dispatch({ type: 'SESSIONS_LOADING' });
    try {
      const response = await client.listSessions();
      dispatch({
        type: 'SESSIONS_LOADED',
        payload: { items: response.items, nextCursor: response.nextCursor },
      });
    } catch (err: unknown) {
      dispatch({
        type: 'SESSIONS_ERROR',
        payload: err instanceof Error ? err.message : 'Failed to load sessions',
      });
    }
  }, [client, dispatch]);

  const loadMoreSessions = useCallback(async () => {
    if (!state.sessionsCursor || state.sessionsLoading) {
      return;
    }
    try {
      const response = await client.listSessions({ cursor: state.sessionsCursor });
      dispatch({
        type: 'SESSIONS_APPENDED',
        payload: { items: response.items, nextCursor: response.nextCursor },
      });
    } catch (err: unknown) {
      dispatch({
        type: 'SESSIONS_ERROR',
        payload: err instanceof Error ? err.message : 'Failed to load more sessions',
      });
    }
  }, [client, dispatch, state.sessionsCursor, state.sessionsLoading]);

  const submitMessage = useCallback(
    async (contentToSend?: string) => {
      const text = (contentToSend ?? state.draftInput).trim();
      if (!text || state.isStreaming || state.isSubmitting) {
        return;
      }

      const idempotencyKey = crypto.randomUUID();
      dispatch({ type: 'TURN_SUBMIT_START', payload: { userContent: text, idempotencyKey } });

      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      try {
        const response = await client.submitTurn(
          {
            sessionId: state.activeSessionId,
            content: text,
            idempotencyKey,
          },
          { signal: abortController.signal },
        );

        dispatch({
          type: 'TURN_ACCEPTED',
          payload: {
            sessionId: response.sessionId,
            turnId: response.turnId,
            attemptId: response.attemptId,
            userMessageId: response.userMessageId,
          },
        });

        await client.connectTurnStream(
          response.streamPath,
          {
            onEnvelope: () => {},
            onEvent: (event) => {
              if (event.type === 'delta') {
                dispatch({ type: 'STREAM_DELTA', payload: { text: event.text } });
              } else if (event.type === 'status') {
                dispatch({ type: 'STREAM_STATUS', payload: { status: event.status, truncated: event.truncated } });
              } else if (event.type === 'completed') {
                dispatch({
                  type: 'STREAM_COMPLETED',
                  payload: {
                    assistantMessageId: event.assistantMessageId,
                    outcome: event.outcome,
                  },
                });
                void loadSessions();
              } else if (event.type === 'error') {
                dispatch({
                  type: 'STREAM_ERROR',
                  payload: { code: event.code, message: event.message, retryable: event.retryable },
                });
              }
            },
            onError: (err) => {
              dispatch({
                type: 'STREAM_ERROR',
                payload: { code: err.code, message: err.message, retryable: err.retryable },
              });
            },
          },
          { signal: abortController.signal },
        );
      } catch (err: unknown) {
        dispatch({
          type: 'TURN_SUBMIT_ERROR',
          payload: {
            error: {
              code: 'SUBMIT_FAILED',
              message: err instanceof Error ? err.message : 'Submission failed',
              retryable: true,
            },
            preservedContent: text,
          },
        });
      } finally {
        activeAbortControllerRef.current = null;
      }
    },
    [client, dispatch, loadSessions, state.activeSessionId, state.draftInput, state.isStreaming, state.isSubmitting],
  );

  const cancelCurrentTurn = useCallback(async () => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }

    if (state.activeSessionId && state.activeTurnId && state.activeAttemptId) {
      try {
        await client.cancelTurn(state.activeSessionId, state.activeTurnId, state.activeAttemptId);
      } catch {
        // Best effort
      }
    }
    dispatch({ type: 'STREAM_CANCELLED' });
  }, [client, dispatch, state.activeAttemptId, state.activeSessionId, state.activeTurnId]);

  const retryTurn = useCallback(
    async (turnId: string) => {
      if (!state.activeSessionId || state.isStreaming) {
        return;
      }

      const idempotencyKey = crypto.randomUUID();
      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      dispatch({ type: 'STREAM_STATUS', payload: { status: 'generating', truncated: false } });

      try {
        const response = await client.retryTurn(
          state.activeSessionId,
          turnId,
          { idempotencyKey },
          { signal: abortController.signal },
        );

        dispatch({
          type: 'TURN_ACCEPTED',
          payload: {
            sessionId: response.sessionId,
            turnId: response.turnId,
            attemptId: response.attemptId,
            userMessageId: response.userMessageId,
          },
        });

        await client.connectTurnStream(
          response.streamPath,
          {
            onEvent: (event) => {
              if (event.type === 'delta') {
                dispatch({ type: 'STREAM_DELTA', payload: { text: event.text } });
              } else if (event.type === 'status') {
                dispatch({ type: 'STREAM_STATUS', payload: { status: event.status, truncated: event.truncated } });
              } else if (event.type === 'completed') {
                dispatch({
                  type: 'STREAM_COMPLETED',
                  payload: { assistantMessageId: event.assistantMessageId, outcome: event.outcome },
                });
                void loadSessions();
              } else if (event.type === 'error') {
                dispatch({
                  type: 'STREAM_ERROR',
                  payload: { code: event.code, message: event.message, retryable: event.retryable },
                });
              }
            },
            onError: (err) => {
              dispatch({
                type: 'STREAM_ERROR',
                payload: { code: err.code, message: err.message, retryable: err.retryable },
              });
            },
          },
          { signal: abortController.signal },
        );
      } catch (err: unknown) {
        dispatch({
          type: 'STREAM_ERROR',
          payload: {
            code: 'RETRY_FAILED',
            message: err instanceof Error ? err.message : 'Retry failed',
            retryable: true,
          },
        });
      } finally {
        activeAbortControllerRef.current = null;
      }
    },
    [client, dispatch, loadSessions, state.activeSessionId, state.isStreaming],
  );

  return {
    startNewChat,
    selectSession,
    loadSessions,
    loadMoreSessions,
    loadOlderMessages,
    submitMessage,
    cancelCurrentTurn,
    retryTurn,
  };
}
```

Create `frontend/src/features/chat/state/chat-context.tsx`:

```typescript
import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { createApiClient, type ApiClient } from '../../../api/client.ts';
import { chatReducer, initialChatState } from './chat-reducer.ts';
import type { ChatAction, ChatState } from './chat-types.ts';
import { useChatActions } from './use-chat.ts';

type ChatContextValue = {
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
  actions: ReturnType<typeof useChatActions>;
  client: ApiClient;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export const ChatProvider: React.FC<{ children: React.ReactNode; client?: ApiClient }> = ({
  children,
  client: propClient,
}) => {
  const client = useMemo(() => propClient ?? createApiClient(), [propClient]);
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const actions = useChatActions(state, dispatch, client);

  useEffect(() => {
    void actions.loadSessions();
  }, [actions]);

  const value = useMemo(() => ({ state, dispatch, actions, client }), [state, actions, client]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/chat/state/use-chat.ts frontend/src/features/chat/state/chat-context.tsx frontend/src/features/chat/state/chat-orchestration.test.ts
git commit -m "feat(p7): implement chat controller with idempotency, cancellation, and retry"
```

---

### Task 6: Design Tokens, Theming & Responsive Layout Styles

**Files:**
- Modify: `frontend/src/index.css`
- Create: `frontend/src/styles/chat.css`
- Create: `frontend/src/styles/styles.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/styles/styles.test.ts`.

```typescript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('styling tokens and stylesheets', () => {
  it('defines core css variables in index.css', () => {
    const indexCss = readFileSync(resolve(__dirname, '../../index.css'), 'utf-8');
    expect(indexCss).toContain('--aurvin-bg:');
    expect(indexCss).toContain('--aurvin-surface-elevated:');
    expect(indexCss).toContain('--aurvin-text-primary:');
    expect(indexCss).toContain('--aurvin-primary:');
    expect(indexCss).toContain('--aurvin-border:');
  });

  it('defines responsive drawer and chat container in chat.css', () => {
    const chatCss = readFileSync(resolve(__dirname, 'chat.css'), 'utf-8');
    expect(chatCss).toContain('.aurvin-layout');
    expect(chatCss).toContain('.aurvin-sidebar');
    expect(chatCss).toContain('.aurvin-main');
    expect(chatCss).toContain('.aurvin-composer');
    expect(chatCss).toContain('@media (max-width: 768px)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with missing file or variables.

- [ ] **Step 3: Write minimal implementation**

Update `frontend/src/index.css`:

```css
:root {
  --aurvin-bg: #ffffff;
  --aurvin-surface-elevated: #f9f9fb;
  --aurvin-hover: #f0f0f4;
  --aurvin-selected: #e4e4ec;
  --aurvin-border: #e2e2ea;
  --aurvin-text-primary: #1a1a24;
  --aurvin-text-secondary: #6b6b7b;
  --aurvin-primary: #2563eb;
  --aurvin-primary-hover: #1d4ed8;
  --aurvin-danger: #dc2626;
  --aurvin-warning: #d97706;
  --aurvin-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --aurvin-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-family: var(--aurvin-font);
  color: var(--aurvin-text-primary);
  background-color: var(--aurvin-bg);
}

@media (prefers-color-scheme: dark) {
  :root {
    --aurvin-bg: #111116;
    --aurvin-surface-elevated: #1a1a22;
    --aurvin-hover: #242430;
    --aurvin-selected: #2e2e3c;
    --aurvin-border: #2a2a36;
    --aurvin-text-primary: #f0f0f6;
    --aurvin-text-secondary: #9595a6;
    --aurvin-primary: #3b82f6;
    --aurvin-primary-hover: #60a5fa;
    --aurvin-danger: #ef4444;
    --aurvin-warning: #f59e0b;
  }
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid var(--aurvin-primary);
  outline-offset: 2px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Create `frontend/src/styles/chat.css`:

```css
.aurvin-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background-color: var(--aurvin-bg);
}

.aurvin-sidebar {
  width: 260px;
  flex-shrink: 0;
  background-color: var(--aurvin-surface-elevated);
  border-right: 1px solid var(--aurvin-border);
  display: flex;
  flex-direction: column;
  transition: transform 0.2s ease;
  z-index: 10;
}

.aurvin-sidebar-header {
  padding: 12px;
  border-bottom: 1px solid var(--aurvin-border);
}

.aurvin-new-chat-btn {
  width: 100%;
  padding: 8px 12px;
  background-color: var(--aurvin-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
}

.aurvin-session-list {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 8px;
}

.aurvin-session-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 2px;
  font-size: 14px;
}

.aurvin-session-item:hover {
  background-color: var(--aurvin-hover);
}

.aurvin-session-item[aria-current='page'] {
  background-color: var(--aurvin-selected);
  font-weight: 600;
}

.aurvin-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.aurvin-transcript {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.aurvin-message {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  padding: 12px 16px;
  border-radius: 8px;
  line-height: 1.5;
}

.aurvin-message-user {
  background-color: var(--aurvin-surface-elevated);
  align-self: flex-end;
}

.aurvin-message-assistant {
  background-color: transparent;
  align-self: flex-start;
}

.aurvin-composer {
  padding: 16px;
  background-color: var(--aurvin-bg);
  border-top: 1px solid var(--aurvin-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.aurvin-composer-box {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  position: relative;
  display: flex;
  gap: 8px;
}

.aurvin-textarea {
  flex: 1;
  min-height: 44px;
  max-height: 200px;
  padding: 10px 14px;
  border: 1px solid var(--aurvin-border);
  border-radius: 8px;
  background-color: var(--aurvin-surface-elevated);
  color: var(--aurvin-text-primary);
  resize: none;
  font-family: inherit;
  font-size: 15px;
}

.aurvin-send-btn, .aurvin-cancel-btn {
  padding: 0 16px;
  border-radius: 8px;
  border: none;
  font-weight: 500;
  cursor: pointer;
}

.aurvin-send-btn {
  background-color: var(--aurvin-primary);
  color: #fff;
}

.aurvin-cancel-btn {
  background-color: var(--aurvin-danger);
  color: #fff;
}

.aurvin-status-badge {
  display: inline-block;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  margin-top: 6px;
}

.aurvin-badge-truncated {
  background-color: var(--aurvin-warning);
  color: #fff;
}

.aurvin-badge-failed {
  background-color: var(--aurvin-danger);
  color: #fff;
}

@media (max-width: 768px) {
  .aurvin-sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    transform: translateX(-100%);
  }

  .aurvin-sidebar[data-open='true'] {
    transform: translateX(0);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/styles/chat.css frontend/src/styles/styles.test.ts
git commit -m "feat(p7): add design tokens, theme styles, and responsive layout classes"
```

---

### Task 7: Sidebar & Navigation Component

**Files:**
- Create: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/components/Sidebar.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/components/Sidebar.test.ts`.

```typescript
import { describe, expect, it } from 'vitest';
import { Sidebar } from './Sidebar.tsx';

describe('Sidebar component', () => {
  it('is exported as a React functional component', () => {
    expect(typeof Sidebar).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation** in `frontend/src/components/Sidebar.tsx`.

```typescript
import React from 'react';
import { useChat } from '../features/chat/state/chat-context.tsx';

export const Sidebar: React.FC = () => {
  const { state, actions, dispatch } = useChat();

  return (
    <aside
      className="aurvin-sidebar"
      data-open={state.sidebarOpen}
      role="complementary"
      aria-label="Chat history"
    >
      <div className="aurvin-sidebar-header">
        <button
          type="button"
          className="aurvin-new-chat-btn"
          onClick={actions.startNewChat}
          aria-label="Start a new chat"
        >
          + New Chat
        </button>
      </div>

      <nav aria-label="Sessions" style={{ flex: 1, overflowY: 'auto' }}>
        <ul className="aurvin-session-list">
          {state.sessions.map((session) => {
            const isSelected = session.sessionId === state.activeSessionId;
            return (
              <li
                key={session.sessionId}
                className="aurvin-session-item"
                aria-current={isSelected ? 'page' : undefined}
                onClick={() => actions.selectSession(session.sessionId, session.title)}
              >
                <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {session.title || 'Untitled Chat'}
                </div>
              </li>
            );
          })}
        </ul>

        {state.hasMoreSessions && (
          <div style={{ padding: '8px', textAlign: 'center' }}>
            <button
              type="button"
              style={{ fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--aurvin-primary)' }}
              onClick={actions.loadMoreSessions}
              disabled={state.sessionsLoading}
            >
              Load more chats…
            </button>
          </div>
        )}
      </nav>
    </aside>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/components/Sidebar.test.ts
git commit -m "feat(p7): create accessible sidebar with pagination and stable ordering"
```

---

### Task 8: Welcoming Empty State Component

**Files:**
- Create: `frontend/src/components/EmptyState.tsx`
- Create: `frontend/src/components/EmptyState.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/components/EmptyState.test.ts`.

```typescript
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState.tsx';

describe('EmptyState component', () => {
  it('is exported as a React functional component', () => {
    expect(typeof EmptyState).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation** in `frontend/src/components/EmptyState.tsx`.

```typescript
import React from 'react';
import { useChat } from '../features/chat/state/chat-context.tsx';

const SUGGESTIONS = [
  'What can you help me with?',
  'How does your persistent memory work?',
  'Explain LangGraph agent workflows',
];

export const EmptyState: React.FC = () => {
  const { actions, dispatch } = useChat();

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '28px', marginBottom: '8px' }}>Welcome to Aurvin</h1>
      <p style={{ color: 'var(--aurvin-text-secondary)', maxWidth: '460px', marginBottom: '24px' }}>
        A reliable persistent AI assistant powered by LangGraph. Ask any general question or explore what Aurvin can do.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '600px' }}>
        {SUGGESTIONS.map((text, idx) => (
          <button
            key={idx}
            type="button"
            style={{
              padding: '8px 14px',
              borderRadius: '16px',
              border: '1px solid var(--aurvin-border)',
              backgroundColor: 'var(--aurvin-surface-elevated)',
              color: 'var(--aurvin-text-primary)',
              cursor: 'pointer',
              fontSize: '14px',
            }}
            onClick={() => {
              dispatch({ type: 'SET_DRAFT', payload: text });
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EmptyState.tsx frontend/src/components/EmptyState.test.ts
git commit -m "feat(p7): implement welcoming empty state with suggestion chips"
```

---

### Task 9: Multiline Composer Component

**Files:**
- Create: `frontend/src/components/Composer.tsx`
- Create: `frontend/src/components/Composer.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/components/Composer.test.ts`.

```typescript
import { describe, expect, it } from 'vitest';
import { Composer } from './Composer.tsx';

describe('Composer component', () => {
  it('is exported as a React functional component', () => {
    expect(typeof Composer).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation** in `frontend/src/components/Composer.tsx`.

```typescript
import React, { useRef } from 'react';
import { useChat } from '../features/chat/state/chat-context.tsx';

const MAX_INPUT_CHARS = 32_000;

export const Composer: React.FC = () => {
  const { state, actions, dispatch } = useChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void actions.submitMessage();
    }
  };

  const isOverBudget = state.draftInput.length > MAX_INPUT_CHARS;
  const isSubmitDisabled = !state.draftInput.trim() || state.isSubmitting || state.isStreaming || isOverBudget;

  return (
    <footer className="aurvin-composer" role="region" aria-label="Message composer">
      <div className="aurvin-composer-box">
        <textarea
          ref={textareaRef}
          className="aurvin-textarea"
          value={state.draftInput}
          onChange={(e) => dispatch({ type: 'SET_DRAFT', payload: e.target.value })}
          onKeyDown={handleKeyDown}
          placeholder="Message Aurvin… (Press Enter to send, Shift+Enter for new line)"
          aria-label="Message input"
          rows={1}
          disabled={state.isStreaming}
        />

        {state.isStreaming ? (
          <button
            type="button"
            className="aurvin-cancel-btn"
            onClick={actions.cancelCurrentTurn}
            aria-label="Cancel response"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="aurvin-send-btn"
            onClick={() => void actions.submitMessage()}
            disabled={isSubmitDisabled}
            aria-label="Send message"
          >
            Send
          </button>
        )}
      </div>

      {state.draftInput.length > 25_000 && (
        <div style={{ textAlign: 'right', fontSize: '12px', color: isOverBudget ? 'var(--aurvin-danger)' : 'var(--aurvin-text-secondary)' }}>
          {state.draftInput.length} / {MAX_INPUT_CHARS}
        </div>
      )}
    </footer>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Composer.tsx frontend/src/components/Composer.test.ts
git commit -m "feat(p7): implement multiline composer with keyboard shortcuts and cancel action"
```

---

### Task 10: Transcript, Message Items & Controlled Scrolling

**Files:**
- Create: `frontend/src/components/MessageItem.tsx`
- Create: `frontend/src/components/ScrollController.tsx`
- Create: `frontend/src/components/Transcript.tsx`
- Create: `frontend/src/components/Transcript.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/components/Transcript.test.ts`.

```typescript
import { describe, expect, it } from 'vitest';
import { Transcript } from './Transcript.tsx';
import { MessageItem } from './MessageItem.tsx';

describe('Transcript and MessageItem components', () => {
  it('exports valid React components', () => {
    expect(typeof Transcript).toBe('function');
    expect(typeof MessageItem).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/MessageItem.tsx`:

```typescript
import React from 'react';
import type { VisibleMessage } from '../api/protocol.ts';
import { SafeMarkdown } from '../features/chat/markdown/safe-markdown.tsx';
import { useChat } from '../features/chat/state/chat-context.tsx';

export const MessageItem: React.FC<{ message: VisibleMessage }> = ({ message }) => {
  const { actions } = useChat();
  const isUser = message.role === 'user';

  return (
    <article
      className={`aurvin-message ${isUser ? 'aurvin-message-user' : 'aurvin-message-assistant'}`}
      data-role={message.role}
      data-status={message.completionStatus}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--aurvin-text-secondary)' }}>
        {isUser ? 'You' : 'Aurvin'}
      </div>

      <div className="aurvin-message-content">
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        ) : (
          <SafeMarkdown content={message.content} />
        )}
      </div>

      {message.completionStatus === 'truncated' && (
        <span className="aurvin-status-badge aurvin-badge-truncated">
          Response reached maximum length
        </span>
      )}

      {(message.completionStatus === 'failed' || message.completionStatus === 'interrupted') && (
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="aurvin-status-badge aurvin-badge-failed">
            {message.completionStatus === 'failed' ? 'Generation failed' : 'Generation interrupted'}
          </span>
          <button
            type="button"
            style={{ fontSize: '12px', padding: '2px 8px', cursor: 'pointer' }}
            onClick={() => void actions.retryTurn(message.turnId)}
            aria-label="Retry generation"
          >
            Retry
          </button>
        </div>
      )}
    </article>
  );
};
```

Create `frontend/src/components/ScrollController.tsx`:

```typescript
import React, { useEffect, useRef, useState } from 'react';

export const ScrollController: React.FC<{
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  dependencies: unknown[];
}> = ({ scrollContainerRef, dependencies }) => {
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const isNearBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceToBottom < 100;
    isNearBottomRef.current = nearBottom;
    setShowScrollBottom(!nearBottom);
  };

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !isNearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [dependencies, scrollContainerRef]);

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  if (!showScrollBottom) return null;

  return (
    <button
      type="button"
      onClick={scrollToBottom}
      style={{
        position: 'absolute',
        bottom: '80px',
        right: '24px',
        backgroundColor: 'var(--aurvin-surface-elevated)',
        border: '1px solid var(--aurvin-border)',
        borderRadius: '50%',
        width: '36px',
        height: '36px',
        cursor: 'pointer',
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
      }}
      aria-label="Scroll to bottom"
    >
      ↓
    </button>
  );
};
```

Create `frontend/src/components/Transcript.tsx`:

```typescript
import React, { useRef } from 'react';
import { useChat } from '../features/chat/state/chat-context.tsx';
import { MessageItem } from './MessageItem.tsx';
import { ScrollController } from './ScrollController.tsx';

export const Transcript: React.FC = () => {
  const { state, actions } = useChat();
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="aurvin-transcript"
      role="log"
      aria-label="Conversation transcript"
      aria-live="polite"
    >
      {state.olderAvailable && (
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <button
            type="button"
            onClick={actions.loadOlderMessages}
            disabled={state.loadingOlder}
            style={{ fontSize: '13px', cursor: 'pointer', padding: '4px 12px' }}
          >
            {state.loadingOlder ? 'Loading older messages…' : 'Load older messages'}
          </button>
        </div>
      )}

      {state.messages.map((message) => (
        <MessageItem key={message.messageId} message={message} />
      ))}

      {state.isStreaming && (
        <MessageItem
          message={{
            messageId: 'streaming_in_flight',
            turnId: state.activeTurnId ?? 'turn_streaming',
            eventId: 'evt_streaming',
            sequence: state.messages.length + 1,
            role: 'assistant',
            content: state.streamText,
            createdAt: new Date().toISOString(),
            completionStatus: 'streaming',
            truncated: false,
          }}
        />
      )}

      <ScrollController
        scrollContainerRef={containerRef}
        dependencies={[state.messages, state.streamText]}
      />
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageItem.tsx frontend/src/components/ScrollController.tsx frontend/src/components/Transcript.tsx frontend/src/components/Transcript.test.ts
git commit -m "feat(p7): implement transcript with controlled scrolling, badges, and retry action"
```

---

### Task 11: Chat Feature Assembly & Public Exports

**Files:**
- Create: `frontend/src/features/chat/ChatView.tsx`
- Create: `frontend/src/features/chat/index.ts`
- Create: `frontend/src/features/chat/ChatView.test.ts`

- [ ] **Step 1: Write the failing tests** in `frontend/src/features/chat/ChatView.test.ts`.

```typescript
import { describe, expect, it } from 'vitest';
import { ChatView } from './ChatView.tsx';

describe('ChatView component', () => {
  it('is exported as a React functional component', () => {
    expect(typeof ChatView).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` from `frontend`
Expected: FAIL with module not found.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/features/chat/ChatView.tsx`:

```typescript
import React from 'react';
import { Composer } from '../../components/Composer.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Sidebar } from '../../components/Sidebar.tsx';
import { Transcript } from '../../components/Transcript.tsx';
import { useChat } from './state/chat-context.tsx';

export const ChatView: React.FC = () => {
  const { state, dispatch } = useChat();
  const isEmpty = state.messages.length === 0 && !state.isStreaming;

  return (
    <div className="aurvin-layout">
      <Sidebar />

      <main className="aurvin-main" role="main">
        <header
          style={{
            height: '48px',
            borderBottom: '1px solid var(--aurvin-border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
              aria-label="Toggle sidebar"
              style={{ display: 'inline-flex', padding: '4px 8px', cursor: 'pointer' }}
            >
              ☰
            </button>
            <span style={{ fontWeight: 600, fontSize: '15px' }}>
              {state.activeSessionTitle || 'New Chat'}
            </span>
          </div>

          <div style={{ fontSize: '13px', color: 'var(--aurvin-text-secondary)' }}>
            {state.turnStatus !== 'idle' && state.turnStatus}
          </div>
        </header>

        {isEmpty ? <EmptyState /> : <Transcript />}

        <Composer />
      </main>
    </div>
  );
};
```

Create `frontend/src/features/chat/index.ts`:

```typescript
export { ChatView } from './ChatView.tsx';
export { ChatProvider, useChat } from './state/chat-context.tsx';
export type { ChatState, ChatAction } from './state/chat-types.ts';
export { ApiClient, createApiClient } from '../../api/client.ts';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/chat/ChatView.tsx frontend/src/features/chat/index.ts frontend/src/features/chat/ChatView.test.ts
git commit -m "feat(p7): assemble chat view container with responsive layout and public exports"
```

---

### Task 12: Feature Test Suite for P7 Acceptance Criteria

**Files:**
- Create: `frontend/src/features/chat/chat-acceptance.test.ts`

- [ ] **Step 1: Write the feature tests** in `frontend/src/features/chat/chat-acceptance.test.ts`.

```typescript
import { describe, expect, it } from 'vitest';
import { chatReducer, initialChatState } from './state/chat-reducer.ts';
import type { VisibleMessage } from '../../api/protocol.ts';

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
    expect(s4.messages[s4.messages.length - 1].content).toBe('Partial token...');
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
    expect(userMessages[0].content).toBe('My prompt');
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
    expect(s2.messages[0].truncated).toBe(true);
    expect(s2.messages[0].completionStatus).toBe('truncated');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/chat/chat-acceptance.test.ts
git commit -m "test(p7): add comprehensive feature test suite covering AC01, AC02, AC08, and AC11"
```

---

### Task 12b: Frontend Test Runner Expansion for TSX

**Files:**
- Modify: `frontend/vitest.config.ts`

- [ ] **Step 1: Inspect test inclusion pattern** in `frontend/vitest.config.ts`.

Currently, `frontend/vitest.config.ts` specifies:
```typescript
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```
Notice that tests named `*.test.ts` match, but any component tests named `*.test.tsx` would not be discovered unless `include` includes `src/**/*.test.{ts,tsx}`.

- [ ] **Step 2: Update `frontend/vitest.config.ts`** to include `src/**/*.test.{ts,tsx}`.

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Run tests to verify discovery**

Run: `npm test` from `frontend`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/vitest.config.ts
git commit -m "chore(p7): configure vitest to include ts and tsx test files"
```

---

### Task 13: Full Build, Lint, and Regression Check

**Files:**
- Verification only

- [ ] **Step 1: Run frontend tests**

Run: `npm test` from `frontend`
Expected: All test suites PASS.

- [ ] **Step 2: Run frontend linter**

Run: `npm run lint` from `frontend`
Expected: Zero lint errors.

- [ ] **Step 3: Run frontend production build**

Run: `npm run build` from `frontend`
Expected: TypeScript compile and Vite build PASS without errors.

---

## Exit Gate & Verification Checklist

- [ ] `frontend/src/api/client.ts` implements HTTP routes, query string pagination, and SSE reader.
- [ ] Safe Markdown parser strictly disarms unsafe schemes (`javascript:`, `data:`, `vbscript:`) and safely escapes raw HTML.
- [ ] New chat provides a clean empty state and does NOT persist an empty session before the first user message is accepted (AC01).
- [ ] Sidebar orders sessions stably by `lastActivityAt` DESC, tie-breaking with `sessionId` DESC.
- [ ] Streaming deltas update progressive response; `generating`, `finalizing`, `completed`, `truncated`, `failed`, `cancelled`, and `interrupted` states are visibly distinct (AC02, AC11).
- [ ] Double-submissions during active turns are prevented; retry creates a new attempt without duplicating the user's input (AC08).
- [ ] Multiline composer auto-sizes, handles Enter / Shift+Enter keyboard shortcuts, and preserves draft text on recoverable submission errors.
- [ ] Controlled scrolling preserves reading position when scrolled up and provides a jump-to-bottom control.
- [ ] Accessible semantic HTML and ARIA labels are present throughout.
- [ ] Public exports from `frontend/src/features/chat/index.ts` provide clean interfaces for P9 assembly and P10 integration tests.
- [ ] `npm test`, `npm run lint`, and `npm run build` pass in `frontend`.
- [ ] Review is recorded as **skipped** pursuant to the user's `--skip review` instruction.
