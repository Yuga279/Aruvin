/**
 * ============================================================================
 * FILE: voice-config.spec.ts
 * LOCATION: backend/src/platform/config/voice-config.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for server voice configuration parsing, limits, quotas, and redaction.
 *
 * ROLE IN PROJECT:
 *    Ensures that speech options are strictly validated, default-off, bounded by
 *    finite limits, and sanitized without leaking secrets to public projections.
 *
 * KEY COMPONENTS:
 *    - Defaults and finite budget verification
 *    - Strict environment variable parsing and cross-field constraints
 *    - Public projection sanitization and credential secrecy
 *    - Non-degraded text readiness checks
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_LIMITS, isPublicVoiceConfig } from '../../contracts/voice-wire.js';
import { loadConfig, readinessIssues } from './load-config.js';
import {
  effectiveVoiceModes,
  isLiveKitConfigured,
  loadVoiceConfig,
  parseLiveKitConfig,
  publicVoiceConfig,
  voiceReadinessIssues,
} from './voice-config.js';

describe('voice config', () => {
  it('defaults off with explicit finite budgets and unknown rates', () => {
    const v = loadVoiceConfig({});
    expect(v.enabledModes).toEqual({ dictation: false, live: false });
    expect(v.limits).toEqual(DEFAULT_VOICE_LIMITS);
    expect(v.quotas).toEqual({ identityConcurrent: 1, globalConcurrent: 4,
      identityDailyMinutes: 60, globalDailyMinutes: 120, dailySpendUsd: null });
    expect(v.rates).toEqual({ novaPerMinuteUsd: null, fluxSttPerMinuteUsd: null,
      fluxTtsPerThousandCharsUsd: null });
    expect(v.deepgram.dictationModel).toBe('nova-3');
    expect(v.deepgram.liveModel).toBe('flux-general-en');
    expect(v.deepgram.ttsModel).toBe('flux-haley-en');
    expect(v.deepgram.spokenPunctuation).toBe(false);
  });
  it('strictly parses flags, overrides and cross-field limits', () => {
    expect(loadVoiceConfig({ ENABLE_DICTATION_MODE: 'true', VOICE_DICTATION_MAX_MS: '10000' }).limits.dictationMaxMs).toBe(10000);
    expect(loadVoiceConfig({ ENABLE_LIVE_VOICE_MODE: 'true', DEEPGRAM_TTS_MODEL: 'flux-priya-en' }).enabledModes.live).toBe(true);
    for (const env of [
      { ENABLE_DICTATION_MODE: 'yes' }, { ENABLE_LIVE_VOICE_MODE: '1' },
      { VOICE_INPUT_QUEUE_MS: '0' }, { VOICE_OUTPUT_QUEUE_MS: 'Infinity' },
      { VOICE_RECONNECT_MS: '-1' }, { VOICE_FINALIZATION_MS: '1.5' },
      { VOICE_LIVE_MAX_MS: '1080000' }, { VOICE_DICTATION_MAX_MS: '1000' },
      { DEEPGRAM_API_BASE: 'http://api.deepgram.com' },
      { DEEPGRAM_API_BASE: 'wss://user:secret@api.deepgram.com' },
      { DEEPGRAM_API_BASE: 'wss://example.com' }, { DEEPGRAM_LIVE_MODEL: 'flux-general-multi' },
      { DEEPGRAM_TTS_MODEL: 'aura-2-thalia-en' }, { DEEPGRAM_DICTATION_ENDPOINTING_MS: '501' },
      { VOICE_IDENTITY_CONCURRENT: '5', VOICE_GLOBAL_CONCURRENT: '4' },
      { VOICE_DAILY_SPEND_USD: '1' },
    ]) expect(() => loadVoiceConfig(env)).toThrow('Invalid voice configuration.');
    expect(loadVoiceConfig({ VOICE_DAILY_SPEND_USD: '1', DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0.01',
      DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '0.01', DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: '0.01' }).quotas.dailySpendUsd).toBe(1);
  });
  it('projects only safe public settings and does not degrade text readiness', () => {
    const config = loadConfig({ OPENROUTER_API_KEY: 'fixture-openrouter',
      OPENROUTER_MODEL: 'fixture-model', MONGODB_URI: 'mongodb://localhost:27017',
      DEEPGRAM_API_KEY: 'fixture-deepgram', ENABLE_DICTATION_MODE: 'true' });
    const pub = publicVoiceConfig(config.voice);
    expect(isPublicVoiceConfig(pub)).toBe(true);
    expect(Object.keys(pub).sort()).toEqual(['enabledModes', 'inputAudio', 'limits',
      'outputAudio', 'protocolVersion', 'supportedLocales']);
    const serialized = JSON.stringify(pub);
    for (const privateValue of ['fixture-deepgram', 'fixture-openrouter', 'aurvin-dev-user',
      'nova-3', 'flux-general-en', 'api.deepgram.com', 'rates', 'quotas']) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(readinessIssues(config)).toEqual([]);
    expect(voiceReadinessIssues(loadVoiceConfig({}))).toEqual([]);
    expect(voiceReadinessIssues(loadVoiceConfig({ ENABLE_LIVE_VOICE_MODE: 'true' })))
      .toEqual(['DEEPGRAM_API_KEY is missing']);
  });
  it('sanitizes configuration failures without echoing credentials', () => {
    expect(() => loadConfig({ DEEPGRAM_API_KEY: 'fixture-secret', ENABLE_LIVE_VOICE_MODE: 'oops' }))
      .toThrow('Invalid application configuration.');
  });
  it('validates LiveKit env settings, fails closed on partial/malformed values, and gates public live capability without disabling dictation', () => {
    const unconfigured = loadVoiceConfig({
      ENABLE_DICTATION_MODE: 'true',
      ENABLE_LIVE_VOICE_MODE: 'true',
      DEEPGRAM_API_KEY: 'fixture-deepgram',
    });
    expect(unconfigured.livekit).toBeNull();
    expect(isLiveKitConfigured(unconfigured.livekit)).toBe(false);
    expect(effectiveVoiceModes(unconfigured)).toEqual({ dictation: true, live: false });
    expect(publicVoiceConfig(unconfigured).enabledModes).toEqual({ dictation: true, live: false });

    const configured = loadVoiceConfig({
      ENABLE_DICTATION_MODE: 'true',
      ENABLE_LIVE_VOICE_MODE: 'true',
      DEEPGRAM_API_KEY: 'fixture-deepgram',
      LIVEKIT_URL: 'wss://livekit.example.com',
      LIVEKIT_API_KEY: 'APIKey123',
      LIVEKIT_API_SECRET: 'secret-value-123456',
    });
    expect(configured.livekit).toEqual({
      url: 'wss://livekit.example.com',
      apiKey: 'APIKey123',
      apiSecret: 'secret-value-123456',
    });
    expect(isLiveKitConfigured(configured.livekit)).toBe(true);
    expect(effectiveVoiceModes(configured)).toEqual({ dictation: true, live: true });
    const pub = publicVoiceConfig(configured);
    expect(pub.enabledModes).toEqual({ dictation: true, live: true });
    const serialized = JSON.stringify(pub);
    for (const secret of ['livekit.example.com', 'APIKey123', 'secret-value-123456']) {
      expect(serialized).not.toContain(secret);
    }

    for (const badEnv of [
      { LIVEKIT_URL: 'wss://livekit.example.com' },
      { LIVEKIT_API_KEY: 'APIKey123', LIVEKIT_API_SECRET: 'secret-value-123456' },
      { LIVEKIT_URL: 'wss://livekit.example.com', LIVEKIT_API_KEY: 'APIKey123' },
      {
        LIVEKIT_URL: 'https://livekit.example.com',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'ws://livekit.example.com',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        NODE_ENV: 'production',
        LIVEKIT_URL: 'ws://127.0.0.1:7880',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'wss://user:pass@livekit.example.com',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'wss://livekit.example.com/path',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'wss://livekit.example.com/',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'ws://127.0.0.1:7880',
        LIVEKIT_API_KEY: 'ab',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
      {
        LIVEKIT_URL: 'ws://127.0.0.1:7880',
        LIVEKIT_API_KEY: 'APIKey123',
        LIVEKIT_API_SECRET: 'short',
      },
      {
        LIVEKIT_URL: 'ws://127.0.0.1:7880',
        LIVEKIT_API_KEY: ' APIKey123 ',
        LIVEKIT_API_SECRET: 'secret-value-123456',
      },
    ]) {
      expect(() => loadVoiceConfig(badEnv)).toThrow('Invalid voice configuration.');
    }
    expect(parseLiveKitConfig({
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'secret-value-123456',
    }, 'development')?.url).toBe('ws://127.0.0.1:7880');
  });
});
