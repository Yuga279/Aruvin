/**
 * ============================================================================
 * FILE: resilience.spec.ts
 * LOCATION: backend/test/voice/providers/resilience.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit and regression tests for provider faults, timeouts, queue bounds, heartbeats, and backoff.
 *
 * ROLE IN PROJECT:
 *    Validates system resilience under network drops, rate limits, buffer overflows,
 *    unacknowledged handshakes, dead sockets, and fresh-connection retry backoff.
 *
 * KEY COMPONENTS:
 *    - Nova / Flux failure settlement and error redaction tests
 *    - Input / output queue overflow and send stall tests
 *    - Heartbeat (Nova JSON KeepAlive vs Flux ping/pong) tests
 *    - Fresh-connect exponential backoff with jitter and deadline tests
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { NovaSttAdapter } from '../../../src/voice/providers/nova-stt.js';
import { FluxSttAdapter } from '../../../src/voice/providers/flux-stt.js';
import { FluxTtsAdapter } from '../../../src/voice/providers/flux-tts.js';
import { connectWithBackoff } from '../../../src/voice/providers/connect-backoff.js';
import type { SttEvent, TtsEvent } from '../../../src/contracts/voice.js';
import { ProviderFault } from '../../../src/voice/providers/provider-link.js';
import { config, input, output, harness, collect, connected, metadata, novaResult, tick } from '../../fixtures/deepgram/socket.js';
import novaMessages from '../../fixtures/deepgram/nova-results.json' with { type: 'json' };
import fluxMessages from '../../fixtures/deepgram/flux-turns.json' with { type: 'json' };
import speechMessages from '../../fixtures/deepgram/flux-speech.json' with { type: 'json' };
afterEach(() => vi.useRealTimers());
const r = { turnId: 'turn-1', responseId: 'response-1' };

it('rejects a pending Nova finalization on a dead socket without losing finals', async () => {
  const h = harness(); const c = await new NovaSttAdapter(config(), h.factory, h.accounting).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  h.sockets[0].json(novaResult('Keep.', true));
  const stopping = c.finalize(); const rejection = expect(stopping).rejects.toMatchObject({ fault: { code: 'STT_UNAVAILABLE' } });
  await tick(); h.sockets[0].emit('error', new Error('private provider description test-secret-not-real'));
  await rejection; await done;
  expect(events.filter(e => e.type === 'final')).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain('private provider');
  expect(JSON.stringify(events)).not.toContain('test-secret');
});

it('settles blocked writes within the input queue deadline and sends no replay', async () => {
  vi.useFakeTimers(); const h = harness(connected);
  const pending = new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live')); await vi.advanceTimersByTimeAsync(0); const c = await pending;
  h.sockets[0].holdSends = true; const write = c.writeAudio(new Uint8Array(2560));
  const rejection = expect(write).rejects.toMatchObject({ fault: { code: 'STT_UNAVAILABLE' } });
  await vi.advanceTimersByTimeAsync(1000); await rejection;
  expect(h.sockets).toHaveLength(1); expect(h.sockets[0].terminated).toBe(true);
  h.sockets[0].callbacks[0](); await c.close();
});

it('rejects an over-budget input queue and output exceeding bounded pause headroom rather than dropping commands', async () => {
  const h = harness(connected); const c = await new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  h.sockets[0].bufferedAmount = 32000;
  await expect(c.writeAudio(new Uint8Array(2560))).rejects.toMatchObject({ fault: { code: 'AUDIO_BUFFER_OVERFLOW' } });
  const h2 = harness(connected); const tts = await new FluxTtsAdapter(config(), h2.factory, h2.accounting).connect(output());
  await tts.speak({ ...r, text: 'Hello.' }); h2.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
   for (let i = 0; i < 3; i++) h2.sockets[0].binary(new Uint8Array(96000));
  const events: TtsEvent[] = []; await collect(tts.events, events);
  expect(events).toContainEqual({ type: 'error', fault: { code: 'AUDIO_BUFFER_OVERFLOW', recovery: 'return_to_chat', recoverable: true } });
  expect(h2.sockets[0].terminated).toBe(true);
});

it('aborts connection immediately and cannot leave timers or orphan sockets', async () => {
  vi.useFakeTimers(); const abort = new AbortController(); const h = harness();
  const cPromise = new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live', abort.signal));
  const rejection = expect(cPromise).rejects.toMatchObject({ fault: { code: 'VOICE_SESSION_ENDED' } });
  abort.abort(); await rejection; await vi.advanceTimersByTimeAsync(0);
  expect(h.sockets).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
});

it('bounds a missing Connected handshake and redacts HTTP rate-limit failures', async () => {
  vi.useFakeTimers(); const h = harness();
  const p = new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  const rejected = expect(p).rejects.toMatchObject({ fault: { code: 'VOICE_CONNECT_TIMEOUT' } });
  await vi.advanceTimersByTimeAsync(10000); await rejected; expect(vi.getTimerCount()).toBe(0);
  const h2 = harness();
  const factory: typeof h2.factory = (url, headers) => {
    const socket = h2.factory(url, headers);
    socket.open = () => { socket.emit('unexpected-response', {}, { statusCode: 429, resume() {} }); };
    return socket;
  };
  const p2 = new NovaSttAdapter(config(), factory, h2.accounting).connect(input('dictation'));
  const rejected2 = expect(p2).rejects.toMatchObject({ fault: { code: 'VOICE_PROVIDER_RATE_LIMITED' } });
  await rejected2;
});

it('keeps Nova alive with JSON but Flux TTS with ping, and detects dead pong', async () => {
  vi.useFakeTimers(); const h = harness(); const p = new NovaSttAdapter(config(), h.factory, h.accounting).connect(input('dictation'));
  await vi.advanceTimersByTimeAsync(0); const nova = await p;
  await vi.advanceTimersByTimeAsync(4000); expect(h.sockets[0].controls()).toContainEqual({ type: 'KeepAlive' }); await nova.close();
  const h2 = harness(connected); const p2 = new FluxTtsAdapter(config(), h2.factory, h2.accounting).connect(output());
  await vi.advanceTimersByTimeAsync(0); const tts = await p2;
  h2.sockets[0].ping = () => { h2.sockets[0].pings++; };
  await vi.advanceTimersByTimeAsync(20000); expect(h2.sockets[0].pings).toBe(1);
  await vi.advanceTimersByTimeAsync(5000); expect(h2.sockets[0].terminated).toBe(true);
  expect(vi.getTimerCount()).toBe(0); await tts.close();
});

it('keeps Flux TTS pinging while PCM output is paused without treating a missing pong as death', async () => {
  vi.useFakeTimers();
  const h = harness(connected);
  const pending = new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  await vi.advanceTimersByTimeAsync(0);
  const tts = await pending;
  await tts.speak({ ...r, text: 'Long answer.' });
  const s = h.sockets[0];
  s.json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  for (let i = 0; i < 11; i++) s.binary(new Uint8Array(9600));
  expect(s.paused).toBe(true);
  s.ping = () => { s.pings++; };
  await vi.advanceTimersByTimeAsync(20000);
  expect(s.pings).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(5000);
  expect(s.terminated).toBe(false);
  await tts.close();
});

it('reports unknown delivery when an established TTS socket dies', async () => {
  const h = harness(connected); const c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...r, text: 'Hello.' }); h.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  h.sockets[0].emit('error', new Error('secret')); await done;
  expect(events.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ ...r, audioPlayedMs: null, textSpoken: null, textRemaining: null }]);
  expect(h.sockets).toHaveLength(1);
});

it('bounds first synthesis audio after Speak even without Flush', async () => {
  vi.useFakeTimers(); const h = harness(connected); const p = new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  await vi.advanceTimersByTimeAsync(0); const c = await p;
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...r, text: 'Hello.' }); await vi.advanceTimersByTimeAsync(30000); await done;
  expect(events.filter(e => e.type === 'speech-interrupted')).toHaveLength(1); expect(h.sockets[0].terminated).toBe(true);
});

it('fresh live connects back off with jitter, terminate at 10s, and never retry fatal rejection', async () => {
  vi.useFakeTimers(); const controller = new AbortController();
  const operation = vi.fn().mockRejectedValueOnce(new ProviderFault('STT_UNAVAILABLE', 'repeat_turn')).mockResolvedValue('fresh');
  const p = connectWithBackoff(operation, { signal: controller.signal, deadlineMs: 10000, random: () => 0 });
  await vi.advanceTimersByTimeAsync(249); expect(operation).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(await p).toBe('fresh');
  const fatal = vi.fn().mockRejectedValue(new ProviderFault('INVALID_VOICE_REQUEST', 'none', false));
  await expect(connectWithBackoff(fatal, { signal: controller.signal, deadlineMs: 10000 })).rejects.toMatchObject({ fault: { code: 'INVALID_VOICE_REQUEST' } });
  expect(fatal).toHaveBeenCalledTimes(1);
  const never = connectWithBackoff(() => new Promise<string>(() => {}), { signal: controller.signal, deadlineMs: 10000 });
  const rejected = expect(never).rejects.toMatchObject({ fault: { code: 'VOICE_RECONNECT_TIMEOUT' } });
  await vi.advanceTimersByTimeAsync(10000); await rejected; expect(vi.getTimerCount()).toBe(0);
});

it('keeps a successful backoff socket alive until parent cancellation', async () => {
  const controller = new AbortController(); const h = harness(connected);
  const c = await connectWithBackoff(signal => new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live', signal)),
    { signal: controller.signal, deadlineMs: 10000 });
  expect(h.sockets[0].readyState).toBe(1);
  const events: SttEvent[] = []; const done = collect(c.events, events);
  controller.abort(); await done; expect(h.sockets[0].terminated).toBe(true);
});

it('replays the documented fixture families through their actual adapter message paths', async () => {
  const n = harness(); const nc = await new NovaSttAdapter(config(), n.factory, n.accounting).connect(input('dictation'));
  const ne: SttEvent[] = []; const nd = collect(nc.events, ne);
  for (const m of novaMessages.slice(0, 4)) n.sockets[0].json(m);
  const stop = nc.finalize(); await tick(); n.sockets[0].json(novaMessages[4]); await stop; await nd;
  expect(ne.flatMap(e => e.type === 'final' ? [e.text] : [])).toEqual(['Demo 42.', 'Final tail.']);
  const f = harness(fluxMessages[0]); const fc = await new FluxSttAdapter(config(), f.factory, f.accounting).connect(input('live'));
  const fe: SttEvent[] = []; const fd = collect(fc.events, fe);
  for (const m of fluxMessages.slice(1)) f.sockets[0].json(m); await tick(); await fc.close(); await fd;
  expect(fe.filter(e => e.type === 'end-of-turn').map(e => e.text)).toEqual(['What is next?']);
  const t = harness(speechMessages.connected); const tc = await new FluxTtsAdapter(config(), t.factory, t.accounting).connect(output());
  const te: TtsEvent[] = []; const td = collect(tc.events, te);
  await tc.speak({ ...r, text: 'Hello world.' }); t.sockets[0].json(speechMessages.started); t.sockets[0].binary(new Uint8Array(4800));
  await tc.interrupt({ ...r, providerSocketId: tc.providerSocketId, playbackPositionMs: 50 });
  t.sockets[0].json(speechMessages.interrupted); await tick(); await tc.close(); await td;
  expect(te.filter(e => e.type === 'speech-interrupted')).toMatchObject([{ textSpoken: 'Hello', textRemaining: ' world.', audioPlayedMs: 50 }]);
});

it('rejects invalid consumed provider fields without leaking provider payloads', async () => {
  const h = harness(); const c = await new NovaSttAdapter(config(), h.factory, h.accounting).connect(input('dictation'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  h.sockets[0].json({ ...novaResult('secret', true), start: -1 }); await done;
  expect(events.filter(e => e.type !== 'usage')).toEqual([{ type: 'error', fault: { code: 'STT_UNAVAILABLE', recovery: 'retry_dictation', recoverable: true } }]);
  const h2 = harness(connected); const c2 = await new FluxTtsAdapter(config(), h2.factory, h2.accounting).connect(output());
  await c2.speak({ ...r, text: 'Hello.' }); h2.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  const e2: TtsEvent[] = []; const d2 = collect(c2.events, e2); h2.sockets[0].binary(new Uint8Array(3)); await d2;
  expect(e2.some(e => e.type === 'error')).toBe(true);
});

it('drops old Flux turns and stale TTS metadata without corrupting a current response', async () => {
  const h = harness(connected); const c = await new FluxTtsAdapter(config(), h.factory, h.accounting).connect(output());
  const events: TtsEvent[] = []; const done = collect(c.events, events);
  await c.speak({ ...r, text: 'Hello world.' }); h.sockets[0].json({ type: 'SpeechStarted', speech_id: metadata().speech_id });
  h.sockets[0].binary(new Uint8Array(4800)); await c.flush(r);
  h.sockets[0].json({ type: 'SpeechMetadata', ...metadata('dg_sp_old000000000') }); await tick();
  expect(events.some(e => e.type === 'speech-completed')).toBe(false);
  h.sockets[0].json({ type: 'SpeechMetadata', ...metadata() }); await tick(); await c.close(); await done;
  expect(events.filter(e => e.type === 'speech-completed')).toHaveLength(1);
});

it('reports STT input duration and the available provider version rather than inventing billing', async () => {
  const h = harness(connected); const c = await new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  const events: SttEvent[] = []; const done = collect(c.events, events);
  await c.writeAudio(new Uint8Array(2560)); await c.close(); await done;
  expect(events).toContainEqual({ type: 'usage', usage: { usageId: expect.any(String), providerRequestId: 'fixture-request',
    model: 'flux-general-en', modelVersion: connected.model_version, audioMs: 80, billableCharacters: null } });
});

it('holds quiet Flux STT with protocol pings and no KeepAlive or replacement PCM', async () => {
  vi.useFakeTimers();
  const h = harness(connected);
  const opening = new FluxSttAdapter(config(), h.factory, h.accounting).connect(input('live'));
  await vi.advanceTimersByTimeAsync(0);
  const c = await opening;
  try {
    await vi.advanceTimersByTimeAsync(180_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].pings).toBe(9);
    expect(h.sockets[0].sent).toEqual([]);
    expect(h.sockets[0].terminated).toBe(false);
  } finally { await c.close(); }
});
