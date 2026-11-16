/**
 * ============================================================================
 * FILE: ordering.native.e2e-spec.ts
 * LOCATION: backend/test/integration/ordering.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC10 acceptance-before-inference and completion-after-finalization.
 *
 * ROLE IN PROJECT:
 *    P10 evidence that the user archive exists before the model POST and that
 *    completed status requires a durable assistant archive row.
 *
 * KEY COMPONENTS:
 *    - Gated fetcher: Holds the completion POST until acceptance is inspected.
 * ============================================================================
 */

import { catalogueResponse, COLLECTIONS, openAssembled, submit, USER } from './assembled-harness.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('AC10 persists acceptance before the model POST and completes only after archive writes', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls: { method: string }[] = [];
  const h = await openAssembled({ fetcher: async (url, init) => {
    calls.push({ method: init?.method ?? 'GET' });
    if (String(url).endsWith('/models')) return catalogueResponse();
    if (init?.method === 'POST') await gate;
    return new Response(FRAMES.normal, { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const accepted = await submit(h.agent, 'Accept first', 'p10-order-request-1');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    const user = await h.db.db.collection(COLLECTIONS.messages).findOne({ role: 'user', userId: USER });
    expect(user?.content).toBe('Accept first');
    const early = await h.agent.get(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}`).expect(200);
    expect(['accepted', 'generating', 'finalizing']).toContain(early.body.status);
    expect(early.body.status).not.toBe('completed');
    release();
    const streamed = await h.agent.get(`/api${accepted.streamPath}`).expect(200);
    expect(streamed.text).toContain('"type":"completed"');
    const assistant = await h.db.db.collection(COLLECTIONS.messages).findOne({ role: 'assistant' });
    expect(assistant?.completionStatus).toBe('completed');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  } finally { release(); await h.close(); }
}, 60000);
