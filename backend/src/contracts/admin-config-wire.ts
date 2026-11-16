/**
 * ============================================================================
 * FILE: admin-config-wire.ts
 * LOCATION: backend/src/contracts/admin-config-wire.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define the public admin configuration protocol types, routes, and limits.
 *
 * ROLE IN PROJECT:
 *    Freezes the browser-safe configuration contract so backend schemas and the
 *    frontend protocol mirror share one redacted shape without secrets.
 *
 * KEY COMPONENTS:
 *    - ADMIN_CONFIG_ROUTES / versions: Public admin HTTP paths and protocol ids.
 *    - ManageableSettings / PublicAdminConfig: Nonsecret settings and reads.
 *    - ADMIN_CONFIG_ERROR_CODES / FIELD_PATHS: Closed error and field catalogs.
 * ============================================================================
 */

import { isVoiceLimits, type VoiceLimits } from './voice-wire.js';

export const ADMIN_CONFIG_PROTOCOL_VERSION = 1 as const;
export const ADMIN_CONFIG_SCHEMA_VERSION = 1 as const;
export const MAX_ADMIN_CONFIG_BODY_BYTES = 16_384;
export const MAX_CREDENTIAL_BYTES = 4_096;
export const CREDENTIAL_VALIDATION_LIMITS = {
  timeoutMs: 10_000, responseBytes: 65_536, retries: 0,
} as const;
export type CredentialProvider = 'openrouter' | 'deepgram';
export const ADMIN_CONFIG_ROUTES = {
  config: '/admin/config',
  credential: (provider: CredentialProvider) => `/admin/config/credentials/${provider}`,
} as const;

export type ChatLimits = {
  maxInputChars: number; maxInputTokens: number; maxMessagesInContext: number;
  maxContextTokens: number; maxOutputTokens: number; modelMarginTokens: number;
  titleMaxChars: number; maxConcurrentGenerationsPerProcess: number;
  maxRequestsPerMinutePerUser: number; retryMaxAttempts: number;
  retryBaseDelayMs: number; retryMaxDelayMs: number;
  firstOutputTimeoutMs: number; idleStreamTimeoutMs: number; totalRunTimeoutMs: number;
};
export type ManageableSettings = {
  openRouter: { modelId: string; dataCollection: 'deny'; disableTransforms: true };
  chat: ChatLimits;
  voice: {
    enabledModes: { dictation: boolean; live: boolean };
    limits: VoiceLimits; dictationWarningMs: number | null;
    quotas: { identityConcurrent: number; globalConcurrent: number;
      identityDailyMinutes: number; globalDailyMinutes: number; dailySpendUsd: number | null };
  };
  deepgram: {
    region: 'us' | 'eu'; dictationModel: 'nova-3'; liveModel: 'flux-general-en';
    ttsModel: 'flux-haley-en' | 'flux-alexis-en' | 'flux-priya-en';
    endpointingMs: number; spokenPunctuation: boolean; keyterms: string[];
    eotThreshold: number; eotTimeoutMs: number;
    rates: { novaPerMinuteUsd: number | null; fluxSttPerMinuteUsd: number | null;
      fluxTtsPerThousandCharsUsd: number | null };
  };
};
export type CredentialState = { configured: boolean; validatedAt: string | null };
export type SessionAdminRoleAssumption = {
  role: 'super-admin' | 'user'; authentication: 'session'; source: 'local-account';
};
/** @deprecated P3 removes this compile bridge at application auth cutover. */
export type LegacyAdminRoleAssumption = {
  role: 'super-admin'; authentication: 'disabled'; source: 'server-configured-development';
};
export type AdminRoleAssumption = SessionAdminRoleAssumption | LegacyAdminRoleAssumption;
export type PublicAdminConfig = {
  protocolVersion: 1; schemaVersion: 1;
  revision: number; activeRevision: number | null; state: 'missing' | 'stored';
  activation: 'active' | 'unconfigured' | 'blocked';
  roleAssumption: AdminRoleAssumption;
  settings: ManageableSettings;
  credentials: { openrouter: CredentialState; deepgram: CredentialState };
};
export type SaveSettingsRequest = {
  protocolVersion: 1; expectedRevision: number; settings: ManageableSettings;
};
export type CredentialUpdateRequest =
  | { protocolVersion: 1; expectedRevision: number; action: 'replace'; candidate: string }
  | { protocolVersion: 1; expectedRevision: number; action: 'remove'; confirm: true };
