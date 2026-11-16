/**
 * ============================================================================
 * FILE: flux-tts.spec.ts
 * LOCATION: backend/test/voice/providers/flux-tts.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit and regression tests for Deepgram Flux conversational TTS adapter.
 *
 * ROLE IN PROJECT:
 *    Verifies raw PCM24k audio streaming, response turn fencing, SpeechMetadata
 *    completion gating, socket-wide interruption offset normalization, and timeout handling.
 *
 * KEY COMPONENTS:
 *    - Model voice streaming and SpeechMetadata tests (Haley, Alexis, Priya)
 *    - Interruption offset reconciliation and late audio invalidation tests
 *    - Unknown delivery edge-case and timeout tests
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { FluxTtsAdapter } from '../../../src/voice/providers/flux-tts.js';
import type { TtsEvent } from '../../../src/contracts/voice.js';
import { config, output, harness, collect, tick, connected, metadata } from '../../fixtures/deepgram/socket.js';
afterEach(() => vi.useRealTimers());
const response = { turnId: 'turn-1', responseId: 'response-1' };

it.each(['flux-haley-en', 'flux-alexis-en', 'flux-priya-en'] as const)(
  'streams %s raw PCM24k, preserves whitespace and waits for SpeechMetadata', async model => {
    const h = harness({ ...connected, model_name: model }); const cfg = config(); cfg.deepgram.ttsModel = model;
    const c = await new FluxTtsAdapter(cfg, h.factory, h.accounting).connect(output());
    const events: TtsEvent[] = []; const done = collect(c.events, events); const s = h.sockets[0];
    await c.speak({ ...response, text: 'Hello' }); await c.speak({ ...response, text: ' world.' });
    expect(s.controls()).toEqual([{ type: 'Speak', text: 'Hello' }, { type: 'Speak', text: ' world.' }]);
    s.json({ type: 'SpeechStarted', speech_id: metadata().speech_id }); s.binary(new Uint8Array(4800));
    await c.flush(response); s.json({ type: 'Flushed', speech_id: metadata().speech_id }); await tick();
    expect(events.some(e => e.type === 'speech-completed')).toBe(false);
    await expect(c.speak({ turnId: 'turn-2', responseId: 'response-2', text: 'Too early' })).rejects.toMatchObject({ fault: { code: 'VOICE_INVALID_STATE' } });
    s.json({ type: 'SpeechMetadata', ...metadata() }); await tick();
    expect(events.filter(e => e.type === 'audio')).toEqual([{ type: 'audio', ...response, pcm: new Uint8Array(4800) }]);
    expect(events.filter(e => e.type === 'speech-completed')).toMatchObject([{ ...response, audioDurationMs: 100,
      usage: { model, modelVersion: 'fixture-2026-10-08', billableCharacters: 12 } }]);
    expect(h.requests[0].url.pathname).toBe('/v2/speak');
    expect(Object.fromEntries(h.requests[0].url.searchParams)).toEqual({ tag: h.accounting.tag, model, encoding: 'linear16', sample_rate: '24000' });
    await c.close(); await done;
  });

it('accepts a bounded resolved model name different from the requested Flux voice', async () => {
  const h = harness({ ...connected, model_name: 'fixture-resolved-haley-v2' });
  const c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  try {
    expect(h.requests[0].url.searchParams.get('model')).toBe('flux-haley-en');
    expect(h.sockets[0].readyState).toBe(1);
    expect(h.sockets[0].terminated).toBe(false);
  } finally {
    await c.close();
  }
});

it.each(['model_name', 'request_id', 'model_version'] as const)(
  'rejects missing, empty, non-string and overlong Connected %s', async field => {
    for (const value of [undefined, '', 42, 'x'.repeat(129)]) {
      const packet: Record<string, unknown> = { ...connected };
      if (value === undefined) delete packet[field];
      else packet[field] = value;
      const h = harness(packet);
      await expect(new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output()))
        .rejects.toMatchObject({ fault: { code: 'TTS_UNAVAILABLE' } });
      expect(h.sockets[0].terminated).toBe(true);
    }
  });

it.each(['x', 'x'.repeat(128)])('accepts bounded resolved model name %s', async name => {
  const h = harness({ ...connected, model_name: name });
  const c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  await c.close();
});

it('invalidates queued and late audio and reconciles socket offset to response duration', async () => {
  const h = harness(connected); const c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output()); const s = h.sockets[0];
  await c.speak({ ...response, text: 'First.' }); s.json({ type: 'SpeechStarted', speech_id: 'dg_sp_000000000001' });
  s.binary(new Uint8Array(4800)); await c.flush(response); s.json({ type: 'SpeechMetadata', ...metadata('dg_sp_000000000001', 100, 6) });
  const second = { turnId: 'turn-2', responseId: 'response-2' };
  await c.speak({ ...second, text: 'Hello world.' }); s.json({ type: 'SpeechStarted', speech_id: 'dg_sp_000000000002' });
  s.binary(new Uint8Array(4800));
  await expect(c.interrupt({ ...second, providerSocketId: 'wrong-socket', playbackPositionMs: 150 })).rejects.toMatchObject({ fault: { code: 'VOICE_BINDING_MISMATCH' } });
  await c.interrupt({ ...second, providerSocketId: c.providerSocketId, playbackPositionMs: 150 });
  await c.interrupt({ ...second, providerSocketId: c.providerSocketId, playbackPositionMs: 150 });
  s.binary(new Uint8Array(480));
  s.json({ type: 'SpeechInterrupted', audio_played_ms: 150, text_spoken: 'Hello', text_remaining: ' world.', metadata: metadata('dg_sp_000000000002', 50) });
  const events: TtsEvent[] = []; const done = collect(c.events, events); await tick(); await c.close(); await done;
  expect(s.controls().filter((m: unknown) => (m as { type: string }).type === 'Interrupt')).toEqual([
    { type: 'Interrupt', playback_offset: { type: 'time_ms', value: 150 } },
  ]);
  expect(events.filter(e => e.type === 'audio').map(e => e.responseId)).toEqual(['response-1']);
  expect(events.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ ...second,
    audioPlayedMs: 50, textSpoken: 'Hello', textRemaining: ' world.' }]);
});

it('never fabricates an advancing offset; missing reconciliation remains unknown', async () => {
  const h = harness(connected); const c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output()); const s = h.sockets[0];
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...response, text: 'Hello world.' }); s.json({ type: 'SpeechStarted', speech_id: metadata().speech_id }); s.binary(new Uint8Array(4800));
  await c.interrupt({ ...response, providerSocketId: c.providerSocketId, playbackPositionMs: 50 });
  s.json({ type: 'SpeechInterrupted', audio_played_ms: 50, metadata: metadata() }); await tick();
  expect(events.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ audioPlayedMs: null, textSpoken: null, textRemaining: null }]);
  const next = { turnId: 'turn-2', responseId: 'response-2' };
  await c.speak({ ...next, text: 'Unheard.' }); s.json({ type: 'SpeechStarted', speech_id: 'dg_sp_000000000002' });
  await c.interrupt({ ...next, providerSocketId: c.providerSocketId, playbackPositionMs: 50 }); await done;
  expect(s.controls().filter((m: unknown) => (m as { type: string }).type === 'Interrupt')).toHaveLength(1);
  expect(events).toContainEqual({ type: 'error', fault: { code: 'VOICE_DELIVERY_UNKNOWN', recovery: 'return_to_chat', recoverable: true } });
  const h2 = harness(connected); const fresh = await new FluxTtsAdapter(config(), h2.factory, h2.accounting).connect(output());
  expect(fresh.providerSocketId).not.toBe(c.providerSocketId);
  await fresh.speak({ ...response, text: 'Fresh.' }); h2.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id }); h2.sockets[0].binary(new Uint8Array(4800));
  await fresh.interrupt({ ...response, providerSocketId: fresh.providerSocketId, playbackPositionMs: 25 });
  expect(h2.sockets[0].controls()).toContainEqual({ type: 'Interrupt', playback_offset: { type: 'time_ms', value: 25 } });
  await fresh.close();
});

it('interrupt timeout invalidates speech before acknowledgement without assuming delivery', async () => {
  vi.useFakeTimers(); const h = harness(connected);
  const pending = new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output()); await vi.advanceTimersByTimeAsync(0); const c = await pending;
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...response, text: 'Hello world.' }); h.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  h.sockets[0].binary(new Uint8Array(4800)); await c.interrupt({ ...response, providerSocketId: c.providerSocketId, playbackPositionMs: 50 });
  h.sockets[0].binary(new Uint8Array(480)); await vi.advanceTimersByTimeAsync(2000); await done;
  expect(events.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ audioPlayedMs: null, textSpoken: null, textRemaining: null }]);
  expect(events.filter(e => e.type === 'audio')).toHaveLength(0);
});

it('backpressures bursty PCM within finite queue memory rather than failing valid synthesis', async () => {
  const h = harness(connected), c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  await c.speak({ ...response, text: 'Long answer.' });
  const s = h.sockets[0];
  s.json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  for (let i = 0; i < 11; i++) s.binary(new Uint8Array(9600));
  expect(s.terminated).toBe(false);
  expect(s.paused).toBe(true);
  const events: TtsEvent[] = [], done = collect(c.events, events);
  await tick(); await tick();
  expect(s.paused).toBe(false);
  expect(events.filter(e => e.type === 'audio')).toHaveLength(11);
  await c.close(); await done;
});

it('coalesces small irregular packets already decoded before socket pause without losing samples', async () => {
  const h = harness(connected), c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  await c.speak({ ...response, text: 'Answer.' });
  const s = h.sockets[0]; s.json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  for (let i = 0; i < 300; i++) s.binary(new Uint8Array(50));
  expect(s.terminated).toBe(false);
  await c.flush(response); s.json({ type: 'SpeechMetadata', ...metadata(metadata().speech_id, 312, 7) });
  const events: TtsEvent[] = [], done = collect(c.events, events);
  await tick(); await tick(); await c.close(); await done;
  expect(events.reduce((n, e) => n + (e.type === 'audio' ? e.pcm.length / 2 : 0), 0)).toBe(7500);
});
