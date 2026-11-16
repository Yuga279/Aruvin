/**
 * ============================================================================
 * FILE: multi-mode.spec.ts
 * LOCATION: backend/test/voice/integration/multi-mode.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration tests for multi-mode session switching and turn collisions.
 *
 * ROLE IN PROJECT:
 *    Verifies end-to-end multi-mode history preservation across text, dictation,
 *    and live voice, cross-tab turn collisions (409 CONFLICT_ACTIVE_TURN),
 *    session binding isolation, and origin/identity validation.
 *
 * KEY COMPONENTS:
 *    - native multi-mode integration test suite
 *    - integratedFixture: Real Nest HTTP/native WebSocket + native runtime
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { integratedFixture, nativeConfigured, origin } from './integrated-fixture.js';

describe.skipIf(!nativeConfigured)('native multi-mode integration', () => {
  it('alternates text, draft-only dictation, live, and text with one shared history', async () => {
    const f = await integratedFixture();
    try {
      const first = await f.text(null, 'Remember ID ABC-42.', 'text-first-0001');
      const s = first.sessionId;
      const d = await f.connect('dictation', s, 'dictation-first-0001');
      const dictation = f.latest();
      d.pcm();
      dictation.stt.events.push({ type: 'partial', segmentId: 'one', text: 'not ABC' });
      dictation.stt.events.push({ type: 'partial', segmentId: 'one', text: 'not ABC-43' });
      dictation.stt.events.push({ type: 'final', segmentId: 'one', text: 'Not ABC-43.' });
      dictation.stt.events.push({ type: 'final', segmentId: 'one', text: 'Not ABC-43.' });
      await d.wait('dictation.final');
      expect(f.fetcher).toHaveBeenCalledTimes(1); // Pauses/finals do not infer.
      d.control({ type: 'dictation.stop' });
      await vi.waitFor(() => expect(dictation.stt.connection.finalize).toHaveBeenCalledOnce());
      dictation.stt.events.push({ type: 'finalized', unfinalizedTail: false });
      await d.wait('dictation.complete');
      await d.wait('session.ended');
      expect(d.events.filter(e => e.type === 'dictation.final')).toHaveLength(1);
      await f.text(s, 'Not ABC-43.', 'dictated-send-0001'); // Explicit Send only.

      const live = await f.connect('live', s, 'live-first-0001');
      const ref = await f.startReply(live, 'Which ID did I ask you to remember?');
      await f.finishReply(live, ref);
      const livePrompt = JSON.parse(String(f.fetcher.mock.calls[2]?.[1]?.body));
      expect(livePrompt.user).toBe(f.identity.userId);
      expect(livePrompt.messages.filter((m: { content: string }) => m.content === 'Remember ID ABC-42.')).toHaveLength(1);
      expect(livePrompt.messages.filter((m: { content: string }) => m.content === 'Which ID did I ask you to remember?')).toHaveLength(1);
      await f.end(live);
      await f.text(s, 'Continue in text.', 'text-last-0001');
      const prompt = JSON.parse(String(f.fetcher.mock.calls[3]?.[1]?.body));
      expect(prompt.messages.some((m: { content: string }) => m.content === 'Which ID did I ask you to remember?')).toBe(true);
      const visible = await request(f.url).get(`/api/sessions/${s}/messages`).expect(200);
      const nav = await request(f.url).get('/api/sessions').expect(200);
      // The spoken input never becomes chat content, navigation data, or a wire event.
      const chatContent = visible.body.items.map((m: { content: string }) => m.content);
      const transcripts = visible.body.items.flatMap((m: { voiceTranscripts?: { content: string }[] }) =>
        m.voiceTranscripts ?? []);
      expect(JSON.stringify([chatContent, nav.body, live.events()])).not.toContain('Which ID did I ask you to remember?');
      // The committed voice-transcript contract shows it to its owner as a voice transcript only.
      expect(transcripts.map((t: { content: string }) => t.content)).toContain('Which ID did I ask you to remember?');
      const users = visible.body.items.filter((m: { role: string }) => m.role === 'user');
      expect(users.filter((m: { content: string }) => m.content !== '')).toHaveLength(3);
      expect(users.filter((m: { mode?: string }) => m.mode === 'live')).toHaveLength(1);
      expect(f.fetcher).toHaveBeenCalledTimes(4);
    } finally { await f.close(); }
  }, 30_000);

  it('rejects across-tab submit/retry/live collisions with 409 CONFLICT_ACTIVE_TURN', async () => {
    const f = await integratedFixture();
    try {
      const first = await f.text(null, 'Text baseline.', 'text-baseline-0001');
      const s = first.sessionId;
      const live = await f.connect('live', s, 'live-lock-0001');
      const results = await Promise.all(['tab-a', 'tab-b'].map(tab => request(f.url)
        .post(`/api/sessions/${s}/turns`).send({ sessionId: s, content: tab, idempotencyKey: `${tab}-request-0001` })));
      for (const result of results) {
        expect(result.status).toBe(409);
        expect(result.body.code).toBe('CONFLICT_ACTIVE_TURN');
      }
      const retry = await request(f.url).post(`/api/sessions/${s}/turns/${first.turnId}/retry`)
        .send({ idempotencyKey: 'text-retry-0001' }).expect(409);
      expect(retry.body.code).toBe('CONFLICT_ACTIVE_TURN');
      const secondLive = await request(f.url).post('/api/voice/sessions').set('Origin', origin)
        .send({ protocolVersion: 1, mode: 'live', conversationId: s, locale: 'en-US', idempotencyKey: 'other-live-0001' }).expect(409);
      expect(secondLive.body.error.code).toBe('CONFLICT_ACTIVE_TURN');
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      await f.end(live);
      const accepted = await request(f.url).post(`/api/sessions/${s}/turns`)
        .send({ sessionId: s, content: 'Accepted, not yet executed.', idempotencyKey: 'text-held-0001' }).expect(202);
      const reverse = await request(f.url).post('/api/voice/sessions').set('Origin', origin)
        .send({ protocolVersion: 1, mode: 'live', conversationId: s, locale: 'en-US', idempotencyKey: 'reverse-live-0001' }).expect(409);
      expect(reverse.body.error.code).toBe('CONFLICT_ACTIVE_TURN');
      await f.runtime.reconcileSession(f.identity.userId, accepted.body.sessionId);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  }, 30_000);

  it('switches conversation binding without contaminating another session or reopening old audio', async () => {
    const f = await integratedFixture();
    try {
      const a = await f.text(null, 'PRIVATE_A marker.', 'session-a-0001');
      const b = await f.text(null, 'PRIVATE_B marker.', 'session-b-0001');
      const old = await f.connect('live', a.sessionId, 'live-a-0001');
      await f.end(old);
      const current = await f.connect('live', b.sessionId, 'live-b-0001');
      const ref = await f.startReply(current, 'Follow up in B.');
      await f.finishReply(current, ref);
      const body = JSON.parse(String(f.fetcher.mock.calls[2]?.[1]?.body));
      expect(JSON.stringify(body.messages)).toContain('PRIVATE_B marker.');
      expect(JSON.stringify(body.messages)).not.toContain('PRIVATE_A marker.');
      expect(current.response.conversationId).toBe(b.sessionId);
      expect(current.events().some(e => e.type.startsWith('dictation.'))).toBe(false);
      await f.end(current);
    } finally { await f.close(); }
  }, 30_000);

  it('rejects invalid Origin and client identity before allocating speech', async () => {
    const f = await integratedFixture();
    try {
      const body = { protocolVersion: 1, mode: 'live', conversationId: null, locale: 'en-US', idempotencyKey: 'invalid-0001' };
      await request(f.url).post('/api/voice/sessions').set('Origin', 'https://invalid.example').send(body).expect(403);
      await request(f.url).post('/api/voice/sessions').set('Origin', origin).send({ ...body, userId: 'attacker' }).expect(400);
      await request(f.url).post('/api/voice/sessions').set('Origin', origin).send({ ...body, conversationId: 'unknown' }).expect(403);
      expect(f.connections).toHaveLength(0);
      expect(f.fetcher).not.toHaveBeenCalled();
    } finally { await f.close(); }
  }, 30_000);
});
