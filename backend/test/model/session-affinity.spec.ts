/**
 * ============================================================================
 * FILE: session-affinity.spec.ts
 * LOCATION: backend/test/model/session-affinity.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify conversation-scoped OpenRouter routing using serialized requests.
 *
 * ROLE IN PROJECT:
 *    Exercises trusted accounting bindings without paid calls, preserving
 *    attribution, cache controls, and isolation from global tracing settings.
 *
 * KEY COMPONENTS:
 *    - dispatch: Capture wire bodies through deterministic provider fixtures.
 *    - Affinity regressions: Turns, retries, users, sessions, and privacy.
 * ============================================================================
 */

import type { AccountingRecord } from '../../src/contracts/metadata.js';
import { AccountingService } from '../../src/model/accounting.js';
import { OpenRouterAttemptAdapter } from '../../src/model/openrouter-adapter.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
import { collect, config, limits, request, response, seed, sink } from './helpers.js';

afterEach(() => vi.unstubAllEnvs());

async function dispatch(binding: Partial<AccountingRecord> = {}, rejectFirst = false) {
  const record = { ...seed(), ...binding };
  const c = config();
  c.identity.userId = record.userId;
  c.openRouter.modelId = 'anthropic/fixture';
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(FRAMES.normal));
  if (rejectFirst) fetcher.mockResolvedValueOnce(new Response('{"error":{"code":429}}', { status: 429 }));
  const adapter = new OpenRouterAttemptAdapter(c, { ...limits, modelId: c.openRouter.modelId },
    { ...record, requestedModel: c.openRouter.modelId }, new AccountingService(c, sink(), fetcher),
    async () => {}, fetcher, () => 0);
  // Extra untrusted request fields must not override the durable binding.
  const input = { ...request(), user: record.userId, modelId: c.openRouter.modelId,
    sessionId: 'client-session', session_id: 'client-routing', trace: { name: 'client-trace' } };
  await collect(adapter.stream(input));
  return fetcher.mock.calls.map(([, init]) => {
    if (typeof init?.body !== 'string') throw new Error('Expected a serialized request body.');
    return JSON.parse(init.body) as Record<string, unknown>;
  });
}

it('keeps explicit affinity across turns, attempt retries, and HTTP retries', async () => {
  const [first] = await dispatch();
  const [nextTurn] = await dispatch({ turnId: 'turn_next', attemptId: 'att_next' });
  const retry = await dispatch({ attemptId: 'att_retry' }, true);
  expect(first.session_id).toEqual(expect.any(String));
  expect(String(first.session_id).length).toBeLessThanOrEqual(256);
  expect(nextTurn.session_id).toBe(first.session_id);
  expect(retry).toHaveLength(2);
  for (const body of retry) expect(body.session_id).toBe(first.session_id);
});

it('isolates both users and sessions without ambiguous identifier concatenation', async () => {
  const bindings = [
    { userId: 'user_a', sessionId: 'session_a' },
    { userId: 'user_a', sessionId: 'session_b' },
    { userId: 'user_b', sessionId: 'session_a' },
    { userId: 'user_a_b', sessionId: 'session_a' },
    { userId: 'user_a', sessionId: 'b_session_a' },
  ];
  const keys = [];
  for (const binding of bindings) {
    const [body] = await dispatch(binding);
    expect(body.session_id).toEqual(expect.any(String));
    expect(String(body.session_id)).not.toContain(binding.userId);
    expect(String(body.session_id)).not.toContain(binding.sessionId);
    keys.push(body.session_id);
  }
  expect(new Set(keys).size).toBe(bindings.length);
});

it('ignores global/client routing and tracing while preserving cache controls and privacy', async () => {
  const [baseline] = await dispatch();
  vi.stubEnv('OPENROUTER_SESSION_ID', 'global-session');
  vi.stubEnv('OPENROUTER_TRACE', 'global-trace');
  const [body] = await dispatch();
  expect(body.session_id).toEqual(expect.any(String));
  expect(body.session_id).toBe(baseline.session_id);
  expect(body.session_id).not.toBe('global-session');
  expect(body.session_id).not.toBe('client-routing');
  expect(body).toMatchObject({ user: 'aurvin-dev-user', cache_control: { type: 'ephemeral' },
    transforms: [], provider: { data_collection: 'deny', require_parameters: true } });
  expect(body.plugins).toContainEqual({ id: 'context-compression', enabled: false });
  for (const field of ['trace', 'sessionId', 'apiKey', 'tools', 'tool_choice']) expect(body[field]).toBeUndefined();
});
