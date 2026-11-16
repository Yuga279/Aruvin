/**
 * ============================================================================
 * FILE: sessions.native.e2e-spec.ts
 * LOCATION: backend/test/integration/sessions.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC01 session navigation, titles, pagination, and reopen.
 *
 * ROLE IN PROJECT:
 *    P10 evidence that empty navigation creates no session and that a titled
 *    transcript survives a second assembled boot on the same isolated database.
 *
 * KEY COMPONENTS:
 *    - Empty list: No session document before the first accepted turn.
 *    - Reopen: Second app reads durable messages without a second model POST.
 * ============================================================================
 */

import { COLLECTIONS, openAssembled, submit, streamText } from './assembled-harness.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('AC01 does not persist an empty session and reopens a titled transcript', async () => {
  const h = await openAssembled();
  try {
    await h.agent.get('/api/sessions').expect(200).expect({ items: [], nextCursor: null });
    expect(await h.db.db.collection(COLLECTIONS.sessions).countDocuments()).toBe(0);
    const accepted = await submit(h.agent, 'Synthetic P10 navigation', 'p10-nav-request-1');
    expect(await streamText(h.agent, accepted)).toContain('"type":"completed"');
    const listed = await h.agent.get('/api/sessions').expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].title).toBe('Synthetic P10 navigation');
    expect(listed.body.items[0].sessionId).toBe(accepted.sessionId);
    const page = await h.agent.get('/api/sessions').query({ limit: 1 }).expect(200);
    expect(page.body.items).toHaveLength(1);
    const messages = await h.agent.get(`/api/sessions/${accepted.sessionId}/messages`).query({ limit: 1 }).expect(200);
    expect(messages.body.items.map((item: { content: string }) => item.content)).toEqual(['Hello 🌍']);
    expect(messages.body.olderAvailable).toBe(true);
    const older = await h.agent.get(`/api/sessions/${accepted.sessionId}/messages`).query({ cursor: messages.body.nextCursor, limit: 1 }).expect(200);
    expect(older.body.items.map((item: { content: string }) => item.content)).toEqual(['Synthetic P10 navigation']);
    await h.close(false);
    const reopened = await openAssembled({ db: h.db });
    try {
      const again = await reopened.agent.get(`/api/sessions/${accepted.sessionId}/messages`).expect(200);
      expect(again.body.items.map((item: { content: string }) => item.content)).toEqual(['Synthetic P10 navigation', 'Hello 🌍']);
      expect(reopened.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    } finally { await reopened.close(true); }
  } catch (error) { await h.close(true); throw error; }
}, 60000);
