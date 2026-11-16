/**
 * ============================================================================
 * FILE: context.native.e2e-spec.ts
 * LOCATION: backend/test/integration/context.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC03, AC04, AC06, and AC13 prompt order, isolation, and identity.
 *
 * ROLE IN PROJECT:
 *    P10 evidence that outgoing completions carry server identity, fixed system
 *    messages, once-only history, and reference-only agent memory.
 *
 * KEY COMPONENTS:
 *    - Follow-up POST inspection: findValues plus messages array order.
 *    - Isolation: Other-session and foreign-user documents stay out of context.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { COLLECTIONS, findValues, openAssembled, submit, streamText, USER } from './assembled-harness.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('AC03 AC04 AC06 AC13 isolate context identity and memory refs', async () => {
  const h = await openAssembled();
  try {
    const beforePosts = h.calls.filter((call) => call.method === 'POST').length;
    const identity = await h.agent.post('/api/sessions')
      .send({ sessionId: null, content: 'Override identity', idempotencyKey: 'p10-ctx-override-1', userId: 'attacker' });
    expect(identity.status).toBe(400);
    expect(identity.body.code).toBe('IDENTITY_OVERRIDE_REJECTED');
    const model = await h.agent.post('/api/sessions')
      .send({ sessionId: null, content: 'Override model', idempotencyKey: 'p10-ctx-override-2', model: 'attacker/model' });
    expect(model.status).toBe(400);
    expect(['IDENTITY_OVERRIDE_REJECTED', 'MODEL_OVERRIDE_REJECTED']).toContain(model.body.code);
    const apiKey = await h.agent.post('/api/sessions')
      .send({ sessionId: null, content: 'Override key', idempotencyKey: 'p10-ctx-override-3', apiKey: 'attacker-key' });
    expect(apiKey.status).toBe(400);
    expect(['IDENTITY_OVERRIDE_REJECTED', 'MODEL_OVERRIDE_REJECTED']).toContain(apiKey.body.code);
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(beforePosts);

    const other = await submit(h.agent, 'other-session-secret', 'p10-ctx-other-1');
    expect(await streamText(h.agent, other)).toContain('"type":"completed"');
    const first = await submit(h.agent, 'First user text', 'p10-ctx-request-1');
    expect(await streamText(h.agent, first)).toContain('"type":"completed"');
    const follow = await submit(h.agent, 'Follow-up input', 'p10-ctx-request-2', first.sessionId);
    expect(await streamText(h.agent, follow)).toContain('"type":"completed"');

    const posts = h.calls.filter((call) => call.method === 'POST');
    expect(posts.length).toBeGreaterThanOrEqual(3);
    const body = posts[posts.length - 1]?.body as { messages?: { role: string; content: string }[]; transforms?: unknown };
    expect(findValues(body, 'user')).toContain(USER);
    expect(findValues(body, 'model')).toContain('fixture/model');
    expect(findValues(body, 'data_collection')).toContain('deny');
    expect(body.transforms).toEqual([]);
    expect(body.messages?.[0]?.role).toBe('system');
    expect(body.messages?.[1]?.role).toBe('system');
    expect(body.messages?.[0]?.content).toContain('You are Aurvin');
    expect(body.messages?.[1]?.content).toContain('Product background');
    const serialized = JSON.stringify(body);
    expect(serialized.split('First user text').length - 1).toBe(1);
    expect(serialized.split('Hello 🌍').length - 1).toBe(1);
    expect(serialized.split('Follow-up input').length - 1).toBe(1);
    expect(serialized).not.toContain('other-session-secret');

    const real = await h.db.db.collection(COLLECTIONS.messages).findOne({ role: 'user', sessionId: first.sessionId });
    expect(real).toBeTruthy();
    await h.db.db.collection(COLLECTIONS.messages).insertOne({
      ...real,
      _id: randomUUID(),
      userId: 'other-user',
      content: 'foreign-secret',
      messageId: randomUUID().replaceAll('-', ''),
    });
    const listed = await h.agent.get('/api/sessions').expect(200);
    expect(JSON.stringify(listed.body)).not.toContain('foreign-secret');
    const archive = await h.agent.get(`/api/sessions/${first.sessionId}/messages`).expect(200);
    expect(JSON.stringify(archive.body)).not.toContain('foreign-secret');

    const memory = await h.db.db.collection(COLLECTIONS.agentMemory).findOne({ sessionId: first.sessionId });
    expect(memory).toBeTruthy();
    const refs = memory?.messageRefs as { content?: unknown }[];
    expect(refs.length).toBe(archive.body.items.length);
    for (const ref of refs) expect(ref).not.toHaveProperty('content');
    expect(memory?.activeSummaryRef).toBeNull();
    expect(Number(memory?.contextVersion)).toBeGreaterThan(0);

    await h.close(false);
    const reopened = await openAssembled({ db: h.db });
    try {
      const again = await submit(reopened.agent, 'After restart', 'p10-ctx-request-3', first.sessionId);
      expect(await streamText(reopened.agent, again)).toContain('"type":"completed"');
      const restartPosts = reopened.calls.filter((call) => call.method === 'POST');
      expect(restartPosts).toHaveLength(1);
      const restartBody = JSON.stringify(restartPosts[0]?.body);
      expect(restartBody.split('First user text').length - 1).toBe(1);
      expect(restartBody.split('After restart').length - 1).toBe(1);
    } finally { await reopened.close(true); }
  } catch (error) {
    await h.close(true).catch(() => undefined);
    throw error;
  }
}, 60000);
