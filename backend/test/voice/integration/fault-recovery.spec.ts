/**
 * ============================================================================
 * FILE: fault-recovery.spec.ts
 * LOCATION: backend/test/voice/integration/fault-recovery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration tests for voice fault injection and durable recovery behavior.
 *
 * ROLE IN PROJECT:
 *    Verifies behavior during provider errors, mid-speech barge-in interruption,
 *    reconnection with fresh epochs without duplicate playback/inference, and
 *    sealed-result recovery after runtime crashes.
 *
 * KEY COMPONENTS:
 *    - native voice fault recovery suite
 *    - Injected TTS/STT failure and execution stop scenarios
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { integratedFixture, liveConfigSnapshot, nativeConfigured, speechUsage } from './integrated-fixture.js';
import { voiceRuntimeHarness } from '../../runtime/voice-runtime-harness.js';
import { DurableChatRuntime } from '../../../src/chat-runtime/durable-chat-runtime.js';
import { attemptsFor, archiveRecords } from '../../../src/chat-runtime/history.js';
import { deliveryFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { voiceDeliveryRecordSchema } from '../../../src/contracts/voice.js';
import { key } from '../../../src/persistence/records.js';

describe.skipIf(!nativeConfigured)('native voice fault recovery', () => {
  it('preserves generated results when the TTS provider drops mid-turn without reinference', async () => {
    const f = await integratedFixture();
    try {
      const p = await f.connect('live', null, 'tts-drop-0001');
      await f.startReply(p, 'PRIVATE network-drop input.');
      const c = f.latest(), s = c.context.response.conversationId!;
      c.tts.events.push({ type: 'error', fault: { code: 'TTS_UNAVAILABLE', recoverable: true, recovery: 'return_to_chat' } });
      await p.wait('session.error');
      await vi.waitFor(() => expect(c.bridge?.currentResponse()).toBeNull(), { timeout: 5000 });
      await f.runtime.reconcileSession(f.identity.userId, s);
      await f.runtime.reconcileSession(f.identity.userId, s);
      const a = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
      expect(a.status).toBe('completed');
      expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, a.attemptId))
        .toMatchObject({ status: 'unknown', textGenerated: 'Hello world.', textSpoken: null });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(p.events())).not.toMatch(/PRIVATE|Hello world/);
    } finally { await f.close(); }
  }, 30_000);

  it('reconciles mid-speech barge-in and excludes unheard text from the next prompt', async () => {
    const f = await integratedFixture();
    try {
      const p = await f.connect('live', null, 'barge-in-0001');
      const ref = await f.startReply(p, 'First voice question.');
      const c = f.latest(), s = c.context.response.conversationId!;
      await vi.waitFor(() => expect(p.events().some(e => e.type === 'audio.watermark' && e.responseId === ref.responseId)).toBe(true));
      p.control({ type: 'playback.progress', ...ref, playedSamples: 1200, playedMs: 50, proof: 'proven' });
      p.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 });
      await p.wait('response.cancelled');
      c.tts.events.push({ type: 'speech-interrupted', ...ref, speechId: 'speech-1', audioPlayedMs: 50,
        textSpoken: 'Hello', textRemaining: ' world.', usage: speechUsage });
      c.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
      await vi.waitFor(() => expect(c.bridge?.currentResponse()).toBeNull(), { timeout: 5000 });
      expect(c.tts.connection.interrupt).toHaveBeenCalledOnce();
      expect(p.captured()).toBe(1);
      const a = (await attemptsFor(f.persistence, f.identity.userId, s))[0]!;
      expect(await f.persistence.metadata.getVoiceDelivery(f.identity.userId, s, a.attemptId))
        .toMatchObject({ status: 'interrupted', textGenerated: 'Hello world.', textSpoken: 'Hello', textRemaining: ' world.' });
      c.stt.events.push({ type: 'end-of-turn', providerTurnId: 'provider:1', text: 'Continue from what I heard.' });
      await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2), { timeout: 5000 });
      const body = JSON.parse(String(f.fetcher.mock.calls[1]?.[1]?.body));
      expect(body.messages.filter((m: { role: string }) => m.role === 'assistant'))
        .toEqual([{ role: 'assistant', content: 'Hello' }]);
      expect(body.messages.filter((m: { content: string }) => m.content === 'Continue from what I heard.')).toHaveLength(1);
    } finally { await f.close(); }
  }, 30_000);

  it('reconnects with a fresh epoch and no old audio, partial input, or automatic inference replay', async () => {
    const f = await integratedFixture();
    try {
      const p = await f.connect('live', null, 'reconnect-0001');
      const ref = await f.startReply(p, 'Durable input.');
      await f.finishReply(p, ref);
      const old = f.latest(), s = old.context.response.conversationId!;
      p.pcm();
      await vi.waitFor(() => expect(old.stt.connection.writeAudio).toHaveBeenCalledOnce());
      old.stt.events.push({ type: 'partial', segmentId: 'lost', text: 'incomplete input' });
      p.lose();
      await vi.waitFor(() => expect(old.stt.connection.close).toHaveBeenCalledOnce(), { timeout: 5000 });
      const fresh = await f.connect('live', s, 'reconnect-0001');
      expect(fresh.response.sessionId).toBe(p.response.sessionId);
      expect(fresh.response.connectionEpoch).toBe(p.response.connectionEpoch + 1);
      const current = f.latest();
      expect(current.stt.connection.writeAudio).not.toHaveBeenCalled();
      expect(current.tts.connection.speak).not.toHaveBeenCalled();
      expect(current.tts.connection.interrupt).not.toHaveBeenCalled();
      expect(fresh.captured()).toBe(0);
      await f.runtime.reconcileSession(f.identity.userId, s);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(await attemptsFor(f.persistence, f.identity.userId, s)).toHaveLength(1);
      // Explicit new audio is permitted, but nothing buffered from the old socket is sent.
      fresh.pcm();
      await vi.waitFor(() => expect(current.stt.connection.writeAudio).toHaveBeenCalledOnce());
      await f.end(fresh);
    } finally { await f.close(); }
  }, 30_000);

  it('recovers a sealed result after executor publication failure without provider or audio replay', async () => {
    const h = await voiceRuntimeHarness();
    try {
      const reservation = await h.runtime.reservations.acquire({ identity: h.identity, conversationId: 'crash-chat',
        owner: { kind: 'live', voiceSessionId: 'crash-voice' } });
      const ids = await h.runtime.submitLiveTurn({ identity: h.identity, sessionId: 'crash-chat',
        content: 'PRIVATE accepted crash input.', idempotencyKey: 'crash-turn-0001', reservation,
        configSnapshot: liveConfigSnapshot() });
      const append = h.persistence.messages.append.bind(h.persistence.messages);
      const failure = vi.spyOn(h.persistence.messages, 'append').mockImplementation(async m => {
        if (m.role === 'assistant') throw new Error('injected archive failure'); return append(m);
      });
      try {
        await expect(h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
          signal: new AbortController().signal, emit: async () => undefined, live: { reservation,
            start: async (a, write) => { await write(voiceDeliveryRecordSchema.parse({ ...deliveryFixture(),
              userId: a.userId, sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId,
              responseId: key('voice-response', a.userId, a.sessionId, a.attemptId),
              voiceSessionId: 'crash-voice', textGenerated: '', status: 'pending', textSpoken: null,
              textRemaining: null, audioDurationMs: null, audioPlayedMs: null, playedSamples: null })); },
            delta: async () => undefined, finish: async () => undefined,
            settle: async () => { throw new Error('injected executor stop before settlement'); },
          } })).rejects.toThrow();
      } finally { failure.mockRestore(); }
      // Execution has settled. This sequential object reconstruction is fault injection,
      // not a real process death or a stale-sentinel takeover.
      const restarted = new DurableChatRuntime(h.deps);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      await restarted.reconcileSession(h.identity.userId, ids.sessionId);
      const rows = await archiveRecords(h.persistence, h.identity.userId, ids.sessionId);
      expect(rows.map(m => [m.role, m.visibility])).toEqual([['user', 'internal'], ['assistant', 'internal']]);
      expect((await attemptsFor(h.persistence, h.identity.userId, ids.sessionId))[0]?.status).toBe('completed');
      expect(await h.persistence.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId))
        .toMatchObject({ status: 'unknown', textGenerated: rows[1]!.content, textSpoken: null });
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { await h.close(); }
  }, 30_000);
});
