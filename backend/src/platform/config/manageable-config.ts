/**
 * ============================================================================
 * FILE: manageable-config.ts
 * LOCATION: backend/src/platform/config/manageable-config.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Build safe settings defaults, bootstrap-aware validation, and frozen snapshots.
 *
 * ROLE IN PROJECT:
 *    Projects stored or imported settings onto runtime budgets and snapshots
 *    without mixing infrastructure safety into editable chat fields.
 *
 * KEY COMPONENTS:
 *    - defaultManageableSettings: Fresh unconfigured settings for missing state.
 *    - validateManageableSettings: Schema plus bootstrap/queue/safety bounds.
 *    - buildRuntimeSnapshot: Detached frozen revision for new work.
 * ============================================================================
 */

import { DEFAULT_BUDGETS, budgetConfigSchema, usableHistoryTokens, type BudgetConfig } from '../../contracts/budgets.js';
import { DEFAULT_VOICE_LIMITS, MAX_VOICE_CONTROL_BYTES } from '../../contracts/voice-wire.js';
import { MAX_NODE_TIMER_MS, manageableSettingsSchema } from '../../contracts/admin-config.js';
import type { StoredConfigDocument } from '../../contracts/admin-config.js';
import type {
  ManageableSettings,
  PublicAdminConfig,
} from '../../contracts/admin-config-wire.js';
import type {
  RuntimeConfigSnapshot,
  SnapshotCandidate,
  VerifiedModelLimits,
  VoiceConfig,
} from '../../contracts/config-runtime.js';
import { AppError } from '../errors/app-error.js';
import type { BootstrapConfig, StorageSafety } from './bootstrap-config.js';

const DEEPGRAM_API_BASE = {
  us: 'wss://api.deepgram.com',
  eu: 'wss://api.eu.deepgram.com',
} as const;

function invalidConfig(): never {
  throw new AppError(
    'CONFIGURATION_ERROR',
    'Invalid application configuration.',
  );
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
  } else {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      freezeDeep(nested);
    }
  }
  return Object.freeze(value);
}

function voiceInputQueueBytes(inputQueueMs: number): number {
  return inputQueueMs * 32 + 16 * Math.ceil(inputQueueMs / 80);
}

function voiceOutputQueueBytes(outputQueueMs: number): number {
  return outputQueueMs * 48 + 16 * Math.ceil(outputQueueMs / 200);
}

function dailyMinutesToMs(minutes: number): number {
  const ms = minutes * 60_000;
  if (!Number.isSafeInteger(ms) || ms > MAX_NODE_TIMER_MS) invalidConfig();
  return ms;
}

function hasConfiguredModel(candidate: SnapshotCandidate): boolean {
  return Boolean(candidate.credentials.openrouter) && candidate.settings.openRouter.modelId !== '';
}

function assertVerifiedModelLimits(
  settings: ManageableSettings,
  modelLimits: VerifiedModelLimits | null,
  configured: boolean,
): void {
  if (!configured) return;
  if (modelLimits === null) invalidConfig();
  if (
    modelLimits.modelId !== settings.openRouter.modelId ||
    modelLimits.supportsMaxTokens !== true ||
    (modelLimits.source !== 'fixture' && modelLimits.source !== 'catalogue') ||
    !Number.isSafeInteger(modelLimits.contextTokens) ||
    !Number.isSafeInteger(modelLimits.outputTokens) ||
    modelLimits.contextTokens <= 0 ||
    modelLimits.outputTokens <= 0 ||
    modelLimits.contextTokens < settings.chat.maxContextTokens ||
    modelLimits.outputTokens < settings.chat.maxOutputTokens
  ) {
    invalidConfig();
  }
}

