/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/voice/usage/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Supply deterministic mock clock and session harness for voice usage tests.
 *
 * ROLE IN PROJECT:
 *    Provides fake time advance and port capture without real timers or network.
 *
 * KEY COMPONENTS:
 *    - clock: Deterministic fake timer
 *    - context: Valid SessionContext generator
 *    - harness: Configured VoiceUsageService test fixture
 * ============================================================================
 */

import { INPUT_AUDIO, OUTPUT_AUDIO } from '../../../src/contracts/voice-wire.js';
import { livekitConfigFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { loadVoiceConfig, type VoiceConfig } from '../../../src/platform/config/voice-config.js';
import type { SessionContext } from '../../../src/voice/session/voice-session.options.js';
import { VoiceUsageService, type VoiceUsagePorts } from '../../../src/voice/usage/voice-usage.service.js';

export function clock() {
  let now = Date.parse('2026-10-08T12:00:00.000Z');
  const jobs: { at: number; fn: () => void }[] = [];
  return {
    now: () => now,
    schedule(ms: number, fn: () => void) {
      const job = { at: now + ms, fn };
      jobs.push(job);
      return () => { const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1); };
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const next = jobs.filter(job => job.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        jobs.splice(jobs.indexOf(next), 1);
        now = next.at;
        next.fn();
      }
      now = target;
    },
  };
}

export function context(config: VoiceConfig, mode: 'dictation' | 'live' = 'live',
  sessionId = 'voice-session-1', userId = 'aurvin-dev-user'): SessionContext {
  return {
    identity: { userId, source: 'authenticated-session', openRouterUser: userId },
    reservation: null,
    response: {
      protocolVersion: 1, sessionId, conversationId: null, mode, connectionEpoch: 0,
      websocketUrl: '/api/voice', expiresAt: '2026-10-08T12:00:10.000Z',
      effectiveAudioSettings: { input: { ...INPUT_AUDIO }, output: mode === 'live' ? { ...OUTPUT_AUDIO } : null },
      limits: { ...config.limits },
    },
    voiceConfig: { ...structuredClone(config), dictationWarningMs: Math.max(0, config.limits.dictationMaxMs - 30_000) || null },
    configSnapshot: null,
  };
}

export function harness(env: Record<string, string | undefined> = {}, admissionPerMinute = 20) {
  const time = clock();
  const stops: { sessionId: string; reason: string }[] = [];
  const warns: { sessionId: string; code: string }[] = [];
  const lines: string[] = [];
  const livekit = livekitConfigFixture();
  const config = loadVoiceConfig({
    ENABLE_DICTATION_MODE: 'true', ENABLE_LIVE_VOICE_MODE: 'true',
    DEEPGRAM_API_KEY: 'fixture-secret',
    LIVEKIT_URL: livekit.url, LIVEKIT_API_KEY: livekit.apiKey, LIVEKIT_API_SECRET: livekit.apiSecret,
    ...env,
  });
  const ports: VoiceUsagePorts = {
    config, now: time.now, schedule: time.schedule, admissionPerMinute,
    stop: async (sessionId, reason) => { stops.push({ sessionId, reason }); },
    warn: (sessionId, code) => { warns.push({ sessionId, code }); },
    writeLog: line => { lines.push(line); },
  };
  return { time, stops, warns, lines, config, ports, service: new VoiceUsageService(ports) };
}
