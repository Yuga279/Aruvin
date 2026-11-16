/**
 * ============================================================================
 * FILE: duplicates.native.e2e-spec.ts
 * LOCATION: backend/test/integration/duplicates.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC08 idempotency/retry and AC09 two-client exclusion.
 *
 * ROLE IN PROJECT:
 *    P10 evidence that duplicate keys reuse one turn, mismatches 409, retry
 *    adds an attempt without a second user message, and a second tab is refused.
 *
 * KEY COMPONENTS:
 *    - Duplicate submit: Same 202 body, one user document, one completion POST.
 *    - Topology: Second AppService.create rejects UNSUPPORTED_TOPOLOGY.
 * ============================================================================
 */

import { AppService } from '../../src/app.service.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { createPersistenceBundle } from '../../src/persistence/index.js';
import { catalogueResponse, COLLECTIONS, FRAMES, openAssembled, parseEvents, streamText, submit } from './assembled-harness.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('AC08 repeats one logical input and rejects a changed payload', async () => {
  const h = await openAssembled();
  try {
    const first = h.agent.post('/api/sessions').send({ sessionId: null, content: 'Same input', idempotencyKey: 'p10-same-request' });
    const second = h.agent.post('/api/sessions').send({ sessionId: null, content: 'Same input', idempotencyKey: 'p10-same-request' });
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.body).toEqual(b.body);
    const mismatch = await h.agent.post('/api/sessions').send({ sessionId: null, content: 'Changed input', idempotencyKey: 'p10-same-request' });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
    expect(await h.db.db.collection(COLLECTIONS.messages).countDocuments({ role: 'user' })).toBe(1);
    await streamText(h.agent, a.body);
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC08 retry adds an attempt without a second user message', async () => {
  let posts = 0;
  const calls: { url: string; method: string }[] = [];
  const h = await openAssembled({ fetcher: async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    if (String(url).endsWith('/models')) return catalogueResponse();
    posts += 1;
    // 402 errorBefore is PROVIDER_CREDITS (blocked). Explicit retry evidence uses a
    // retryable pre-content provider error; P8 still fail-closes credit/auth blocks.
    const frames = posts === 1 ? FRAMES.errorBefore.replace('"code":402', '"code":502') : FRAMES.normal;
    return new Response(frames, { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const accepted = await submit(h.agent, 'Retry me', 'p10-retry-request-1');
    const failed = parseEvents(await streamText(h.agent, accepted));
    expect(failed.some((event) => event.event.type === 'completed')).toBe(false);
    const status = await h.agent.get(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}`).expect(200);
    expect(['failed', 'interrupted']).toContain(status.body.status);
    const retried = await h.agent.post(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}/retry`)
      .send({ idempotencyKey: 'p10-retry-request-2' }).expect(202);
    expect(retried.body.turnId).toBe(accepted.turnId);
    expect(retried.body.attemptId).not.toBe(accepted.attemptId);
    const completed = parseEvents(await streamText(h.agent, retried.body));
    expect(completed.some((event) => event.event.type === 'completed')).toBe(true);
    const archive = await h.agent.get(`/api/sessions/${accepted.sessionId}/messages`).expect(200);
    expect(archive.body.items.filter((item: { role: string }) => item.role === 'user')).toHaveLength(1);
    expect(archive.body.items.filter((item: { role: string; completionStatus: string }) => item.role === 'assistant' && item.completionStatus === 'completed')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC09 two clients cannot run two active turns in one session', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const seen: { method: string }[] = [];
  const h = await openAssembled({ fetcher: async (url, init) => {
    seen.push({ method: init?.method ?? 'GET' });
    if (String(url).endsWith('/models')) return catalogueResponse();
    await gate;
    return new Response(FRAMES.normal, { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const accepted = await submit(h.agent, 'Hold this turn', 'p10-tab-request-1');
    const pending = h.agent.get(`/api${accepted.streamPath}`);
    const other = await h.agent.post(`/api/sessions/${accepted.sessionId}/turns`)
      .send({ sessionId: accepted.sessionId, content: 'Second tab', idempotencyKey: 'p10-tab-request-2' });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('CONFLICT_ACTIVE_TURN');
    release();
    expect((await pending).status).toBe(200);
    expect(await h.db.db.collection(COLLECTIONS.messages).countDocuments({ role: 'user' })).toBe(1);
    expect(seen.filter((call) => call.method === 'POST')).toHaveLength(1);
    await expect(AppService.create(loadBootstrapConfig({ PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'fixture-injected-only',
      MONGODB_DB_NAME: h.db.name, AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }), {
      writeLog: () => undefined,
      open: (config) => createPersistenceBundle(h.db.client, h.db.name, config.budgets),
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    expect(JSON.stringify(other.body)).not.toContain('executor');
  } finally { release(); await h.close(); }
}, 60000);