export function defaultManageableSettings(): ManageableSettings {
  return {
    openRouter: {
      modelId: '',
      dataCollection: 'deny',
      disableTransforms: true,
    },
    chat: {
      maxInputChars: DEFAULT_BUDGETS.maxInputChars,
      maxInputTokens: DEFAULT_BUDGETS.maxInputTokens,
      maxMessagesInContext: DEFAULT_BUDGETS.maxMessagesInContext,
      maxContextTokens: DEFAULT_BUDGETS.maxContextTokens,
      maxOutputTokens: DEFAULT_BUDGETS.maxOutputTokens,
      modelMarginTokens: DEFAULT_BUDGETS.modelMarginTokens,
      titleMaxChars: DEFAULT_BUDGETS.titleMaxChars,
      maxConcurrentGenerationsPerProcess:
        DEFAULT_BUDGETS.maxConcurrentGenerationsPerProcess,
      maxRequestsPerMinutePerUser: DEFAULT_BUDGETS.maxRequestsPerMinutePerUser,
      retryMaxAttempts: DEFAULT_BUDGETS.retryMaxAttempts,
      retryBaseDelayMs: DEFAULT_BUDGETS.retryBaseDelayMs,
      retryMaxDelayMs: DEFAULT_BUDGETS.retryMaxDelayMs,
      firstOutputTimeoutMs: DEFAULT_BUDGETS.firstOutputTimeoutMs,
      idleStreamTimeoutMs: DEFAULT_BUDGETS.idleStreamTimeoutMs,
      totalRunTimeoutMs: DEFAULT_BUDGETS.totalRunTimeoutMs,
    },
    voice: {
      enabledModes: { dictation: false, live: false },
      limits: { ...DEFAULT_VOICE_LIMITS },
      dictationWarningMs: 270_000,
      quotas: {
        identityConcurrent: 1,
        globalConcurrent: 4,
        identityDailyMinutes: 60,
        globalDailyMinutes: 120,
        dailySpendUsd: null,
      },
    },
    deepgram: {
      region: 'us',
      dictationModel: 'nova-3',
      liveModel: 'flux-general-en',
      ttsModel: 'flux-haley-en',
      endpointingMs: 300,
      spokenPunctuation: false,
      keyterms: [],
      eotThreshold: 0.8,
      eotTimeoutMs: 5_000,
      rates: {
        novaPerMinuteUsd: null,
        fluxSttPerMinuteUsd: null,
        fluxTtsPerThousandCharsUsd: null,
      },
    },
  };
}

export function composeRuntimeBudgets(
  settings: ManageableSettings,
  safety: StorageSafety,
): BudgetConfig {
  try {
    return budgetConfigSchema.parse({
      ...settings.chat,
      ...safety,
      maxConcurrentAttemptsPerSession: 1,
    });
  } catch {
    invalidConfig();
  }
}

export function validateManageableSettings(
  raw: unknown,
  bootstrap: BootstrapConfig,
): ManageableSettings {
  const parsed = manageableSettingsSchema.safeParse(raw);
  if (!parsed.success) invalidConfig();
  const settings = parsed.data;
  try {
    const budgets = composeRuntimeBudgets(settings, bootstrap.safety);
    const usable = usableHistoryTokens(budgets);
    if (
      settings.chat.maxInputTokens > bootstrap.safety.maxMessageBytes ||
      settings.chat.maxOutputTokens > bootstrap.safety.maxMessageBytes ||
      settings.chat.maxInputTokens > usable ||
      settings.voice.limits.connectMs > bootstrap.safety.connectTimeoutMs ||
      voiceInputQueueBytes(settings.voice.limits.inputQueueMs) > MAX_VOICE_CONTROL_BYTES ||
      voiceOutputQueueBytes(settings.voice.limits.outputQueueMs) > MAX_VOICE_CONTROL_BYTES
    ) {
      invalidConfig();
    }
    dailyMinutesToMs(settings.voice.quotas.identityDailyMinutes);
    dailyMinutesToMs(settings.voice.quotas.globalDailyMinutes);
  } catch (error) {
    if (error instanceof AppError) throw error;
    invalidConfig();
  }
  return settings;
}