export const ADMIN_CONFIG_ERROR_CODES = [
  'INVALID_CONFIG_REQUEST', 'CONFIG_VALIDATION_FAILED', 'CONFIG_CONFLICT',
  'CONFIG_STORAGE_UNAVAILABLE', 'CONFIG_WRITE_UNCERTAIN', 'CONFIG_STORED_INVALID',
  'CONFIG_ENCRYPTION_UNAVAILABLE', 'CONFIG_ACTIVATION_UNAVAILABLE',
  'CREDENTIAL_REJECTED', 'CREDENTIAL_VALIDATION_TIMEOUT',
  'CREDENTIAL_PROVIDER_RATE_LIMITED', 'CREDENTIAL_PROVIDER_UNAVAILABLE',
  'CREDENTIAL_PROVIDER_RESPONSE_INVALID', 'ADMIN_RATE_LIMITED',
  'INVALID_ADMIN_ORIGIN', 'ADMIN_TRANSPORT_REQUIRED',
] as const;
export type AdminConfigErrorCode = typeof ADMIN_CONFIG_ERROR_CODES[number];
export type AdminConfigError = {
  protocolVersion: 1;
  error: { code: AdminConfigErrorCode; retryable: boolean; currentRevision: number | null;
    fieldErrors: Array<{ path: string; code: 'required' | 'invalid' | 'out_of_range'
      | 'cross_field' | 'immutable' | 'unsupported' }> };
};

export const ADMIN_CONFIG_FIELD_PATHS = [
  'expectedRevision',
  'candidate',
  'openRouter.modelId',
  'openRouter.dataCollection',
  'openRouter.disableTransforms',
  'chat.maxInputChars',
  'chat.maxInputTokens',
  'chat.maxMessagesInContext',
  'chat.maxContextTokens',
  'chat.maxOutputTokens',
  'chat.modelMarginTokens',
  'chat.titleMaxChars',
  'chat.maxConcurrentGenerationsPerProcess',
  'chat.maxRequestsPerMinutePerUser',
  'chat.retryMaxAttempts',
  'chat.retryBaseDelayMs',
  'chat.retryMaxDelayMs',
  'chat.firstOutputTimeoutMs',
  'chat.idleStreamTimeoutMs',
  'chat.totalRunTimeoutMs',
  'voice.enabledModes.dictation',
  'voice.enabledModes.live',
  'voice.limits.dictationMaxMs',
  'voice.dictationWarningMs',
  'voice.limits.liveMaxMs',
  'voice.limits.liveWarningMs',
  'voice.limits.idleWarningMs',
  'voice.limits.idleExitAfterWarningMs',
  'voice.limits.finalizationMs',
  'voice.limits.reconnectMs',
  'voice.limits.connectMs',
  'voice.limits.inputQueueMs',
  'voice.limits.outputQueueMs',
  'voice.quotas.identityConcurrent',
  'voice.quotas.globalConcurrent',
  'voice.quotas.identityDailyMinutes',
  'voice.quotas.globalDailyMinutes',
  'voice.quotas.dailySpendUsd',
  'deepgram.region',
  'deepgram.dictationModel',
  'deepgram.liveModel',
  'deepgram.ttsModel',
  'deepgram.endpointingMs',
  'deepgram.spokenPunctuation',
  'deepgram.keyterms',
  'deepgram.eotThreshold',
  'deepgram.eotTimeoutMs',
  'deepgram.rates.novaPerMinuteUsd',
  'deepgram.rates.fluxSttPerMinuteUsd',
  'deepgram.rates.fluxTtsPerThousandCharsUsd',
] as const;
export type AdminConfigFieldPath = typeof ADMIN_CONFIG_FIELD_PATHS[number];

const FIELD_PATHS = new Set<string>(ADMIN_CONFIG_FIELD_PATHS);
const ERROR_CODES = new Set<string>(ADMIN_CONFIG_ERROR_CODES);
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const MAX_NODE_TIMER_MS = 2_147_483_647;
type Guard = (value: unknown) => boolean;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, shape: Record<string, Guard>): boolean =>
  record(value) && Object.keys(value).length === Object.keys(shape).length &&
  Object.entries(shape).every(([key, guard]) => Object.hasOwn(value, key) && guard(value[key]));
export function isSessionAdminAssumption(value: unknown): value is SessionAdminRoleAssumption {
  return exact(value, { role: x => x === 'super-admin' || x === 'user',
    authentication: x => x === 'session', source: x => x === 'local-account' });
}
const bool: Guard = value => typeof value === 'boolean';
const finite: Guard = value => typeof value === 'number' && Number.isFinite(value);
const safePos = (max = Number.MAX_SAFE_INTEGER): Guard => value =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
const timer: Guard = safePos(MAX_NODE_TIMER_MS);
const nullable = (guard: Guard): Guard => value => value === null || guard(value);
const timestamp: Guard = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 40 && !Number.isNaN(Date.parse(value));
const modelId: Guard = value => typeof value === 'string' && value.length <= 200 &&
  (value === '' || (value.trim() === value && value.length > 0 && !CONTROL_CHARS.test(value)));
const keyterm: Guard = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 64 && value.trim() === value && !CONTROL_CHARS.test(value);

function isChatLimits(value: unknown): value is ChatLimits {
  if (!exact(value, {
    maxInputChars: safePos(32_000), maxInputTokens: safePos(), maxMessagesInContext: safePos(500),
    maxContextTokens: safePos(), maxOutputTokens: safePos(), modelMarginTokens: safePos(),
    titleMaxChars: safePos(80), maxConcurrentGenerationsPerProcess: safePos(),
    maxRequestsPerMinutePerUser: safePos(), retryMaxAttempts: safePos(3),
    retryBaseDelayMs: timer, retryMaxDelayMs: timer, firstOutputTimeoutMs: timer,
    idleStreamTimeoutMs: timer, totalRunTimeoutMs: timer,
  })) return false;
  const v = value as ChatLimits;
  return v.maxContextTokens - v.maxOutputTokens - v.modelMarginTokens > 0 &&
    v.retryMaxDelayMs >= v.retryBaseDelayMs && v.retryMaxDelayMs <= v.totalRunTimeoutMs &&
    v.firstOutputTimeoutMs <= v.totalRunTimeoutMs && v.idleStreamTimeoutMs <= v.totalRunTimeoutMs;
}

