/**
 * ============================================================================
 * FILE: operations.spec.ts
 * LOCATION: backend/test/voice/usage/operations.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration tests for voice usage, readiness reporting, and shutdown drain.
 *
 * ROLE IN PROJECT:
 *    Validates the interaction between VoiceUsageService and OperationsService.
 *
 * KEY COMPONENTS:
 *    - voice usage and operations integration test suite
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { OperationsService } from '../../../src/operations/operations.service.js';
import { Readiness } from '../../../src/operations/readiness.js';
import { revisionFixture } from '../session/fixtures.js';
import { context, harness } from './fixtures.js';
import { options } from '../../operations/fixtures.js';

describe('voice usage and operations', () => {
  it('records only measured allowlisted pipeline stages with hashed correlation and bounded values', () => {
    const h = harness(), c = context(h.config);
    h.service.observe(c, { stage: 'model-first-output', elapsedMs: 123, turnId: 'private-turn', responseId: 'private-response' });
    h.service.observe(c, { stage: 'flow-error', code: 'TTS_UNAVAILABLE', queueSamples: 50 });
    expect(h.service.snapshot().latency.llm).toMatchObject({ count: 1, p50: 123 });
    expect(h.service.snapshot().latency.stt.count).toBe(0);
    const logs = h.lines.join('\n');
    expect(logs).toContain('model-first-output'); expect(logs).toContain('TTS_UNAVAILABLE');
    expect(logs).not.toContain('private-turn'); expect(logs).not.toContain(c.response.sessionId);
  });
  it('rejects the admission rate limit without a provider call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no probe'));
    try {
      const { service, config, time } = harness({}, 1);
      const lease = await service.admission(context(config, 'dictation', 'voice-session-1'));
      await lease.release();
      await expect(service.admission(context(config, 'dictation', 'voice-session-2')))
        .rejects.toMatchObject({ code: 'VOICE_QUOTA_EXHAUSTED' });
      time.advance(60_000);
      await expect(service.admission(context(config, 'dictation', 'voice-session-3'))).resolves.toBeTruthy();
      expect(service.snapshot().rejected).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it('quota stop does not degrade text readiness or call fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no probe'));
    try {
      const { service, config, time, stops, lines } = harness({
        VOICE_IDENTITY_DAILY_MINUTES: '1', VOICE_GLOBAL_DAILY_MINUTES: '1',
        DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01', DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01',
        DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01',
      });
      const { o, runtime } = options();
      o.config.voice = config;
      o.speechDegraded = () => service.speechStatus().degraded;
      o.voiceSnapshot = () => service.snapshot();
      const dictation = context(config, 'dictation');
      await service.admission(dictation);
      time.advance(60_000);
      expect(stops.map(item => item.reason)).toEqual(['quota']);
      expect(await new Readiness(o).read()).toMatchObject({ acceptReady: true, speech: 'ready', provider: 'unknown' });
      expect(runtime.stopAccepting).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(lines.join('\n')).not.toContain('fixture-secret');
      expect(JSON.stringify(new OperationsService(o).metrics())).not.toContain(dictation.response.sessionId);
    } finally { fetchSpy.mockRestore(); }
  });

  it('speech degrade leaves text admission up and shutdown still refuses an active voice drain', async () => {
    const { service, config } = harness();
    const { o, runtime } = options();
    o.config.voice = config;
    o.speechDegraded = () => service.speechStatus().degraded;
    o.drainVoice = () => service.drain();
    service.degrade();
    expect(service.speechStatus()).toMatchObject({ enabled: true, degraded: true });
    expect(await new Readiness(o).read()).toMatchObject({ live: true, acceptReady: true, speech: 'degraded' });
    expect(runtime.stopAccepting).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    const lease = await service.admission(context(config, 'dictation'));
    o.drainVoice = async () => ({ drained: false, active: 1 });
    expect(await new OperationsService(o).shutdown()).toEqual({ safe: false });
    expect(o.closePersistence).not.toHaveBeenCalled();
    await lease.release();
    const again = options();
    again.o.drainVoice = () => service.drain();
    expect(await new OperationsService(again.o).shutdown()).toEqual({ safe: true });
    expect(service.snapshot().active).toBe(0);
  });

  it('observes current speech status without resetting degradation', () => {
    const r = revisionFixture();
    r.publish(r.make(1, s => { s.voice.enabledModes = { dictation: false, live: false }; }));
    const { service, ports } = harness();
    ports.currentConfig = r.port;
    expect(service.speechStatus()).toMatchObject({ enabled: false, configured: true, degraded: false });
    service.degrade();
    r.publish(r.make(2));
    expect(service.speechStatus()).toMatchObject({ enabled: true, configured: true, degraded: true });
    r.publish({
      ...r.make(3),
      voice: { ...r.make(3).voice, deepgram: { ...r.make(3).voice.deepgram, apiKey: '' } },
    });
    expect(service.speechStatus()).toMatchObject({ enabled: true, configured: false, degraded: true });
  });
});