export function buildRuntimeSnapshot(
  bootstrap: BootstrapConfig,
  candidate: SnapshotCandidate,
  modelLimits: VerifiedModelLimits | null,
): RuntimeConfigSnapshot {
  if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 0) {
    invalidConfig();
  }
  const settings = validateManageableSettings(candidate.settings, bootstrap);
  assertVerifiedModelLimits(settings, modelLimits, hasConfiguredModel(candidate));
  const clonedSettings = freezeDeep(structuredClone(settings));
  const clonedLimits = modelLimits === null ? null : freezeDeep(structuredClone(modelLimits));
  const budgets = freezeDeep(composeRuntimeBudgets(clonedSettings, bootstrap.safety));
  const voice = freezeDeep({
    enabledModes: { ...clonedSettings.voice.enabledModes },
    limits: { ...clonedSettings.voice.limits },
    dictationWarningMs: clonedSettings.voice.dictationWarningMs,
    deepgram: {
      apiKey: candidate.credentials.deepgram ?? '',
      apiBase: DEEPGRAM_API_BASE[clonedSettings.deepgram.region],
      dictationModel: clonedSettings.deepgram.dictationModel,
      liveModel: clonedSettings.deepgram.liveModel,
      ttsModel: clonedSettings.deepgram.ttsModel,
      endpointingMs: clonedSettings.deepgram.endpointingMs,
      spokenPunctuation: clonedSettings.deepgram.spokenPunctuation,
      keyterms: [...clonedSettings.deepgram.keyterms],
      eotThreshold: clonedSettings.deepgram.eotThreshold,
      eotTimeoutMs: clonedSettings.deepgram.eotTimeoutMs,
    },
    livekit: bootstrap.livekit ? { ...bootstrap.livekit } : null,
    quotas: { ...clonedSettings.voice.quotas },
    rates: { ...clonedSettings.deepgram.rates },
  } satisfies VoiceConfig & { dictationWarningMs: number | null });
  return freezeDeep({
    schemaVersion: 1 as const,
    revision: candidate.revision,
    settings: clonedSettings,
    budgets,
    openRouter: {
      apiKey: candidate.credentials.openrouter ?? '',
      modelId: clonedSettings.openRouter.modelId,
      dataCollection: 'deny' as const,
      disableTransforms: true as const,
    },
    voice,
    modelLimits: clonedLimits,
  });
}

const ROLE_ASSUMPTION: PublicAdminConfig['roleAssumption'] = {
  role: 'super-admin',
  authentication: 'session',
  source: 'local-account',
};

function publicCredentialState(
  stored: StoredConfigDocument['credentials']['openrouter'],
): PublicAdminConfig['credentials']['openrouter'] {
  return stored
    ? { configured: true, validatedAt: stored.validatedAt }
    : { configured: false, validatedAt: null };
}

export function projectPublicAdminConfig(
  document: StoredConfigDocument | null,
  active: RuntimeConfigSnapshot | null,
  activation: PublicAdminConfig['activation'],
): PublicAdminConfig {
  if (document === null) {
    return {
      protocolVersion: 1,
      schemaVersion: 1,
      revision: 0,
      activeRevision: active?.revision ?? null,
      state: 'missing',
      activation,
      roleAssumption: { ...ROLE_ASSUMPTION },
      settings: defaultManageableSettings(),
      credentials: {
        openrouter: { configured: false, validatedAt: null },
        deepgram: { configured: false, validatedAt: null },
      },
    };
  }
  return {
    protocolVersion: 1,
    schemaVersion: 1,
    revision: document.revision,
    activeRevision: active?.revision ?? null,
    state: 'stored',
    activation,
    roleAssumption: { ...ROLE_ASSUMPTION },
    settings: structuredClone(document.settings),
    credentials: {
      openrouter: publicCredentialState(document.credentials.openrouter),
      deepgram: publicCredentialState(document.credentials.deepgram),
    },
  };
}
