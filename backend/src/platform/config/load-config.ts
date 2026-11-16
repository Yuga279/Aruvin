/**
 * ============================================================================
 * FILE: load-config.ts
 * LOCATION: backend/src/platform/config/load-config.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validate environment settings and build the typed Aurvin configuration.
 *
 * ROLE IN PROJECT:
 *    Legacy fixture/import adapter for existing callers until P6 cutover.
 *    Not a live-config port, master-key loader, or env-over-stored overlay.
 *
 * KEY COMPONENTS:
 *    - loadConfig: Parse validated env values and enforce cross-field limits.
 *    - readinessIssues: Identify missing provider/persistence prerequisites.
 * ============================================================================
 */

import { z } from 'zod';
import {
  DEFAULT_BUDGETS,
  budgetConfigSchema,
  type BudgetConfig,
} from '../../contracts/budgets.js';
import {
  documentHeadroomBytes,
  persistenceProfileSchema,
  type PersistenceProfile,
} from '../../contracts/persistence-profile.js';
import { AppError } from '../errors/app-error.js';
import { loadVoiceConfig, type VoiceConfig } from './voice-config.js';

const optionalPositiveInt = z.coerce.number().int().positive().optional();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    AURVIN_USER_ID: z.string().min(1).max(128).default('aurvin-dev-user'),
    PERSISTENCE_PROFILE: persistenceProfileSchema.default('unknown'),
    MONGODB_URI: z.string().default(''),
    MONGODB_DB_NAME: z.string().min(1).default('aurvin'),
    OPENROUTER_API_KEY: z.string().default(''),
    OPENROUTER_MODEL: z.string().default(''),
    OPENROUTER_DATA_COLLECTION: z.enum(['allow', 'deny']).default('deny'),
    OPENROUTER_DISABLE_TRANSFORMS: z
      .enum(['true', 'false'])
      .default('true'),
    AURVIN_EXECUTOR_TOPOLOGY: z
      .literal('single-process')
      .default('single-process'),
    AURVIN_LOCAL_CRASH_RECOVERY: z.enum(['true', 'false']).default('false'),
    MAX_INPUT_CHARS: optionalPositiveInt,
    MAX_INPUT_TOKENS: optionalPositiveInt,
    MAX_MESSAGES_IN_CONTEXT: optionalPositiveInt,
    MAX_CONTEXT_TOKENS: optionalPositiveInt,
    MAX_OUTPUT_TOKENS: optionalPositiveInt,
    MODEL_MARGIN_TOKENS: optionalPositiveInt,
    MAX_MESSAGE_BYTES: optionalPositiveInt,
    MAX_DOCUMENT_BYTES: optionalPositiveInt,
    MAX_MANIFEST_BYTES: optionalPositiveInt,
    MAX_PAGE_SIZE: optionalPositiveInt,
    DEFAULT_PAGE_SIZE: optionalPositiveInt,
    TITLE_MAX_CHARS: optionalPositiveInt,
    MAX_CONCURRENT_GENERATIONS_PER_PROCESS: optionalPositiveInt,
    MAX_REQUESTS_PER_MINUTE_PER_USER: optionalPositiveInt,
    RETRY_MAX_ATTEMPTS: optionalPositiveInt,
    RETRY_BASE_DELAY_MS: optionalPositiveInt,
    RETRY_MAX_DELAY_MS: optionalPositiveInt,
    CONNECT_TIMEOUT_MS: optionalPositiveInt,
    FIRST_OUTPUT_TIMEOUT_MS: optionalPositiveInt,
    IDLE_STREAM_TIMEOUT_MS: optionalPositiveInt,
    TOTAL_RUN_TIMEOUT_MS: optionalPositiveInt,
    PERSISTENCE_TIMEOUT_MS: optionalPositiveInt,
    SHUTDOWN_DRAIN_MS: optionalPositiveInt,
  })
  .passthrough();

export type AurvinConfig = {
  port: number;
  frontendOrigin: string;
  nodeEnv: 'development' | 'test' | 'production';
  identity: { userId: string };
  persistence: {
    profile: PersistenceProfile;
    mongoUri: string;
    mongoDbName: string;
    documentHeadroomBytes: number;
  };
  openRouter: {
    apiKey: string;
    modelId: string;
    dataCollection: 'allow' | 'deny';
    disableTransforms: boolean;
  };
  topology: { executor: 'single-process'; localCrashRecovery?: boolean };
  budgets: BudgetConfig;
  voice?: VoiceConfig;
};

type ParsedEnvironment = z.infer<typeof envSchema>;

