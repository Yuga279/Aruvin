/**
 * ============================================================================
 * FILE: quota.spec.ts
 * LOCATION: backend/test/voice/usage/quota.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Test duration limits, idle timeouts, concurrency bounds, and spend caps.
 *
 * ROLE IN PROJECT:
 *    Validates the quota policy enforcement logic in VoiceUsageService.
 *
 * KEY COMPONENTS:
 *    - quota and idle timer test suite
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { VoiceSessionError } from '../../../src/voice/session/voice-session.options.js';
import { context, harness } from './fixtures.js';

const rates = {
  DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01',
  DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01',
  DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01',
};

describe('voice quota clock', () => {
  it('warns before the live cap and hard-stops at 20 minutes', async () => {
    const { service, config, time, warns, stops } = harness();
    const live = context(config, 'live');
    await service.admission(live);
    let seen = 0;
    while (seen < 1_080_000) {
      const step = Math.min(30_000, 1_080_000 - seen);
      time.advance(step);
      seen += step;
      if (seen < 1_080_000) service.noteActivity(live.response.sessionId);
    }
    expect(warns).toEqual([{ sessionId: live.response.sessionId, code: 'VOICE_DURATION_LIMIT' }]);
    expect(stops).toEqual([]);
    while (seen < 1_200_000) {
      const step = Math.min(30_000, 1_200_000 - seen);
      time.advance(step);
      seen += step;
      if (seen < 1_200_000) service.noteActivity(live.response.sessionId);
    }
    expect(stops).toEqual([{ sessionId: live.response.sessionId, reason: 'duration' }]);
  });

  it('warns 30 seconds before the dictation cap and does not idle-stop a pause', async () => {
    const { service, config, time, warns, stops } = harness();
    const dictation = context(config, 'dictation');
    await service.admission(dictation);
    time.advance(90_000);
    expect(warns).toEqual([]);
    expect(stops).toEqual([]);
    time.advance(180_000);
    expect(warns).toEqual([{ sessionId: dictation.response.sessionId, code: 'VOICE_DURATION_LIMIT' }]);
    time.advance(30_000);
    expect(stops).toEqual([{ sessionId: dictation.response.sessionId, reason: 'duration' }]);
  });

  it('keeps the live admission after the old 60 plus 30 second idle exit', async () => {
    const { service, config, time, warns, stops } = harness();
    const live = context(config, 'live');
    const lease = await service.admission(live);
    time.advance(60_000);
    expect(warns).toEqual([{ sessionId: live.response.sessionId, code: 'VOICE_IDLE_TIMEOUT' }]);
    time.advance(120_000);
    expect(stops).toEqual([]);
    expect(service.snapshot().active).toBe(1);
    service.noteActivity(live.response.sessionId, true);
    time.advance(120_000);
    expect(stops).toEqual([]);
    expect(warns).toHaveLength(1);
    await lease.release();
  });

  it('does not treat reconnect as activity', async () => {
    const { service, config, time, warns } = harness();
    const live = context(config, 'live');
    await service.admission(live);
    time.advance(50_000);
    await service.disconnected(live);
    time.advance(10_000);
    expect(warns.map(item => item.code)).toEqual(['VOICE_IDLE_TIMEOUT']);
    expect(service.snapshot().reconnects).toBe(1);
  });

  it('rejects a second concurrent session and a third admission inside one minute', async () => {
    const { service, config, time } = harness({ VOICE_IDENTITY_CONCURRENT: '1' }, 2);
    const first = context(config, 'live', 'voice-session-1');
    const lease = await service.admission(first);
    await expect(service.admission(context(config, 'dictation', 'voice-session-2')))
      .rejects.toBeInstanceOf(VoiceSessionError);
    await lease.release();
    const third = await service.admission(context(config, 'dictation', 'voice-session-3'));
    await expect(service.admission(context(config, 'live', 'voice-session-4')))
      .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
    await third.release();
    time.advance(60_000);
    await expect(service.admission(context(config, 'live', 'voice-session-5'))).resolves.toBeTruthy();
    expect(service.snapshot().rejected).toBe(2);
  });

  it('stops the running session at the remaining daily minute budget and resets on the next UTC day', async () => {
    const { service, config, time, stops } = harness({
      VOICE_IDENTITY_DAILY_MINUTES: '1', VOICE_GLOBAL_DAILY_MINUTES: '1', ...rates,
    });
    const dictation = context(config, 'dictation');
    const lease = await service.admission(dictation);
    time.advance(60_000);
    expect(stops).toEqual([{ sessionId: dictation.response.sessionId, reason: 'quota' }]);
    await lease.release();
    await expect(service.admission(context(config, 'dictation', 'voice-session-same-day')))
      .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
    time.advance(12 * 60 * 60 * 1000);
    await expect(service.admission(context(config, 'dictation', 'voice-session-next'))).resolves.toBeTruthy();
  });

  it('stops when known spend reaches the cap and does not invent a cap from unknown rates', async () => {
    const capped = harness({ VOICE_DAILY_SPEND_USD: '0.01', ...rates });
    const live = context(capped.config, 'live');
    await capped.service.admission(live);
    await capped.service.usage(live, { providerRequestId: 'tts-1', model: 'flux-haley-en',
      modelVersion: null, audioMs: 1000, billableCharacters: 1000 });
    expect(capped.stops).toEqual([{ sessionId: live.response.sessionId, reason: 'quota' }]);
    const unknown = harness();
    const other = context(unknown.config, 'live');
    await unknown.service.admission(other);
    await unknown.service.usage(other, { providerRequestId: 'tts-2', model: 'flux-priya-en',
      modelVersion: null, audioMs: 1000, billableCharacters: 5000 });
    expect(unknown.stops).toEqual([]);
    expect(unknown.service.snapshot().estimatedSpendUsd).toBeNull();
  });

  it('rejects a disabled mode and a drained service before counting a session', async () => {
    const { service, config } = harness({ ENABLE_LIVE_VOICE_MODE: 'false' });
    await expect(service.admission(context(config, 'live'))).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
    service.stopAccepting();
    await expect(service.admission(context(config, 'dictation'))).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
    expect(service.snapshot().sessions).toBe(0);
  });

  it('keeps an exhausted original lease blocked without a fresh admission or clock reset', async () => {
    const h = harness({ VOICE_IDENTITY_DAILY_MINUTES: '1', VOICE_GLOBAL_DAILY_MINUTES: '1', ...rates });
    const live = context(h.config, 'live');
    const lease = await h.service.admission(live);
    h.time.advance(59_999);
    expect(() => lease.assertActive()).not.toThrow();
    await h.service.disconnected(live);
    h.time.advance(1);
    expect(h.stops).toEqual([{ sessionId: live.response.sessionId, reason: 'quota' }]);
    expect(() => lease.assertActive()).toThrowError('VOICE_QUOTA_EXHAUSTED');
    h.time.advance(12 * 60 * 60 * 1000);
    expect(() => lease.assertActive()).toThrowError('VOICE_QUOTA_EXHAUSTED');
    expect(h.service.snapshot().sessions).toBe(1);
    await lease.release();
  });

  it('stops at the known spend lower bound even when a different observation is unknown', async () => {
    const h = harness({ VOICE_DAILY_SPEND_USD: '0.01', ...rates });
    const live = context(h.config);
    await h.service.admission(live);
    await h.service.usage(live, { usageId: 'unknown-stt', providerRequestId: null,
      model: 'flux-general-en', modelVersion: null, audioMs: null, billableCharacters: null });
    await h.service.usage(live, { usageId: 'known-tts', providerRequestId: 'tts-1',
      model: 'flux-haley-en', modelVersion: null, audioMs: 1000, billableCharacters: 1000 });
    expect(h.stops).toEqual([{ sessionId: live.response.sessionId, reason: 'quota' }]);
    expect(h.service.snapshot()).toMatchObject({ spendStatus: 'unknown', estimatedSpendUsd: null });
  });
});
