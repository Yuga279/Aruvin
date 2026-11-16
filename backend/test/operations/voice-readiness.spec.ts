/**
 * ============================================================================
 * FILE: voice-readiness.spec.ts
 * LOCATION: backend/test/operations/voice-readiness.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify speech readiness reporting without paid probes or text chat downtime.
 *
 * ROLE IN PROJECT:
 *    Ensures voice configuration/degradation is reported via the separate speech field.
 *
 * KEY COMPONENTS:
 *    - voice readiness test suite
 * ============================================================================
 */

import { Readiness } from '../../src/operations/readiness.js';
import { loadVoiceConfig } from '../../src/platform/config/voice-config.js';
import { options } from './fixtures.js';

it('reports speech separately and does not take text chat down or call the provider', async () => {
  const previousExit = process.exitCode;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('paid probe'));
  try {
    const off = options();
    off.o.config.voice = loadVoiceConfig({});
    expect(await new Readiness(off.o).read()).toMatchObject({
      live: true, acceptReady: true, provider: 'unknown', speech: 'off',
    });
    const missing = options();
    missing.o.config.voice = loadVoiceConfig({ ENABLE_DICTATION_MODE: 'true' });
    const missingStatus = await new Readiness(missing.o).read();
    expect(missingStatus.acceptReady).toBe(true);
    expect(missingStatus.speech).toBe('unconfigured');
    expect(missingStatus.issues).not.toContain('DEEPGRAM_API_KEY is missing');
    expect(missing.runtime.stopAccepting).not.toHaveBeenCalled();
    const { o, runtime } = options();
    o.config.voice = loadVoiceConfig({ ENABLE_LIVE_VOICE_MODE: 'true', DEEPGRAM_API_KEY: 'fixture-secret',
      LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'offline-fixture-livekit-secret-not-real' });
    o.speechDegraded = () => true;
    const degraded = await new Readiness(o).read();
    expect(degraded).toMatchObject({ live: true, acceptReady: true, provider: 'unknown', speech: 'degraded' });
    expect(runtime.stopAccepting).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExit);
  } finally { fetchSpy.mockRestore(); }
});

it('reports missing LiveKit as unconfigured without denying configured text', async () => {
  const f = options();
  f.o.config.voice = loadVoiceConfig({ ENABLE_DICTATION_MODE: 'true',
    ENABLE_LIVE_VOICE_MODE: 'true', DEEPGRAM_API_KEY: 'offline-speech' });
  const result = await new Readiness(f.o).read();
  expect(result).toMatchObject({ live: true, acceptReady: true, speech: 'unconfigured' });
  expect(result.issues).toEqual([]);
  expect(f.runtime.stopAccepting).not.toHaveBeenCalled();
});
