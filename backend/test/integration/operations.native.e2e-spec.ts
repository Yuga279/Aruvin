/**
 * ============================================================================
 * FILE: operations.native.e2e-spec.ts
 * LOCATION: backend/test/integration/operations.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Measure local AC18 readiness, fixture-chat latency, shutdown, and TTL guards.
 *
 * ROLE IN PROJECT:
 *    P10 local operations evidence only. External process-kill, proxy, restore,
 *    and previous-release drills stay blocked without operator flags.
 *
 * KEY COMPONENTS:
 *    - OPS-01: 20 concurrent ready calls and live POST-count invariance.
 *    - OPS-04: 20 fixture chats with first-byte and terminal percentiles.
 * ============================================================================
 */

import { request as httpRequest } from 'node:http';
import { COLLECTIONS, listen, openAssembled, percentile, submit } from './assembled-harness.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('OPS-01 concurrent ready stays accept-ready without extra model POSTs', async () => {
  const h = await openAssembled();
  try {
    await h.agent.get('/api/operations/ready').expect(200);
    const before = h.calls.filter((call) => call.method === 'POST').length;
    const samples: number[] = [];
    const results = await Promise.all(Array.from({ length: 20 }, async () => {
      const started = Date.now();
      const ready = await h.agent.get('/api/operations/ready');
      samples.push(Date.now() - started);
      return ready;
    }));
    expect(results.every((item) => item.status === 200)).toBe(true);
    await h.agent.get('/api/operations/live').expect(200);
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(before);
    expect(percentile(samples, 95)).toBeLessThanOrEqual(1100);
  } finally { await h.close(); }
}, 60000);

nativeIt('OPS-02 staging 20/min and 8-stream target is not claimed without authorization', () => {
  expect(process.env.AURVIN_P10_LOAD).not.toBe('authorized');
});

nativeIt('OPS-04 twenty fixture chats meet local first-output and terminal targets', async () => {
  const h = await openAssembled({ env: { MAX_REQUESTS_PER_MINUTE_PER_USER: '100' } });
  try {
    const server = await listen(h.app);
    const firstByte: number[] = [];
    const total: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const accepted = await submit(h.agent, `Synthetic timing ${index}`, `p10-ops-request-${String(index).padStart(2, '0')}`);
      const started = Date.now();
      await new Promise<void>((resolve, reject) => {
        const req = httpRequest({ hostname: '127.0.0.1', port: server.port, path: `/api${accepted.streamPath}`, method: 'GET' }, (res) => {
          res.once('data', () => { if (firstByte.length === index) firstByte.push(Date.now() - started); });
          res.once('end', () => { total.push(Date.now() - started); resolve(); });
          res.once('error', reject);
        });
        req.once('error', reject);
        req.end();
      });
    }
    expect(firstByte).toHaveLength(20);
    expect(total).toHaveLength(20);
    expect(percentile(firstByte, 95)).toBeLessThanOrEqual(2000);
    expect(percentile(total, 95)).toBeLessThanOrEqual(5000);
    for (const line of h.logs) {
      expect(line).not.toMatch(/Synthetic timing/u);
    }
    expect(process.env.AURVIN_P10_LOAD).not.toBe('authorized');
  } finally { await h.close(); }
}, 120000);

nativeIt('OPS-05 idle in-process shutdown is safe', async () => {
  const h = await openAssembled();
  try {
    const started = Date.now();
    expect(await h.service.operations.shutdown()).toEqual({ safe: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
  } finally { await h.close(); }
}, 60000);

nativeIt('OPS-08 ordinary chat does not create independent TTL indexes', async () => {
  const h = await openAssembled();
  try {
    const accepted = await submit(h.agent, 'Retention guard', 'p10-ops-request-ttl');
    await h.agent.get(`/api${accepted.streamPath}`).expect(200);
    for (const name of Object.values(COLLECTIONS)) {
      const indexes = await h.db.db.collection(name).indexes();
      for (const index of indexes) expect(index).not.toHaveProperty('expireAfterSeconds');
    }
  } finally { await h.close(); }
}, 60000);
