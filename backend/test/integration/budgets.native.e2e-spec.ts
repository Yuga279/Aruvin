/**
 * ============================================================================
 * FILE: budgets.native.e2e-spec.ts
 * LOCATION: backend/test/integration/budgets.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC15 finite context, rate, concurrency, and timeout budgets.
 *
 * ROLE IN PROJECT:
 *    P10 evidence that overflow, rate, concurrency, and first-output limits
 *    reject without deleting history or retrying forever.
 *
 * KEY COMPONENTS:
 *    - MAX_MESSAGES_IN_CONTEXT=3: First turn admitted, follow-up rejected.
 *    - Hanging fetcher: Concurrency and first-output timeout boundaries.
 * ============================================================================
 */

import { catalogueResponse, COLLECTIONS, FRAMES, openAssembled, streamText, submit } from './assembled-harness.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('AC15 context budget admits the first turn and rejects a follow-up', async () => {
  // The assembled context is two fixed system messages, the response-mode
  // instruction and the new input, so four messages for the first turn and six
  // for the follow-up. Five admits the first turn and rejects the follow-up.
  const h = await openAssembled({ env: { MAX_MESSAGES_IN_CONTEXT: '5' } });
  try {
    const accepted = await submit(h.agent, 'First budget turn', 'p10-budget-request-1');
    expect(await streamText(h.agent, accepted)).toContain('"type":"completed"');
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    const follow = await h.agent.post(`/api/sessions/${accepted.sessionId}/turns`)
      .send({ sessionId: accepted.sessionId, content: 'Follow-up overflow', idempotencyKey: 'p10-budget-request-2' });
    expect(follow.status).toBe(413);
    expect(follow.body.code).toBe('CONTEXT_BUDGET_EXCEEDED');
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(await h.db.db.collection(COLLECTIONS.messages).countDocuments({ sessionId: accepted.sessionId })).toBe(2);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC15 rate limit rejects a second generation without a second user message', async () => {
  const h = await openAssembled({ env: { MAX_REQUESTS_PER_MINUTE_PER_USER: '1' } });
  try {
    const first = await h.agent.post('/api/sessions')
      .send({ sessionId: null, content: 'Rate first', idempotencyKey: 'p10-budget-request-3' });
    expect(first.status).toBe(202);
    const second = await h.agent.post('/api/sessions')
      .send({ sessionId: null, content: 'Rate second', idempotencyKey: 'p10-budget-request-4' });
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('RATE_LIMITED');
    expect(second.headers['retry-after']).toBe('60');
    expect(await h.db.db.collection(COLLECTIONS.messages).countDocuments({ role: 'user' })).toBe(1);
    await h.agent.get('/api/operations/live').expect(200);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC15 concurrency limit rejects a second session while the first stream hangs', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = await openAssembled({
    env: { MAX_CONCURRENT_GENERATIONS_PER_PROCESS: '1' },
    fetcher: async (url) => {
      if (String(url).endsWith('/models')) return catalogueResponse();
      await gate;
      return new Response(FRAMES.normal, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  try {
    const accepted = await submit(h.agent, 'Hold concurrency', 'p10-budget-request-5');
    const pending = h.agent.get(`/api${accepted.streamPath}`);
    void pending.then(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const other = await h.agent.post('/api/sessions')
      .send({ sessionId: null, content: 'Second session', idempotencyKey: 'p10-budget-request-6' });
    expect([other.status, other.body.code]).toEqual([429, 'CONCURRENCY_LIMIT']);
  } finally { release(); await h.close(); }
}, 60000);

nativeIt('AC15 first-output timeout is terminal and bounded', async () => {
  let posts = 0;
  const h = await openAssembled({
    // The stored settings require the retry delay to stay inside the total run
    // timeout, so the fixture states both.
    env: { FIRST_OUTPUT_TIMEOUT_MS: '50', TOTAL_RUN_TIMEOUT_MS: '2000', IDLE_STREAM_TIMEOUT_MS: '200',
      RETRY_MAX_DELAY_MS: '1000' },
    fetcher: async (url) => {
      if (String(url).endsWith('/models')) return catalogueResponse();
      posts += 1;
      return new Response(new ReadableStream({ start() { /* never writes */ } }), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  try {
    const accepted = await submit(h.agent, 'Timeout me', 'p10-budget-request-7');
    await h.agent.get(`/api${accepted.streamPath}`);
    const status = await h.agent.get(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}`).expect(200);
    expect(['failed', 'interrupted']).toContain(status.body.status);
    expect(status.body.status).not.toBe('completed');
    expect(posts).toBeGreaterThanOrEqual(1);
    expect(posts).toBeLessThanOrEqual(h.config.budgets.retryMaxAttempts);
  } finally { await h.close(); }
}, 60000);
