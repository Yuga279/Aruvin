/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: frontend/src/features/admin-config/testing/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Redacted public admin-config fixtures for focused frontend checks.
 *
 * ROLE IN PROJECT:
 *    Supplies structured-clone public snapshots and closed error envelopes
 *    without credentials, runtime secrets, or product-default authority.
 *
 * KEY COMPONENTS:
 *    - publicConfig: Valid stored/active PublicAdminConfig clone.
 *    - adminFailure: Nested AdminConfigError envelope with empty fieldErrors.
 * ============================================================================
 */

import type {
  AdminConfigError,
  AdminConfigErrorCode,
  ManageableSettings,
  PublicAdminConfig,
} from '../../../api/admin-config-protocol.ts';
import { DEFAULT_VOICE_LIMITS } from '../../../api/voice-protocol.ts';

const settings: ManageableSettings = {
  openRouter: { modelId: 'openai/gpt-4.1-mini', dataCollection: 'deny', disableTransforms: true },
  chat: {
    maxInputChars: 32000, maxInputTokens: 8000, maxMessagesInContext: 100,
    maxContextTokens: 32000, maxOutputTokens: 2000, modelMarginTokens: 512,
    titleMaxChars: 80, maxConcurrentGenerationsPerProcess: 2,
    maxRequestsPerMinutePerUser: 30, retryMaxAttempts: 3,
    retryBaseDelayMs: 250, retryMaxDelayMs: 1000, firstOutputTimeoutMs: 10000,
    idleStreamTimeoutMs: 10000, totalRunTimeoutMs: 30000,
  },
  voice: {
    enabledModes: { dictation: false, live: false },
    limits: { ...DEFAULT_VOICE_LIMITS }, dictationWarningMs: null,
    quotas: {
      identityConcurrent: 1, globalConcurrent: 2,
      identityDailyMinutes: 30, globalDailyMinutes: 60, dailySpendUsd: null,
    },
  },
  deepgram: {
    region: 'us', dictationModel: 'nova-3', liveModel: 'flux-general-en',
    ttsModel: 'flux-haley-en', endpointingMs: 300, spokenPunctuation: false,
    keyterms: [], eotThreshold: 0.7, eotTimeoutMs: 1000,
    rates: { novaPerMinuteUsd: null, fluxSttPerMinuteUsd: null, fluxTtsPerThousandCharsUsd: null },
  },
};

export function publicConfig(revision = 1): PublicAdminConfig {
  return structuredClone({
    protocolVersion: 1,
    schemaVersion: 1,
    revision,
    activeRevision: revision,
    state: 'stored',
    activation: 'active',
    roleAssumption: {
      role: 'super-admin',
      authentication: 'disabled',
      source: 'server-configured-development',
    },
    settings,
    credentials: {
      openrouter: { configured: true, validatedAt: '2026-10-13T00:00:00.000Z' },
      deepgram: { configured: false, validatedAt: null },
    },
  });
}

export function adminFailure(
  code: AdminConfigErrorCode,
  currentRevision: number | null = null,
): AdminConfigError {
  return {
    protocolVersion: 1,
    error: { code, retryable: false, currentRevision, fieldErrors: [] },
  };
}