function overlayBudgets(env: ParsedEnvironment): BudgetConfig {
  return budgetConfigSchema.parse({
    ...DEFAULT_BUDGETS,
    maxInputChars: env.MAX_INPUT_CHARS ?? DEFAULT_BUDGETS.maxInputChars,
    maxInputTokens: env.MAX_INPUT_TOKENS ?? DEFAULT_BUDGETS.maxInputTokens,
    maxMessagesInContext:
      env.MAX_MESSAGES_IN_CONTEXT ?? DEFAULT_BUDGETS.maxMessagesInContext,
    maxContextTokens: env.MAX_CONTEXT_TOKENS ?? DEFAULT_BUDGETS.maxContextTokens,
    maxOutputTokens: env.MAX_OUTPUT_TOKENS ?? DEFAULT_BUDGETS.maxOutputTokens,
    modelMarginTokens:
      env.MODEL_MARGIN_TOKENS ?? DEFAULT_BUDGETS.modelMarginTokens,
    maxMessageBytes: env.MAX_MESSAGE_BYTES ?? DEFAULT_BUDGETS.maxMessageBytes,
    maxDocumentBytes: env.MAX_DOCUMENT_BYTES ?? DEFAULT_BUDGETS.maxDocumentBytes,
    maxManifestBytes:
      env.MAX_MANIFEST_BYTES ?? DEFAULT_BUDGETS.maxManifestBytes,
    maxPageSize: env.MAX_PAGE_SIZE ?? DEFAULT_BUDGETS.maxPageSize,
    defaultPageSize: env.DEFAULT_PAGE_SIZE ?? DEFAULT_BUDGETS.defaultPageSize,
    titleMaxChars: env.TITLE_MAX_CHARS ?? DEFAULT_BUDGETS.titleMaxChars,
    maxConcurrentAttemptsPerSession: 1,
    maxConcurrentGenerationsPerProcess:
      env.MAX_CONCURRENT_GENERATIONS_PER_PROCESS ??
      DEFAULT_BUDGETS.maxConcurrentGenerationsPerProcess,
    maxRequestsPerMinutePerUser:
      env.MAX_REQUESTS_PER_MINUTE_PER_USER ??
      DEFAULT_BUDGETS.maxRequestsPerMinutePerUser,
    retryMaxAttempts: env.RETRY_MAX_ATTEMPTS ?? DEFAULT_BUDGETS.retryMaxAttempts,
    retryBaseDelayMs:
      env.RETRY_BASE_DELAY_MS ?? DEFAULT_BUDGETS.retryBaseDelayMs,
    retryMaxDelayMs: env.RETRY_MAX_DELAY_MS ?? DEFAULT_BUDGETS.retryMaxDelayMs,
    connectTimeoutMs: env.CONNECT_TIMEOUT_MS ?? DEFAULT_BUDGETS.connectTimeoutMs,
    firstOutputTimeoutMs:
      env.FIRST_OUTPUT_TIMEOUT_MS ?? DEFAULT_BUDGETS.firstOutputTimeoutMs,
    idleStreamTimeoutMs:
      env.IDLE_STREAM_TIMEOUT_MS ?? DEFAULT_BUDGETS.idleStreamTimeoutMs,
    totalRunTimeoutMs:
      env.TOTAL_RUN_TIMEOUT_MS ?? DEFAULT_BUDGETS.totalRunTimeoutMs,
    persistenceTimeoutMs:
      env.PERSISTENCE_TIMEOUT_MS ?? DEFAULT_BUDGETS.persistenceTimeoutMs,
    shutdownDrainMs: env.SHUTDOWN_DRAIN_MS ?? DEFAULT_BUDGETS.shutdownDrainMs,
  });
}

export function loadConfig(
  env: NodeJS.Dict<string> | Record<string, string | undefined>,
): AurvinConfig & { voice: VoiceConfig } {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'Invalid application configuration.',
    );
  }

  try {
    const voice = loadVoiceConfig(env);
    const budgets = overlayBudgets(parsed.data);
    const documentLimit = documentHeadroomBytes(parsed.data.PERSISTENCE_PROFILE);
    if (parsed.data.AURVIN_LOCAL_CRASH_RECOVERY === 'true' &&
        parsed.data.PERSISTENCE_PROFILE !== 'native-mongodb') throw new Error('local_requires_native');
    if (
      budgets.maxDocumentBytes > documentLimit ||
      budgets.maxMessageBytes >= budgets.maxDocumentBytes ||
      budgets.maxManifestBytes >= budgets.maxDocumentBytes
    ) {
      throw new Error('storage_budget_exceeds_document_headroom');
    }

    return {
      port: parsed.data.PORT,
      frontendOrigin: parsed.data.FRONTEND_ORIGIN,
      nodeEnv: parsed.data.NODE_ENV,
      identity: { userId: parsed.data.AURVIN_USER_ID },
      persistence: {
        profile: parsed.data.PERSISTENCE_PROFILE,
        mongoUri: parsed.data.MONGODB_URI,
        mongoDbName: parsed.data.MONGODB_DB_NAME,
        documentHeadroomBytes: documentLimit,
      },
      openRouter: {
        apiKey: parsed.data.OPENROUTER_API_KEY,
        modelId: parsed.data.OPENROUTER_MODEL,
        dataCollection: parsed.data.OPENROUTER_DATA_COLLECTION,
        disableTransforms: parsed.data.OPENROUTER_DISABLE_TRANSFORMS === 'true',
      },
      topology: { executor: parsed.data.AURVIN_EXECUTOR_TOPOLOGY,
        localCrashRecovery: parsed.data.AURVIN_LOCAL_CRASH_RECOVERY === 'true' },
      budgets,
      voice,
    };
  } catch {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'Invalid application configuration.',
    );
  }
}

export function readinessIssues(config: AurvinConfig): string[] {
  const issues: string[] = [];
  if (!config.openRouter.apiKey) {
    issues.push('OPENROUTER_API_KEY is missing');
  }
  if (!config.openRouter.modelId) {
    issues.push('OPENROUTER_MODEL is missing');
  }
  if (!config.persistence.mongoUri) {
    issues.push('MONGODB_URI is missing');
  }
  return issues;
}
