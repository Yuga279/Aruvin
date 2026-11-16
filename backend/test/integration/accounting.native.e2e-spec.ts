/**
 * ============================================================================
 * FILE: accounting.native.e2e-spec.ts
 * LOCATION: backend/test/integration/accounting.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC14 usage frames, generation lookup, and duplicate-frame dedup.
 *
 * ROLE IN PROJECT:
 *    P10 evidence that accounting identities are unique, missing cost stays
 *    null, and reconcile uses GET /generation only.
 *
 * KEY COMPONENTS:
 *    - FRAMES.normal / duplicateUsage / noUsage: Stream accounting outcomes.
 *    - AccountingService.reconcile: Lookup without chat-completion POSTs.
 * ============================================================================
 */

import { AccountingService } from '../../src/model/index.js';
import { GENERATION } from '../fixtures/openrouter/frames.js';
import { catalogueResponse, COLLECTIONS, FRAMES, openAssembled, parseEvents, streamText, submit } from './assembled-harness.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('AC14 records known usage once from a normal stream', async () => {
  const h = await openAssembled({ frames: FRAMES.normal });
  try {
    const accepted = await submit(h.agent, 'Account me', 'p10-acct-request-1');
    await streamText(h.agent, accepted);
    const rows = await h.db.db.collection(COLLECTIONS.metadata).find({ kind: 'accounting' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      generationId: 'gen_fixture', promptTokens: 12, completionTokens: 3, cost: 0.00002, accountingStatus: 'known',
    });
  } finally { await h.close(); }
}, 60000);

nativeIt('AC14 does not sum duplicate usage frames', async () => {
  const h = await openAssembled({ frames: FRAMES.duplicateUsage });
  try {
    const accepted = await submit(h.agent, 'Duplicate usage', 'p10-acct-request-2');
    await streamText(h.agent, accepted);
    const rows = await h.db.db.collection(COLLECTIONS.metadata).find({ kind: 'accounting' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cost).toBe(0.00002);
    expect(rows[0]?.cost).not.toBe(0.00004);
  } finally { await h.close(); }
}, 60000);

nativeIt('AC14 keeps missing usage null and reconciles by generation GET', async () => {
  const h = await openAssembled({ frames: FRAMES.noUsage });
  try {
    const accepted = await submit(h.agent, 'No usage yet', 'p10-acct-request-3');
    await streamText(h.agent, accepted);
    const rows = await h.db.db.collection(COLLECTIONS.metadata).find({ kind: 'accounting' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cost ?? null).toBeNull();
    expect(['pending', 'unknown']).toContain(rows[0]?.accountingStatus);
    expect(rows[0]?.cost).not.toBe(0);
    const saved = rows[0] as Record<string, unknown>;
    const { _id: _ignored, _revision: _revision, ...record } = saved;
    const lookups: { url: string; method: string }[] = [];
    const accounting = new AccountingService(h.config, h.bundle.metadata, async (url, init) => {
      lookups.push({ url: String(url), method: init?.method ?? 'GET' });
      if (!String(url).includes('/generation')) throw new Error('lookup posted completions');
      return Response.json(GENERATION);
    });
    await accounting.reconcile(record as never, new AbortController().signal);
    await accounting.reconcile(record as never, new AbortController().signal);
    expect(lookups.every((call) => call.method === 'GET')).toBe(true);
    expect(lookups.filter((call) => call.url.includes('/generation')).length).toBeLessThanOrEqual(2);
    expect(lookups.some((call) => call.url.includes('/chat/completions'))).toBe(false);
    const after = await h.db.db.collection(COLLECTIONS.metadata).find({ kind: 'accounting' }).toArray();
    expect(after).toHaveLength(1);
    expect(after[0]?.cost).toBe(0.00002);
    expect(String(after[0]?._id)).toBe(String(rows[0]?._id));
  } finally { await h.close(); }
}, 60000);

nativeIt('AC14 keeps a failed attempt accounting row across retry', async () => {
  let posts = 0;
  const h = await openAssembled({ fetcher: async (url) => {
    if (String(url).endsWith('/models')) return catalogueResponse();
    posts += 1;
    const frames = posts === 1 ? FRAMES.errorBefore.replace('"code":402', '"code":502') : FRAMES.normal;
    return new Response(frames, { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const accepted = await submit(h.agent, 'Retry accounting', 'p10-acct-request-4');
    parseEvents(await streamText(h.agent, accepted));
    const firstRows = await h.db.db.collection(COLLECTIONS.metadata).find({ kind: 'accounting' }).toArray();
    const firstId = firstRows[0]?.generationId ?? null;
    const retried = await h.agent.post(`/api/sessions/${accepted.sessionId}/turns/${accepted.turnId}/retry`)
      .send({ idempotencyKey: 'p10-acct-request-5' }).expect(202);
    await streamText(h.agent, retried.body);
    const rows = await h.db.db.collection(COLLECTIONS.metadata).find({ kind: 'accounting' }).toArray();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((row) => row.generationId === firstId)).toBe(true);
  } finally { await h.close(); }
}, 60000);
