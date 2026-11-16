/**
 * ============================================================================
 * FILE: isolation.native.e2e-spec.ts
 * LOCATION: backend/test/runtime/isolation.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove two new sessions isolate acceptance, context, manifest, identity.
 *
 * ROLE IN PROJECT:
 *    P5 native regression evidence for the P10 second-session defect: each new
 *    session completes with exactly-once context and reference-only memory,
 *    and a repeated provider generation fails closed without contamination.
 *
 * KEY COMPONENTS:
 *    - Two-session isolation: Scoped IDs, once-only bodies, per-session refs.
 *    - Duplicate generation: PERSISTENCE_ERROR fail-closed, first intact.
 * ============================================================================
 */

import { nativeHarness } from './native-harness.js';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { archiveRecords } from '../../src/chat-runtime/history.js';
import type { StreamEnvelope } from '../../src/contracts/stream.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

const bodyOf = (call: unknown) => JSON.parse(String((call as { body: unknown }).body));
const countIn = (body: unknown, text: string) => JSON.stringify(body).split(text).length - 1;

describe.skipIf(!configured)('Runtime session isolation', () => {
  it('two new sessions in one runtime isolate acceptance, context, manifest, and identity', async () => {
    const h = await nativeHarness();
    try {
      const r = new DurableChatRuntime(h.deps);
      const firstEvents: StreamEnvelope[] = [];
      const first = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'First user text', idempotencyKey: 'iso-request-1' });
      await r.executeTurn({ userId: h.identity.userId, ...first, signal: new AbortController().signal,
        emit: async e => { firstEvents.push(e); } });
      const secondEvents: StreamEnvelope[] = [];
      const second = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Second user text', idempotencyKey: 'iso-request-2' });
      await r.executeTurn({ userId: h.identity.userId, ...second, signal: new AbortController().signal,
        emit: async e => { secondEvents.push(e); } });
      expect(second.sessionId).not.toBe(first.sessionId);
      expect(firstEvents.at(-1)?.event).toMatchObject({ type: 'completed', outcome: 'completed' });
      expect(secondEvents.at(-1)?.event).toMatchObject({ type: 'completed', outcome: 'completed' });
      expect((await r.getTurnStatus(h.identity.userId, first.sessionId, first.turnId)).status).toBe('completed');
      expect((await r.getTurnStatus(h.identity.userId, second.sessionId, second.turnId)).status).toBe('completed');

      const bodies = h.fetcher.mock.calls.map(call => bodyOf(call[1]));
      expect(bodies).toHaveLength(2);
      for (const [index, body] of bodies.entries()) {
        const own = index === 0 ? 'First user text' : 'Second user text';
        const foreign = index === 0 ? 'Second user text' : 'First user text';
        expect(body.user).toBe(h.identity.userId);
        expect(body.model).toBe(h.deps.config.openRouter.modelId);
        expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'system', 'system', 'system', 'user']);
        expect(body.messages[3]).toEqual({ role: 'system', content: 'Response mode: text.' });
        expect(countIn(body, own)).toBe(1);
        expect(countIn(body, foreign)).toBe(0);
      }

      for (const ids of [first, second]) {
        const manifest = await h.persistence.memory.get(h.identity.userId, ids.sessionId);
        expect(manifest?.userId).toBe(h.identity.userId);
        expect(manifest?.sessionId).toBe(ids.sessionId);
        expect(manifest?.contextVersion).toBe(1);
        expect(manifest?.activeSummaryRef).toBeNull();
        expect(manifest?.messageRefs).toHaveLength(2);
        for (const ref of manifest?.messageRefs ?? []) expect(Object.keys(ref).sort()).toEqual(['eventId', 'messageId', 'sequence']);
        const archive = await archiveRecords(h.persistence, h.identity.userId, ids.sessionId);
        expect(archive.map(m => m.role)).toEqual(['user', 'assistant']);
      }
      const firstAccounting = await h.persistence.metadata.getAccounting(h.identity.userId, first.sessionId, first.attemptId);
      const secondAccounting = await h.persistence.metadata.getAccounting(h.identity.userId, second.sessionId, second.attemptId);
      expect(firstAccounting?.generationId).toBeTruthy();
      expect(secondAccounting?.generationId).toBeTruthy();
      expect(secondAccounting?.generationId).not.toBe(firstAccounting?.generationId);
    } finally { await h.close(); }
  }, 60000);

  it('a repeated provider generation across sessions fails the second turn closed without contaminating the first', async () => {
    const h = await nativeHarness();
    try {
      const repeated = (async () => new Response(FRAMES.normal,
        { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
      const r = new DurableChatRuntime({ ...h.deps, fetcher: repeated });
      const first = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'First user text', idempotencyKey: 'dup-request-1' });
      await r.executeTurn({ userId: h.identity.userId, ...first, signal: new AbortController().signal, emit: async () => undefined });
      expect((await r.getTurnStatus(h.identity.userId, first.sessionId, first.turnId)).status).toBe('completed');

      const secondEvents: StreamEnvelope[] = [];
      const second = await r.submitTurn({ identity: h.identity, sessionId: null, content: 'Second user text', idempotencyKey: 'dup-request-2' });
      await expect(r.executeTurn({ userId: h.identity.userId, ...second, signal: new AbortController().signal,
        emit: async e => { secondEvents.push(e); } })).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
      expect(secondEvents.some(e => e.event.type === 'completed')).toBe(false);
      expect((await r.getTurnStatus(h.identity.userId, second.sessionId, second.turnId)).status).toBe('failed');

      const firstManifest = await h.persistence.memory.get(h.identity.userId, first.sessionId);
      expect(firstManifest?.contextVersion).toBe(1);
      expect(firstManifest?.messageRefs).toHaveLength(2);
      const firstArchive = await archiveRecords(h.persistence, h.identity.userId, first.sessionId);
      expect(firstArchive.map(m => m.role)).toEqual(['user', 'assistant']);
      expect(firstArchive[1]?.completionStatus).toBe('completed');
      expect((await h.persistence.metadata.getAccounting(h.identity.userId, first.sessionId, first.attemptId))?.generationId).toBe('gen_fixture');
      const secondArchive = await archiveRecords(h.persistence, h.identity.userId, second.sessionId);
      expect(secondArchive.some(m => m.role === 'assistant' && m.completionStatus === 'completed')).toBe(false);
    } finally { await h.close(); }
  }, 60000);
});