export function isManageableSettings(value: unknown): value is ManageableSettings {
  if (!record(value) || !exact(value, {
    openRouter: v => exact(v, { modelId, dataCollection: x => x === 'deny', disableTransforms: x => x === true }),
    chat: isChatLimits,
    voice: v => record(v) && exact(v, {
      enabledModes: modes => exact(modes, { dictation: bool, live: bool }),
      limits: isVoiceLimits,
      dictationWarningMs: nullable(timer),
      quotas: q => exact(q, {
        identityConcurrent: safePos(), globalConcurrent: safePos(),
        identityDailyMinutes: safePos(), globalDailyMinutes: safePos(),
        dailySpendUsd: nullable(x => finite(x) && (x as number) > 0),
      }),
    }),
    deepgram: v => record(v) && exact(v, {
      region: x => x === 'us' || x === 'eu',
      dictationModel: x => x === 'nova-3', liveModel: x => x === 'flux-general-en',
      ttsModel: x => x === 'flux-haley-en' || x === 'flux-alexis-en' || x === 'flux-priya-en',
      endpointingMs: x => typeof x === 'number' && Number.isSafeInteger(x) && x >= 300 && x <= 500,
      spokenPunctuation: bool,
      keyterms: x => Array.isArray(x) && x.length <= 50 && x.every(keyterm),
      eotThreshold: x => finite(x) && (x as number) >= 0.5 && (x as number) <= 1,
      eotTimeoutMs: timer,
      rates: r => exact(r, {
        novaPerMinuteUsd: nullable(x => finite(x) && (x as number) >= 0),
        fluxSttPerMinuteUsd: nullable(x => finite(x) && (x as number) >= 0),
        fluxTtsPerThousandCharsUsd: nullable(x => finite(x) && (x as number) >= 0),
      }),
    }),
  })) return false;
  const s = value as ManageableSettings;
  if (s.voice.dictationWarningMs !== null &&
      s.voice.dictationWarningMs >= s.voice.limits.dictationMaxMs) return false;
  if (s.voice.quotas.identityConcurrent > s.voice.quotas.globalConcurrent) return false;
  if (s.voice.quotas.identityDailyMinutes > s.voice.quotas.globalDailyMinutes) return false;
  if (s.voice.quotas.dailySpendUsd !== null &&
      (s.deepgram.rates.novaPerMinuteUsd === null ||
        s.deepgram.rates.fluxSttPerMinuteUsd === null ||
        s.deepgram.rates.fluxTtsPerThousandCharsUsd === null)) return false;
  return true;
}

function isCredentialState(value: unknown): value is CredentialState {
  if (!exact(value, { configured: bool, validatedAt: nullable(timestamp) })) return false;
  const v = value as CredentialState;
  return v.configured ? v.validatedAt !== null : v.validatedAt === null;
}

export function isPublicAdminConfig(value: unknown): value is PublicAdminConfig {
  if (!exact(value, {
    protocolVersion: v => v === 1, schemaVersion: v => v === 1,
    revision: v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
    activeRevision: nullable(v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0),
    state: v => v === 'missing' || v === 'stored',
    activation: v => v === 'active' || v === 'unconfigured' || v === 'blocked',
    roleAssumption: v => isSessionAdminAssumption(v) || exact(v, {
      role: x => x === 'super-admin', authentication: x => x === 'disabled',
      source: x => x === 'server-configured-development',
    }),
    settings: isManageableSettings,
    credentials: v => exact(v, { openrouter: isCredentialState, deepgram: isCredentialState }),
  })) return false;
  const v = value as PublicAdminConfig;
  if (v.state === 'missing') {
    if (v.revision !== 0 || v.credentials.openrouter.configured || v.credentials.deepgram.configured)
      return false;
  } else if (v.revision < 1) return false;
  if (v.activation === 'active' && (v.activeRevision !== v.revision || v.state !== 'stored'))
    return false;
  return true;
}

export function isAdminConfigError(value: unknown): value is AdminConfigError {
  if (!exact(value, {
    protocolVersion: v => v === 1,
    error: v => exact(v, {
      code: x => typeof x === 'string' && ERROR_CODES.has(x),
      retryable: bool,
      currentRevision: nullable(x => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0),
      fieldErrors: x => Array.isArray(x) && x.length <= 20 && x.every(err => exact(err, {
        path: p => typeof p === 'string' && FIELD_PATHS.has(p),
        code: c => c === 'required' || c === 'invalid' || c === 'out_of_range' ||
          c === 'cross_field' || c === 'immutable' || c === 'unsupported',
      })),
    }),
  })) return false;
  return true;
}
