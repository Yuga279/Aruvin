/**
 * ============================================================================
 * FILE: attribution.spec.ts
 * LOCATION: backend/test/voice/usage/attribution.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify speech usage attribution, idempotency, spend calculations, and token stats.
 *
 * ROLE IN PROJECT:
 *    Validates the VoiceUsageService metric snapshot and telemetry sanitization.
 *
 * KEY COMPONENTS:
 *    - attribution test suite
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { LATENCY_SEGMENTS } from '../../../src/voice/usage/voice-usage.service.js';
import { context, harness } from './fixtures.js';

describe('voice usage attribution', () => {
  it('separates sockets without request IDs and identical speeches by stable usage identity', async () => {
    const { service, config } = harness(); const live = context(config);
    await service.admission(live);
    for (const usageId of ['socket-1', 'socket-2']) await service.usage(live, {
      usageId, providerRequestId: null, model: 'flux-general-en', modelVersion: null,
      audioMs: 80, billableCharacters: null,
    });
    for (const usageId of ['speech-1', 'speech-2', 'speech-2']) await service.usage(live, {
      usageId, providerRequestId: null, model: 'flux-haley-en', modelVersion: null,
      audioMs: 100, billableCharacters: 12,
    });
    expect(service.snapshot()).toMatchObject({ sttAudioMs: 160, ttsAudioMs: 200, ttsCharacters: 24 });
  });
  it('replaces cumulative STT snapshots and adds distinct TTS speeches once', async () => {
    const { service, config } = harness({
      DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.006',
      DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.006',
      DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.015',
    });
    const live = context(config, 'live');
    const lease = await service.admission(live);
    await service.usage(live, { providerRequestId: 'socket-stt', model: 'flux-general-en',
      modelVersion: null, audioMs: 1000, billableCharacters: null });
    await service.usage(live, { providerRequestId: 'socket-stt', model: 'flux-general-en',
      modelVersion: null, audioMs: 2500, billableCharacters: null });
    await service.usage(live, { providerRequestId: 'socket-stt', model: 'flux-general-en',
      modelVersion: null, audioMs: 2000, billableCharacters: null });
    await service.usage(live, { providerRequestId: 'socket-tts', model: 'flux-haley-en',
      modelVersion: 'v1', audioMs: 800, billableCharacters: 200 });
    await service.usage(live, { providerRequestId: 'socket-tts', model: 'flux-haley-en',
      modelVersion: 'v1', audioMs: 800, billableCharacters: 200 });
    await service.usage(live, { providerRequestId: 'socket-tts', model: 'flux-haley-en',
      modelVersion: 'v1', audioMs: 400, billableCharacters: 40 });
    await lease.release();
    const snap = service.snapshot();
    expect(snap.sttAudioMs).toBe(2500);
    expect(snap.ttsAudioMs).toBe(1200);
    expect(snap.ttsCharacters).toBe(240);
    expect(snap.charactersComplete).toBe(true);
    expect(snap.audioComplete).toBe(true);
    expect(snap.spendStatus).toBe('known');
    expect(snap.estimatedSpendUsd).toBeCloseTo((2500 / 60000) * 0.006 + (240 / 1000) * 0.015, 8);
  });

  it('keeps missing rates and null measurements unknown instead of zero', async () => {
    const { service, config, lines } = harness();
    const dictation = context(config, 'dictation', 'voice-session-2');
    await service.admission(dictation);
    await service.usage(dictation, { providerRequestId: null, model: 'nova-3',
      modelVersion: null, audioMs: null, billableCharacters: null });
    const snap = service.snapshot();
    expect(snap.spendStatus).toBe('unknown');
    expect(snap.estimatedSpendUsd).toBeNull();
    expect(snap.audioComplete).toBe(false);
    expect(snap.sttAudioMs).toBe(0);
    const text = lines.join('\n');
    expect(text).not.toContain('fixture-secret');
    expect(text).not.toContain('voice-session-2');
    expect(text).not.toContain('transcript');
    expect(text).toContain('"kind":"voice-usage"');
  });

  it('attributes tokens once per attempt and leaves incomplete tokens null', async () => {
    const { service, config } = harness();
    const live = context(config);
    await service.admission(live);
    service.noteModelUsage(live.response.sessionId, { attemptId: 'attempt-1', promptTokens: 3, completionTokens: 5 });
    service.noteModelUsage(live.response.sessionId, { attemptId: 'attempt-1', promptTokens: 3, completionTokens: 5 });
    expect(service.snapshot()).toMatchObject({ promptTokens: 3, completionTokens: 5 });
    service.noteModelUsage(live.response.sessionId, { attemptId: 'attempt-2', promptTokens: 2, completionTokens: 2 });
    expect(service.snapshot()).toMatchObject({ promptTokens: 5, completionTokens: 7 });
    service.noteModelUsage(live.response.sessionId, { attemptId: 'attempt-3', promptTokens: null, completionTokens: 1 });
    expect(service.snapshot().promptTokens).toBeNull();
    expect(service.snapshot().completionTokens).toBeNull();
  });

  it('reports p50 and p95 per segment and null for an empty segment', () => {
    const { service } = harness();
    for (let value = 10; value <= 1000; value += 10) service.noteLatency('stt', value);
    expect(service.snapshot().latency.stt).toEqual({ count: 100, p50: 500, p95: 950 });
    expect(service.snapshot().latency.tool).toEqual({ count: 0, p50: null, p95: null });
    expect(service.snapshot().latency.turn.p50).toBeNull();
    service.noteLatency('llm', Number.NaN);
    service.noteLatency('llm', -1);
    expect(service.snapshot().latency.llm.count).toBe(0);
    expect(Object.keys(service.snapshot().latency)).toEqual([...LATENCY_SEGMENTS]);
  });

  it('still attributes a usage snapshot that arrives after release', async () => {
    const { service, config } = harness({
      DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.006',
      DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.006',
      DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.015',
    });
    const dictation = context(config, 'dictation');
    const lease = await service.admission(dictation);
    await lease.release();
    await service.usage(dictation, { providerRequestId: 'nova-socket', model: 'nova-3',
      modelVersion: null, audioMs: 60000, billableCharacters: null });
    expect(service.snapshot().sttAudioMs).toBe(60000);
    expect(service.snapshot().active).toBe(0);
  });

  it('does not price an open quiet call as final usage or elapsed time as uploaded media', async () => {
    const h = harness({ DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01',
      DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01', DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01' });
    const live = context(h.config, 'live');
    const lease = await h.service.admission(live);
    await h.service.usage(live, { usageId: 'media-1', providerRequestId: 'request-1',
      model: 'flux-general-en', modelVersion: null, audioMs: 80, billableCharacters: null });
    h.time.advance(180_000);
    expect(h.service.snapshot()).toMatchObject({ sttAudioMs: 80,
      estimatedSpendUsd: null, spendStatus: 'unknown', active: 1 });
    await lease.release();
    expect(h.service.snapshot().estimatedSpendUsd).toBeCloseTo(80 / 60_000 * 0.01, 8);
    expect(h.service.snapshot().spendStatus).toBe('known');
    // A fresh service proves the deliberately process-local, non-restart-durable ceiling.
    expect(harness().service.snapshot().sessions).toBe(0);
  });

  it('retains unknown usage after a provider failure even when its admission is released', async () => {
    const h = harness({ DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01',
      DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01', DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01' });
    const live = context(h.config);
    const lease = await h.service.admission(live);
    h.service.observe(live, { stage: 'flow-error', code: 'STT_UNAVAILABLE' });
    await lease.release();
    expect(h.service.snapshot()).toMatchObject({ estimatedSpendUsd: null, spendStatus: 'unknown',
      audioComplete: false, charactersComplete: false });
  });
});
