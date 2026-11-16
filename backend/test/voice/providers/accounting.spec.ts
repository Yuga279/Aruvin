/**
 * ============================================================================
 * FILE: accounting.spec.ts
 * LOCATION: backend/test/voice/providers/accounting.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify offline provider attribution and durable lifecycle accounting.
 * ROLE IN PROJECT:
 *    Exercises real adapters with deterministic sockets and ledger writes.
 *    Covers admission, evidence retention, cancellation, and write-drain failures.
 * KEY COMPONENTS:
 *    - Socket admission, failures, repeated speech and write failure checks.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import type { VoiceAccountingRecord } from '../../../src/contracts/voice-accounting.js';
import { VoiceAccounting } from '../../../src/voice/usage/voice-accounting.js';
import { NovaSttAdapter } from '../../../src/voice/providers/nova-stt.js';
import { FluxSttAdapter } from '../../../src/voice/providers/flux-stt.js';
import { FluxTtsAdapter } from '../../../src/voice/providers/flux-tts.js';
import { config, harness, input, output, connected, metadata, tick, novaResult } from '../../fixtures/deepgram/socket.js';
import { revisionFixture } from '../session/fixtures.js';

function ledger(write?: (record: VoiceAccountingRecord) => Promise<void>) {
  const rows: VoiceAccountingRecord[] = [];
  const cfg = config(); cfg.rates.fluxTtsPerThousandCharsUsd = 0.015;
  const accounting = new VoiceAccounting({ userId: 'private-dev-identity', voiceSessionId: 'voice-1',
    conversationId: () => null, config: cfg,
    write: async record => { await write?.(record); rows.push(record); } });
  return { accounting, rows };
}

it('tags all three requests with the same bounded pseudonym and persists before opening sockets', async () => {
  const f = ledger();
  for (const [Adapter, request, hello] of [
    [NovaSttAdapter, input('dictation'), null], [FluxSttAdapter, input('live'), connected],
    [FluxTtsAdapter, output(), connected],
  ] as const) {
    const h = harness(hello);
    const factory: typeof h.factory = (url, headers) => {
      expect(f.rows.at(-1)?.status).toBe('pending');
      expect(url.searchParams.get('tag')).toBe(f.accounting.tag);
      expect(url.toString()).not.toContain('private-dev-identity');
      return h.factory(url, headers);
    };
    // Each adapter has its own server-only accounting injection.
    const adapter = new Adapter(config(), factory, f.accounting);
    const connection = await adapter.connect(request as never);
    await connection.close();
  }
  expect(f.accounting.tag.length).toBeLessThanOrEqual(128);
  expect(f.rows.filter(r => r.status === 'pending')).toHaveLength(3);
});

it('prevents sockets when pending accounting fails and records connect failure as unknown billing', async () => {
  const h = harness(); const f = ledger(async () => { throw new Error('storage offline'); });
  await expect(new NovaSttAdapter(config(), h.factory, f.accounting).connect(input('dictation'))).rejects.toThrow();
  expect(h.requests).toHaveLength(0);
  const failed = ledger();
  await expect(new NovaSttAdapter(config(), () => { throw new Error('connect failed'); }, failed.accounting)
    .connect(input('dictation'))).rejects.toThrow();
  expect(failed.rows.at(-1)).toMatchObject({ status: 'failed', audioMs: null, actualCostUsd: null });
});

it('accounts identical TTS responses separately, once each, before Speak and independently of event consumption', async () => {
  const f = ledger(); const h = harness(connected);
  const connection = await new FluxTtsAdapter(config(), h.factory, f.accounting).connect(output());
  const socket = h.sockets[0];
  for (const responseId of ['response-1', 'response-2']) {
    await connection.speak({ turnId: 'turn-1', responseId, text: 'Hello' });
    expect(f.rows.at(-1)).toMatchObject({ status: 'pending', responseId });
    socket.json({ type: 'SpeechStarted', speech_id: responseId });
    await connection.flush({ turnId: 'turn-1', responseId });
    socket.json({ type: 'SpeechMetadata', ...metadata(responseId) });
    socket.json({ type: 'SpeechMetadata', ...metadata(responseId) });
    await tick();
  }
  await connection.close();
  expect(f.rows.filter(r => r.responseId && r.status === 'completed')).toHaveLength(2);
  expect(new Set(f.rows.filter(r => r.responseId).map(r => r.usageId)).size).toBe(2);
  for (const record of f.rows.filter(r => r.status === 'completed')) expect(record.estimatedCostUsd).toBeCloseTo(0.00018, 8);
  for (const record of f.rows.filter(r => r.status === 'completed')) expect(record.money).toMatchObject({
    reportedAmount: null, estimatedAmount: '0.00018', costStatus: 'unknown', source: 'provider-estimate',
    pricing: { units: 12, unitSize: 1000, rateUsd: '0.015', source: 'operator-configured', version: 'voice-rate-snapshot-v1' },
  });
  expect(f.rows.filter(r => r.responseId === null).every(r => r.money?.estimatedAmount === null)).toBe(true);
  expect(f.rows.at(-1)?.actualCostUsd).toBeNull();
});

it('keeps independent observed STT evidence for socket replacement and retains usage when the event queue fills', async () => {
  const f = ledger(); const h = harness();
  const adapter = new NovaSttAdapter(config(), h.factory, f.accounting);
  const first = await adapter.connect(input('dictation'));
  await first.writeAudio(new Uint8Array(2560));
  // No consumer: the normal event queue reaches its bounded ceiling and fails the socket.
  for (let i = 0; i <= 256; i++) h.sockets[0].json(novaResult(`fixture-${i}`, false, i));
  await first.close();
  const second = await adapter.connect(input('dictation'));
  await second.writeAudio(new Uint8Array(2560)); await second.close();
  const terminal = f.rows.filter(r => r.status !== 'pending');
  expect(terminal.map(r => r.status)).toEqual(['failed', 'closed']);
  expect(new Set(terminal.map(r => r.usageId)).size).toBe(2);
  expect(terminal.every(r => r.providerRequestId === null && r.observedAudioMs === 80
    && r.audioMs === null && r.estimatedCostUsd === null)).toBe(true);
});

it('preserves provider-reported interruption accounting even when the playback cursor is invalid', async () => {
  const f = ledger(); const h = harness(connected);
  const connection = await new FluxTtsAdapter(config(), h.factory, f.accounting).connect(output());
  const ref = { turnId: 'turn-1', responseId: 'response-1' };
  await connection.speak({ ...ref, text: 'Hello world.' });
  h.sockets[0].json({ type: 'SpeechStarted', speech_id: 'speech-1' });
  h.sockets[0].binary(new Uint8Array(4800));
  await connection.interrupt({ ...ref, providerSocketId: connection.providerSocketId, playbackPositionMs: 50 });
  h.sockets[0].json({ type: 'SpeechInterrupted', audio_played_ms: -1, metadata: metadata('speech-1') });
  await connection.close();
  expect(f.rows.find(r => r.status === 'interrupted')).toMatchObject({ responseId: ref.responseId,
    providerRequestId: 'fixture-request', speechId: 'speech-1', audioMs: 100, billableCharacters: 12,
    actualCostUsd: null });
  expect(f.rows.find(r => r.status === 'interrupted')?.estimatedCostUsd).toBeCloseTo(0.00018, 8);
});

it('does not lose provider billing evidence when the TTS event queue is full', async () => {
  const f = ledger(); const h = harness(connected);
  const connection = await new FluxTtsAdapter(config(), h.factory, f.accounting).connect(output());
  // Tiny PCM is now coalesced. Fill bounded control slots with completed provider
  // turns instead; this deliberately non-pausing fake tests the hard queue ceiling.
  for (let i = 0; i < 128; i++) {
    const ref = { turnId: `turn-${i}`, responseId: `response-${i}` }, speechId = `speech-${i}`;
    await connection.speak({ ...ref, text: 'Hello' });
    h.sockets[0].json({ type: 'SpeechStarted', speech_id: speechId });
    if (i === 0) h.sockets[0].binary(new Uint8Array(2));
    await connection.flush(ref);
    h.sockets[0].json({ type: 'SpeechMetadata', ...metadata(speechId) });
  }
  await connection.close();
  expect(f.rows.find(r => r.status === 'completed')).toMatchObject({ audioMs: 100, billableCharacters: 12 });
  expect(h.sockets[0].terminated).toBe(true);
});

it('dispatches Speak without blocking on response admission and propagates failed writes through close and drain', async () => {
  const h = harness(connected); const f = ledger(async r => {
    if (r.responseId !== null) throw new Error('response save failed');
  });
  const connection = await new FluxTtsAdapter(config(), h.factory, f.accounting).connect(output());
  await connection.speak({ turnId: 'turn-1', responseId: 'response-1', text: 'Hello' });
  expect(h.sockets[0].controls()).toContainEqual({ type: 'Speak', text: 'Hello' });
  await expect(connection.close()).rejects.toThrow('response save failed');
  const terminal = ledger(async r => { if (r.status !== 'pending') throw new Error('terminal save failed'); });
  const stt = harness();
  const inputConnection = await new NovaSttAdapter(config(), stt.factory, terminal.accounting).connect(input('dictation'));
  await expect(inputConnection.close()).rejects.toThrow('terminal save failed');
  await expect(terminal.accounting.drain()).rejects.toThrow('terminal save failed');
  // The only durable evidence is still pending; failure is not a zero-cost success.
  expect(terminal.rows.map(r => r.status)).toEqual(['pending']);
});

it('dispatches Speak while speech admission is in flight and drains pending writes on close', async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const f = ledger(async r => { if (r.responseId && r.status === 'pending') await waiting; });
  const h = harness(connected);
  const connection = await new FluxTtsAdapter(config(), h.factory, f.accounting).connect(output());
  await connection.speak({ turnId: 'turn-1', responseId: 'response-1', text: 'Hello' });
  expect(h.sockets[0].controls()).toEqual([{ type: 'Speak', text: 'Hello' }]);
  await expect(connection.speak({ turnId: 'turn-2', responseId: 'response-2', text: 'Other' }))
    .rejects.toMatchObject({ fault: { code: 'VOICE_INVALID_STATE' } });
  let closed = false; const closing = connection.close().then(() => { closed = true; });
  await tick(); expect(closed).toBe(false);
  release(); await closing;
  expect(f.rows.find(r => r.responseId && r.status === 'failed')).toBeDefined();
});

it('aborts with unknown billing and stable pseudonyms distinguish trusted identities', async () => {
  const f = ledger(); const h = harness(); const abort = new AbortController();
  const connection = await new NovaSttAdapter(config(), h.factory, f.accounting).connect(input('dictation', abort.signal));
  abort.abort(); await connection.close();
  expect(f.rows.at(-1)).toMatchObject({ status: 'cancelled', audioMs: null, estimatedCostUsd: null });
  const other = new VoiceAccounting({ userId: 'other-server-user', voiceSessionId: 'voice-2',
    conversationId: () => null, config: config(), write: async () => undefined });
  expect(other.tag).not.toBe(f.accounting.tag);
  expect(new VoiceAccounting({ userId: 'private-dev-identity', voiceSessionId: 'voice-3',
    conversationId: () => null, config: config(), write: async () => undefined }).tag).toBe(f.accounting.tag);
});

it('keeps admitted TTS rates after the static source is mutated', async () => {
  const rows: VoiceAccountingRecord[] = [];
  const cfg = config(); cfg.rates.fluxTtsPerThousandCharsUsd = 0.015;
  const accounting = new VoiceAccounting({ userId: 'private-dev-identity', voiceSessionId: 'voice-1',
    conversationId: () => null, config: cfg, write: async record => { rows.push(record); } });
  cfg.rates.fluxTtsPerThousandCharsUsd = 0.030;
  const entry = await accounting.start('socket-1', 'flux-haley-en', { turnId: 'turn-1', responseId: 'response-1' });
  const usage = { providerRequestId: 'req-1', model: 'flux-haley-en', modelVersion: null,
    audioMs: 1000, billableCharacters: 1000 };
  await entry.finish(usage, 'completed');
  await entry.finish(usage, 'completed');
  const terminal = rows.filter(r => r.status === 'completed');
  expect(terminal).toHaveLength(1);
  expect(terminal[0].estimatedCostUsd).toBeCloseTo(0.015, 8);
  expect(terminal[0].actualCostUsd).toBeNull();
  expect(JSON.stringify(rows)).not.toContain('test-secret-not-real');
  expect(JSON.stringify(rows)).not.toContain('configSnapshot');
  const frozen = revisionFixture().port.current()!.voice;
  const dynamic = new VoiceAccounting({ userId: 'private-dev-identity', voiceSessionId: 'voice-2',
    conversationId: () => null, config: frozen, write: async record => { rows.push(record); } });
  const blank = await dynamic.start('socket-2', 'flux-haley-en', { turnId: 'turn-2', responseId: 'response-2' });
  await blank.finish(usage, 'completed');
  expect(rows.at(-1)?.estimatedCostUsd).toBeNull();
});

it('keeps a null-rate ledger unknown after the source later gains rates', async () => {
  const rows: VoiceAccountingRecord[] = [];
  const cfg = config();
  const accounting = new VoiceAccounting({ userId: 'private-dev-identity', voiceSessionId: 'voice-1',
    conversationId: () => null, config: cfg, write: async record => { rows.push(record); } });
  cfg.rates.fluxTtsPerThousandCharsUsd = 0.015;
  const entry = await accounting.start('socket-1', 'flux-haley-en', { turnId: 'turn-1', responseId: 'response-1' });
  await entry.finish({ providerRequestId: 'req-1', model: 'flux-haley-en', modelVersion: null,
    audioMs: 1000, billableCharacters: 1000 }, 'completed');
  expect(rows.at(-1)?.estimatedCostUsd).toBeNull();
  expect(rows.at(-1)?.actualCostUsd).toBeNull();
});
