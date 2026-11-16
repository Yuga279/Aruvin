/**
 * ============================================================================
 * FILE: security.native.e2e-spec.ts
 * LOCATION: backend/test/integration/security.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC17 validation, redaction, and readiness boundaries.
 *
 * ROLE IN PROJECT:
 *    P10 evidence that invalid bodies never reach the model, logs/metrics stay
 *    secret-free, and privacy-unsafe config is not accept-ready.
 *
 * KEY COMPONENTS:
 *    - Malformed/unknown-field POSTs: 400 without completion calls.
 *    - METRICS snapshot: Fixed names only; no prompt, session, or generation id.
 * ============================================================================
 */

import { METRICS } from '../../src/operations/telemetry.js';
import { assertNoSecrets, catalogueResponse, FRAMES, openAssembled, streamText, submit } from './assembled-harness.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('AC17 rejects malformed and unknown fields without a model POST', async () => {
  const h = await openAssembled();
  try {
    await h.agent.post('/api/sessions').set('Content-Type', 'application/json').send('{malformed').expect(400);
    const unknown = await h.agent.post('/api/sessions')
      .send({ sessionId: null, content: 'unknown field', idempotencyKey: 'p10-sec-request-1', extra: true });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('UNKNOWN_FIELD');
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC17 redacts secrets from ready, logs, and metrics', async () => {
  const captured: { url: string; method: string; body: unknown; authorization?: string }[] = [];
  const h = await openAssembled({ fetcher: async (url, init) => {
    const headers = new Headers(init?.headers);
    let authorization = headers.get('authorization') ?? headers.get('Authorization') ?? undefined;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null;
    captured.push({ url: String(url), method: init?.method ?? 'GET', body, authorization });
    if (String(url).endsWith('/models')) return catalogueResponse();
    if (!String(url).endsWith('/chat/completions')) throw new Error('Unexpected fixture request');
    return new Response(FRAMES.normal, { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const accepted = await submit(h.agent, 'synthetic-p10-secret-prompt', 'p10-sec-request-2');
    await streamText(h.agent, accepted);
    const completion = captured.find((call) => call.method === 'POST');
    expect(typeof completion?.authorization).toBe('string');
    expect(completion?.authorization?.startsWith('Bearer ')).toBe(true);
    for (const call of captured) delete call.authorization;
    const ready = await h.agent.get('/api/operations/ready').expect(200);
    const metrics = await h.agent.get('/api/operations/metrics').expect(200);
    const observationKeys = Object.keys(metrics.body.observations ?? {});
    expect(observationKeys.sort()).toEqual([...METRICS].sort());
    assertNoSecrets({ ready: ready.body, logs: h.logs, metrics: metrics.body },
      ['synthetic-p10-secret-prompt', 'private provider detail', 'mongodb://', accepted.sessionId, 'gen_fixture']);
    assertNoSecrets(captured, ['private provider detail', 'mongodb://']);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC17 catalogue failure keeps live and blocks generation', async () => {
  const h = await openAssembled({ fetcher: async (url) => {
    if (String(url).endsWith('/models')) throw new Error('catalogue unavailable');
    throw new Error('Unexpected fixture request');
  } });
  try {
    await h.agent.get('/api/operations/live').expect(200);
    const ready = await h.agent.get('/api/operations/ready');
    expect(ready.status).toBe(503);
    await h.agent.post('/api/sessions')
      .send({ sessionId: null, content: 'blocked', idempotencyKey: 'p10-sec-request-3' }).expect(503);
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC17 privacy-unsafe config is not accept-ready', async () => {
  for (const env of [
    { OPENROUTER_DATA_COLLECTION: 'allow' },
    { OPENROUTER_DISABLE_TRANSFORMS: 'false' },
  ]) {
    const h = await openAssembled({ env });
    try {
      const ready = await h.agent.get('/api/operations/ready');
      expect(ready.status).toBe(503);
      expect(ready.body.acceptReady).toBe(false);
    } finally { await h.close(); }
  }
}, 60000);
