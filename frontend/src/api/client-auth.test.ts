/**
 * ============================================================================
 * FILE: client-auth.test.ts
 * LOCATION: frontend/src/api/client-auth.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify ApiClient sends credentials: 'same-origin' and clears recovery storage.
 *
 * ROLE IN PROJECT:
 *    Ensures chat and streaming requests attach HttpOnly session cookies
 *    and allow explicit private state purge on account logout.
 *
 * KEY COMPONENTS:
 *    - Credentials verification on GET/POST/stream
 *    - clearSubmissionRecovery verification
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { ApiClient, clearAllSubmissionRecovery } from './client.ts';

describe('ApiClient auth & cookie credentials', () => {
  it('passes credentials: "same-origin" on standard JSON requests', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ sessions: [], hasMore: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new ApiClient({ fetch: fetcher });
    await client.listSessions();

    expect(fetcher).toHaveBeenCalledOnce();
    const init = fetcher.mock.calls[0][1];
    expect(init?.credentials).toBe('same-origin');
  });

  it('passes credentials: "same-origin" on SSE streamTurn requests', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const client = new ApiClient({ fetch: fetcher });
    await client.connectTurnStream('/sessions/sess-1/turns/turn-1/stream', {});

    expect(fetcher).toHaveBeenCalledOnce();
    const init = fetcher.mock.calls[0][1];
    expect(init?.credentials).toBe('same-origin');
  });

  it('clears submission recovery key from storage on request', () => {
    const removeItem = vi.fn();
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem,
    };
    clearAllSubmissionRecovery(storage);
    expect(removeItem).toHaveBeenCalledWith(expect.stringContaining('aurvin:submission:v1:'));
  });
});
