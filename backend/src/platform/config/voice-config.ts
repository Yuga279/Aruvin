/**
 * ============================================================================
 * FILE: voice-config.ts
 * LOCATION: backend/src/platform/config/voice-config.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Parse, validate, and project server-side voice configuration and limits.
 *
 * ROLE IN PROJECT:
 *    Legacy fixture/import adapter for existing callers until P6 cutover.
 *    Not a live-config port or env overlay onto stored voice settings.
 *
 * KEY COMPONENTS:
 *    - VoiceConfig: Strongly-typed server speech configuration
 *    - loadVoiceConfig: Strict environment parser with boundary constraints
 *    - publicVoiceConfig: Redacted client-safe projection without secrets
 *    - voiceReadinessIssues: Health-check diagnostic evaluator
 * ============================================================================
 */

import { z } from 'zod';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, isVoiceLimits,
  isLiveKitSignalingUrl, type VoiceLimits, type PublicVoiceConfig } from '../../contracts/voice-wire.js';
import type { LiveKitConfig, VoiceConfig } from '../../contracts/config-runtime.js';

export type { LiveKitConfig, VoiceConfig };

const DEV_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function parseLiveKitConfig(
  env: Record<string, string | undefined>,
  nodeEnv: 'development' | 'test' | 'production' = 'development',
): LiveKitConfig | null {
  const url = env.LIVEKIT_URL ?? '';
  const apiKey = env.LIVEKIT_API_KEY ?? '';
  const apiSecret = env.LIVEKIT_API_SECRET ?? '';
  if (url === '' && apiKey === '' && apiSecret === '') return null;
  if (url === '' || apiKey === '' || apiSecret === '') {
    throw new Error('partial_livekit_config');
  }
  if (!isLiveKitSignalingUrl(url)) {
    throw new Error('invalid_livekit_url');
  }
  const parsed = new URL(url);
  if (
    parsed.protocol === 'ws:' &&
    (nodeEnv === 'production' || !DEV_LOOPBACK_HOSTS.has(parsed.hostname))
  ) {
    throw new Error('insecure_livekit_url');
  }
  if (
    apiKey !== apiKey.trim() ||
    apiKey.length < 3 ||
    apiKey.length > 128 ||
    /[\u0000-\u0020\u007f]/u.test(apiKey)
  ) {
    throw new Error('invalid_livekit_key');
  }
  if (
    apiSecret !== apiSecret.trim() ||
    apiSecret.length < 8 ||
    apiSecret.length > 256 ||
    /[\u0000-\u0020\u007f]/u.test(apiSecret)
  ) {
    throw new Error('invalid_livekit_secret');
  }
  return { url, apiKey, apiSecret };
}

export function isLiveKitConfigured(
  livekit: LiveKitConfig | null | undefined,
): livekit is LiveKitConfig {
  return Boolean(livekit?.url && livekit.apiKey && livekit.apiSecret);
}

export function effectiveVoiceModes(config: VoiceConfig): {
  dictation: boolean;
  live: boolean;
} {
  const hasDeepgram = Boolean(config.deepgram.apiKey);
  const hasLiveKit = config.livekit === undefined ? true : isLiveKitConfigured(config.livekit);
  return {
    dictation: Boolean(config.enabledModes.dictation && hasDeepgram),
    live: Boolean(config.enabledModes.live && hasDeepgram && hasLiveKit),
  };
}

const positive = z.coerce.number().int().positive().max(0xffffffff);
const flag = z.enum(['true', 'false']).default('false').transform(v => v === 'true');
const rate = z.preprocess(v => v === '' || v === undefined ? null : v,
  z.coerce.number().finite().nonnegative().nullable());
