/**
 * ============================================================================
 * FILE: legacy-config-import.ts
 * LOCATION: backend/src/platform/config/legacy-config-import.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Project explicit legacy environment values into manageable settings.
 *
 * ROLE IN PROJECT:
 *    Prepares a one-time import candidate for P6 without contacting providers,
 *    writing storage, or overlaying environment onto a live runtime.
 *
 * KEY COMPONENTS:
 *    - parseLegacyConfigImport: Filter, map, and validate known manageable names.
 * ============================================================================
 */

import { MAX_CREDENTIAL_BYTES } from '../../contracts/admin-config-wire.js';
import type { DecryptedCredentials } from '../../contracts/config-runtime.js';
import type { ManageableSettings } from '../../contracts/admin-config-wire.js';
import { AppError } from '../errors/app-error.js';
import { LEGACY_MANAGEABLE_ENV_NAMES, type BootstrapConfig } from './bootstrap-config.js';
import { loadConfig } from './load-config.js';
import { loadVoiceConfig } from './voice-config.js';
import { defaultManageableSettings, validateManageableSettings } from './manageable-config.js';

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const utf8 = new TextEncoder();

function invalidConfig(): never {
  throw new AppError(
    'CONFIGURATION_ERROR',
    'Invalid application configuration.',
  );
}

function presentCredential(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  if (
    value.trim() !== value ||
    CONTROL_CHARS.test(value) ||
    value.length > MAX_CREDENTIAL_BYTES ||
    utf8.encode(value).length > MAX_CREDENTIAL_BYTES
  ) {
    invalidConfig();
  }
  return value;
}

export function parseLegacyConfigImport(
  env: Record<string, string | undefined>,
  bootstrap: BootstrapConfig,
): {
  settings: ManageableSettings;
  credentials: DecryptedCredentials;
  importedNames: string[];
} {
  try {
    const filtered: Record<string, string | undefined> = {};
    for (const name of LEGACY_MANAGEABLE_ENV_NAMES) {
      if (Object.hasOwn(env, name) && env[name] !== undefined) filtered[name] = env[name];
    }
    if (
      filtered.OPENROUTER_DATA_COLLECTION !== undefined &&
      filtered.OPENROUTER_DATA_COLLECTION !== 'deny'
    ) {
      invalidConfig();
    }
    if (
      filtered.OPENROUTER_DISABLE_TRANSFORMS !== undefined &&
      filtered.OPENROUTER_DISABLE_TRANSFORMS !== 'true'
    ) {
      invalidConfig();
    }
    const legacy = loadConfig(filtered);
    const voice = loadVoiceConfig(filtered);
    const settings = defaultManageableSettings();
    settings.openRouter.modelId = legacy.openRouter.modelId;
    settings.chat = {
      maxInputChars: legacy.budgets.maxInputChars,
      maxInputTokens: legacy.budgets.maxInputTokens,
      maxMessagesInContext: legacy.budgets.maxMessagesInContext,
      maxContextTokens: legacy.budgets.maxContextTokens,
      maxOutputTokens: legacy.budgets.maxOutputTokens,
      modelMarginTokens: legacy.budgets.modelMarginTokens,
      titleMaxChars: legacy.budgets.titleMaxChars,
      maxConcurrentGenerationsPerProcess: legacy.budgets.maxConcurrentGenerationsPerProcess,
      maxRequestsPerMinutePerUser: legacy.budgets.maxRequestsPerMinutePerUser,
      retryMaxAttempts: legacy.budgets.retryMaxAttempts,
      retryBaseDelayMs: legacy.budgets.retryBaseDelayMs,
      retryMaxDelayMs: legacy.budgets.retryMaxDelayMs,
      firstOutputTimeoutMs: legacy.budgets.firstOutputTimeoutMs,
      idleStreamTimeoutMs: legacy.budgets.idleStreamTimeoutMs,
      totalRunTimeoutMs: legacy.budgets.totalRunTimeoutMs,
    };
    const derivedWarning = voice.limits.dictationMaxMs - 30_000;
    settings.voice = {
      enabledModes: { ...voice.enabledModes },
      limits: { ...voice.limits },
      dictationWarningMs: derivedWarning > 0 ? derivedWarning : null,
      quotas: { ...voice.quotas },
    };
    settings.deepgram = {
      region: voice.deepgram.apiBase === 'wss://api.eu.deepgram.com' ? 'eu' : 'us',
      dictationModel: voice.deepgram.dictationModel,
      liveModel: voice.deepgram.liveModel,
      ttsModel: voice.deepgram.ttsModel,
      endpointingMs: voice.deepgram.endpointingMs,
      spokenPunctuation: voice.deepgram.spokenPunctuation,
      keyterms: [...voice.deepgram.keyterms],
      eotThreshold: voice.deepgram.eotThreshold,
      eotTimeoutMs: voice.deepgram.eotTimeoutMs,
      rates: { ...voice.rates },
    };
    return {
      settings: validateManageableSettings(settings, bootstrap),
      credentials: {
        openrouter: presentCredential(filtered.OPENROUTER_API_KEY),
        deepgram: presentCredential(filtered.DEEPGRAM_API_KEY),
      },
      importedNames: Object.keys(filtered).sort(),
    };
  } catch (error) {
    if (error instanceof AppError && error.message === 'Invalid application configuration.') {
      throw error;
    }
    invalidConfig();
  }
}