const spend = z.preprocess(v => v === '' || v === undefined ? null : v,
  z.coerce.number().finite().positive().nullable());
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEEPGRAM_API_KEY: z.string().max(4096).default(''),
  ENABLE_DICTATION_MODE: flag, ENABLE_LIVE_VOICE_MODE: flag,
  DEEPGRAM_API_BASE: z.enum(['wss://api.deepgram.com', 'wss://api.eu.deepgram.com']).default('wss://api.deepgram.com'),
  DEEPGRAM_DICTATION_MODEL: z.literal('nova-3').default('nova-3'),
  DEEPGRAM_LIVE_MODEL: z.literal('flux-general-en').default('flux-general-en'),
  DEEPGRAM_TTS_MODEL: z.enum(['flux-haley-en', 'flux-alexis-en', 'flux-priya-en']).default('flux-haley-en'),
  DEEPGRAM_DICTATION_ENDPOINTING_MS: positive.min(300).max(500).default(300),
  DEEPGRAM_SPOKEN_PUNCTUATION: flag,
  DEEPGRAM_KEYTERMS: z.string().max(3300).default(''),
  DEEPGRAM_FLUX_EOT_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.8),
  DEEPGRAM_FLUX_EOT_TIMEOUT_MS: positive.default(5000),
  VOICE_DICTATION_MAX_MS: positive.default(DEFAULT_VOICE_LIMITS.dictationMaxMs),
  VOICE_LIVE_MAX_MS: positive.default(DEFAULT_VOICE_LIMITS.liveMaxMs),
  VOICE_LIVE_WARNING_MS: positive.default(DEFAULT_VOICE_LIMITS.liveWarningMs),
  VOICE_IDLE_WARNING_MS: positive.default(DEFAULT_VOICE_LIMITS.idleWarningMs),
  VOICE_IDLE_EXIT_AFTER_WARNING_MS: positive.default(DEFAULT_VOICE_LIMITS.idleExitAfterWarningMs),
  VOICE_FINALIZATION_MS: positive.default(DEFAULT_VOICE_LIMITS.finalizationMs),
  VOICE_RECONNECT_MS: positive.default(DEFAULT_VOICE_LIMITS.reconnectMs),
  VOICE_CONNECT_MS: positive.default(DEFAULT_VOICE_LIMITS.connectMs),
  VOICE_INPUT_QUEUE_MS: positive.default(DEFAULT_VOICE_LIMITS.inputQueueMs),
  VOICE_OUTPUT_QUEUE_MS: positive.default(DEFAULT_VOICE_LIMITS.outputQueueMs),
  VOICE_IDENTITY_CONCURRENT: positive.default(1), VOICE_GLOBAL_CONCURRENT: positive.default(4),
  VOICE_IDENTITY_DAILY_MINUTES: positive.default(60), VOICE_GLOBAL_DAILY_MINUTES: positive.default(120),
  VOICE_DAILY_SPEND_USD: spend,
  DEEPGRAM_NOVA_RATE_PER_MIN_USD: rate, DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: rate,
  DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD: rate,
}).passthrough();
export function loadVoiceConfig(env: Record<string, string | undefined>): VoiceConfig {
  try {
    const e = envSchema.parse(env);
    const limits: VoiceLimits = {
      dictationMaxMs: e.VOICE_DICTATION_MAX_MS, liveMaxMs: e.VOICE_LIVE_MAX_MS,
      liveWarningMs: e.VOICE_LIVE_WARNING_MS, idleWarningMs: e.VOICE_IDLE_WARNING_MS,
      idleExitAfterWarningMs: e.VOICE_IDLE_EXIT_AFTER_WARNING_MS,
      finalizationMs: e.VOICE_FINALIZATION_MS, reconnectMs: e.VOICE_RECONNECT_MS,
      connectMs: e.VOICE_CONNECT_MS, inputQueueMs: e.VOICE_INPUT_QUEUE_MS,
      outputQueueMs: e.VOICE_OUTPUT_QUEUE_MS,
    };
    const keyterms = e.DEEPGRAM_KEYTERMS.split(',').map(v => v.trim()).filter(Boolean);
    if (!isVoiceLimits(limits) || keyterms.length > 50 || keyterms.some(v => v.length > 64) ||
      e.VOICE_IDENTITY_CONCURRENT > e.VOICE_GLOBAL_CONCURRENT ||
      e.VOICE_IDENTITY_DAILY_MINUTES > e.VOICE_GLOBAL_DAILY_MINUTES) throw new Error('bounds');
    const rates = { novaPerMinuteUsd: e.DEEPGRAM_NOVA_RATE_PER_MIN_USD,
      fluxSttPerMinuteUsd: e.DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD,
      fluxTtsPerThousandCharsUsd: e.DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD };
    if (e.VOICE_DAILY_SPEND_USD !== null && Object.values(rates).some(v => v === null))
      throw new Error('spend_requires_rates');
    const livekit = parseLiveKitConfig(env, e.NODE_ENV);
    return { enabledModes: { dictation: e.ENABLE_DICTATION_MODE, live: e.ENABLE_LIVE_VOICE_MODE }, limits,
      deepgram: { apiKey: e.DEEPGRAM_API_KEY, apiBase: e.DEEPGRAM_API_BASE,
        dictationModel: e.DEEPGRAM_DICTATION_MODEL, liveModel: e.DEEPGRAM_LIVE_MODEL,
        ttsModel: e.DEEPGRAM_TTS_MODEL, endpointingMs: e.DEEPGRAM_DICTATION_ENDPOINTING_MS,
        spokenPunctuation: e.DEEPGRAM_SPOKEN_PUNCTUATION, keyterms,
        eotThreshold: e.DEEPGRAM_FLUX_EOT_THRESHOLD, eotTimeoutMs: e.DEEPGRAM_FLUX_EOT_TIMEOUT_MS },
      livekit,
      quotas: { identityConcurrent: e.VOICE_IDENTITY_CONCURRENT, globalConcurrent: e.VOICE_GLOBAL_CONCURRENT,
        identityDailyMinutes: e.VOICE_IDENTITY_DAILY_MINUTES, globalDailyMinutes: e.VOICE_GLOBAL_DAILY_MINUTES,
        dailySpendUsd: e.VOICE_DAILY_SPEND_USD }, rates };
  } catch { throw new Error('Invalid voice configuration.'); }
}
export function publicVoiceConfig(config: VoiceConfig): PublicVoiceConfig {
  const liveReady = config.livekit === undefined ? true : isLiveKitConfigured(config.livekit);
  return {
    protocolVersion: 1,
    enabledModes: {
      dictation: config.enabledModes.dictation,
      live: Boolean(config.enabledModes.live && liveReady),
    },
    supportedLocales: ['en-US'],
    limits: { ...config.limits },
    inputAudio: { ...INPUT_AUDIO },
    outputAudio: { ...OUTPUT_AUDIO },
  };
}
export function voiceReadinessIssues(config: VoiceConfig): string[] {
  return (config.enabledModes.dictation || config.enabledModes.live) && !config.deepgram.apiKey
    ? ['DEEPGRAM_API_KEY is missing'] : [];
}
