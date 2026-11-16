/**
 * ============================================================================
 * FILE: bootstrap-config.ts
 * LOCATION: backend/src/platform/config/bootstrap-config.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Parse infrastructure-only environment settings and master-key state.
 *
 * ROLE IN PROJECT:
 *    Owns startup binding, persistence identity, storage safety, and encryption
 *    key status without reading manageable chat or provider settings.
 *
 * KEY COMPONENTS:
 *    - loadBootstrapConfig: Allowlisted infrastructure parse and safety checks.
 *    - parseEncryptionKey: Canonical 32-byte master-key state, never generated.
 *    - obsoleteManageableNames / legacyConfigWarning: Name-only ignore notices.
 * ============================================================================
 */

import { z } from 'zod';
import { DEFAULT_BUDGETS, type BudgetConfig } from '../../contracts/budgets.js';
import {
  documentHeadroomBytes,
  persistenceProfileSchema,
  type PersistenceProfile,
} from '../../contracts/persistence-profile.js';
import { AppError } from '../errors/app-error.js';
import {
  CALENDAR_BOOTSTRAP_ENV_NAMES,
  loadCalendarBootstrap,
  type CalendarBootstrap,
} from './calendar-config.js';
import { parseLiveKitConfig, type LiveKitConfig } from './voice-config.js';

const MAX_NODE_TIMER_MS = 2_147_483_647;
const DEV_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const LIVEKIT_BOOTSTRAP_ENV_NAMES = [
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'LIVEKIT_URL',
] as const;

export const BOOTSTRAP_ENV_NAMES = [
  'AURVIN_CONFIG_ENCRYPTION_KEY',
  'AURVIN_EXECUTOR_TOPOLOGY',
  'AURVIN_LOCAL_CRASH_RECOVERY',
  'AURVIN_USER_ID',
  'CONNECT_TIMEOUT_MS',
  'DEFAULT_PAGE_SIZE',
  'FRONTEND_ORIGIN',
  'MAX_DOCUMENT_BYTES',
  'MAX_MANIFEST_BYTES',
  'MAX_MESSAGE_BYTES',
  'MAX_PAGE_SIZE',
  'MONGODB_DB_NAME',
  'MONGODB_URI',
  'NODE_ENV',
  'PERSISTENCE_PROFILE',
  'PERSISTENCE_TIMEOUT_MS',
  'PORT',
  'SHUTDOWN_DRAIN_MS',
  ...CALENDAR_BOOTSTRAP_ENV_NAMES,
  ...LIVEKIT_BOOTSTRAP_ENV_NAMES,
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
] as const;

export const LEGACY_MANAGEABLE_ENV_NAMES = [
  'DEEPGRAM_API_BASE',
  'DEEPGRAM_API_KEY',
  'DEEPGRAM_DICTATION_ENDPOINTING_MS',
  'DEEPGRAM_DICTATION_MODEL',
  'DEEPGRAM_FLUX_EOT_THRESHOLD',
  'DEEPGRAM_FLUX_EOT_TIMEOUT_MS',
  'DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD',
  'DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD',
  'DEEPGRAM_KEYTERMS',
  'DEEPGRAM_LIVE_MODEL',
  'DEEPGRAM_NOVA_RATE_PER_MIN_USD',
  'DEEPGRAM_SPOKEN_PUNCTUATION',
  'DEEPGRAM_TTS_MODEL',
  'ENABLE_DICTATION_MODE',
  'ENABLE_LIVE_VOICE_MODE',
  'FIRST_OUTPUT_TIMEOUT_MS',
  'IDLE_STREAM_TIMEOUT_MS',
  'MAX_CONCURRENT_GENERATIONS_PER_PROCESS',
  'MAX_CONTEXT_TOKENS',
  'MAX_INPUT_CHARS',
  'MAX_INPUT_TOKENS',
  'MAX_MESSAGES_IN_CONTEXT',
  'MAX_OUTPUT_TOKENS',
  'MAX_REQUESTS_PER_MINUTE_PER_USER',
  'MODEL_MARGIN_TOKENS',
  'OPENROUTER_API_KEY',
  'OPENROUTER_DATA_COLLECTION',
  'OPENROUTER_DISABLE_TRANSFORMS',
  'OPENROUTER_MODEL',
  'RETRY_BASE_DELAY_MS',
  'RETRY_MAX_ATTEMPTS',
  'RETRY_MAX_DELAY_MS',
  'TITLE_MAX_CHARS',
  'TOTAL_RUN_TIMEOUT_MS',
  'VOICE_CONNECT_MS',
  'VOICE_DAILY_SPEND_USD',
  'VOICE_DICTATION_MAX_MS',
  'VOICE_FINALIZATION_MS',
  'VOICE_GLOBAL_CONCURRENT',
  'VOICE_GLOBAL_DAILY_MINUTES',
  'VOICE_IDENTITY_CONCURRENT',
  'VOICE_IDENTITY_DAILY_MINUTES',
  'VOICE_IDLE_EXIT_AFTER_WARNING_MS',
  'VOICE_IDLE_WARNING_MS',
  'VOICE_INPUT_QUEUE_MS',
  'VOICE_LIVE_MAX_MS',
  'VOICE_LIVE_WARNING_MS',
  'VOICE_OUTPUT_QUEUE_MS',
  'VOICE_RECONNECT_MS',
] as const;

export type StorageSafety = Pick<BudgetConfig,
  'maxMessageBytes' | 'maxDocumentBytes' | 'maxManifestBytes' | 'maxPageSize'
  | 'defaultPageSize' | 'connectTimeoutMs' | 'persistenceTimeoutMs' | 'shutdownDrainMs'>;

export type EncryptionBootstrap =
  | { status: 'ready'; key: Uint8Array }
  | { status: 'missing' | 'invalid' };

export type BootstrapConfig = {
  port: number; frontendOrigin: string; nodeEnv: 'development' | 'test' | 'production';
  identity: { userId: string };
  persistence: { profile: PersistenceProfile; mongoUri: string; mongoDbName: string;
    documentHeadroomBytes: number };
  topology: { executor: 'single-process'; localCrashRecovery: boolean };
  safety: StorageSafety; encryption: EncryptionBootstrap;
  calendar?: CalendarBootstrap | null;
  livekit?: LiveKitConfig | null;
  workos?: WorkosBootstrap | null;
};

export type WorkosBootstrap = { apiKey: string; clientId: string; cookiePassword: string };

const optionalPositiveInt = z.coerce.number().int().positive().optional()
  .refine((value) => value === undefined || Number.isSafeInteger(value));
const optionalTimerMs = z.coerce.number().int().positive().max(MAX_NODE_TIMER_MS).optional()
  .refine((value) => value === undefined || Number.isSafeInteger(value));
const optionalPageSize = z.coerce.number().int().positive().max(50).optional()
  .refine((value) => value === undefined || Number.isSafeInteger(value));

const bootstrapEnvSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    AURVIN_USER_ID: z.string().min(1).max(128).default('aurvin-dev-user'),
    PERSISTENCE_PROFILE: persistenceProfileSchema.default('unknown'),
    MONGODB_URI: z.string().default(''),
    MONGODB_DB_NAME: z.string().min(1).default('aurvin'),
    AURVIN_EXECUTOR_TOPOLOGY: z.literal('single-process').default('single-process'),
    AURVIN_LOCAL_CRASH_RECOVERY: z.enum(['true', 'false']).default('false'),
    AURVIN_CONFIG_ENCRYPTION_KEY: z.string().optional(),
    MAX_MESSAGE_BYTES: optionalPositiveInt,
    MAX_DOCUMENT_BYTES: optionalPositiveInt,
    MAX_MANIFEST_BYTES: optionalPositiveInt,
    MAX_PAGE_SIZE: optionalPageSize,
    DEFAULT_PAGE_SIZE: optionalPositiveInt,
    CONNECT_TIMEOUT_MS: optionalTimerMs,
    PERSISTENCE_TIMEOUT_MS: optionalTimerMs,
    SHUTDOWN_DRAIN_MS: optionalTimerMs,
  })
  .passthrough();

function loadWorkosBootstrap(env: Record<string, string | undefined>): WorkosBootstrap | null {
  const values = [env.WORKOS_API_KEY ?? '', env.WORKOS_CLIENT_ID ?? '', env.WORKOS_COOKIE_PASSWORD ?? ''];
  if (values.every(v => v === '')) return null;
  if (values.some(v => v === '' || v !== v.trim() || /[\u0000-\u001f\u007f]/.test(v) || v.length > 4096)) configurationError();
  const [apiKey, clientId, cookiePassword] = values as [string, string, string];
  if (cookiePassword.length < 32) configurationError();
  return { apiKey, clientId, cookiePassword };
}

function configurationError(): never {
  throw new AppError(
    'CONFIGURATION_ERROR',
    'Invalid application configuration.',
  );
}

function parseFrontendOrigin(
  value: string,
  nodeEnv: BootstrapConfig['nodeEnv'],
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    configurationError();
  }
  if (parsed.origin !== value) configurationError();
  if (parsed.protocol === 'https:') return value;
  if (
    parsed.protocol === 'http:' &&
    nodeEnv === 'development' &&
    DEV_HTTP_HOSTS.has(parsed.hostname)
  ) {
    return value;
  }
  configurationError();
}

function parseEncryptionKey(value: string | undefined): EncryptionBootstrap {
  if (value === undefined || value === '') return { status: 'missing' };
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return { status: 'invalid' };
  const key = Buffer.from(value, 'base64');
  return key.byteLength === 32 && key.toString('base64') === value
    ? { status: 'ready', key: Uint8Array.from(key) }
    : { status: 'invalid' };
}

export function obsoleteManageableNames(
  env: Record<string, string | undefined>,
): string[] {
  return LEGACY_MANAGEABLE_ENV_NAMES
    .filter((name) => Object.hasOwn(env, name) && env[name] !== undefined)
    .slice()
    .sort();
}

export function legacyConfigWarning(
  env: Record<string, string | undefined>,
): string | null {
  const names = obsoleteManageableNames(env);
  if (names.length === 0) return null;
  return `Ignored obsolete manageable environment settings: ${names.join(', ')}. Use Manage Aurvin or the explicit import command.`;
}

export function loadBootstrapConfig(
  env: Record<string, string | undefined>,
): BootstrapConfig {
  const parsed = bootstrapEnvSchema.safeParse(env);
  if (!parsed.success) configurationError();

  try {
    const data = parsed.data;
    const nodeEnv = data.NODE_ENV;
    const frontendOrigin = parseFrontendOrigin(data.FRONTEND_ORIGIN, nodeEnv);
    const profile = data.PERSISTENCE_PROFILE;
    const documentLimit = documentHeadroomBytes(profile);
    const localCrashRecovery = data.AURVIN_LOCAL_CRASH_RECOVERY === 'true';
    if (localCrashRecovery && profile !== 'native-mongodb') {
      throw new Error('local_requires_native');
    }

    const safety: StorageSafety = {
      maxMessageBytes: data.MAX_MESSAGE_BYTES ?? DEFAULT_BUDGETS.maxMessageBytes,
      maxDocumentBytes: data.MAX_DOCUMENT_BYTES ?? DEFAULT_BUDGETS.maxDocumentBytes,
      maxManifestBytes: data.MAX_MANIFEST_BYTES ?? DEFAULT_BUDGETS.maxManifestBytes,
      maxPageSize: data.MAX_PAGE_SIZE ?? DEFAULT_BUDGETS.maxPageSize,
      defaultPageSize: data.DEFAULT_PAGE_SIZE ?? DEFAULT_BUDGETS.defaultPageSize,
      connectTimeoutMs: data.CONNECT_TIMEOUT_MS ?? DEFAULT_BUDGETS.connectTimeoutMs,
      persistenceTimeoutMs:
        data.PERSISTENCE_TIMEOUT_MS ?? DEFAULT_BUDGETS.persistenceTimeoutMs,
      shutdownDrainMs: data.SHUTDOWN_DRAIN_MS ?? DEFAULT_BUDGETS.shutdownDrainMs,
    };
    if (
      safety.maxDocumentBytes > documentLimit ||
      safety.maxMessageBytes >= safety.maxDocumentBytes ||
      safety.maxManifestBytes >= safety.maxDocumentBytes ||
      safety.defaultPageSize > safety.maxPageSize
    ) {
      throw new Error('storage_budget_exceeds_document_headroom');
    }

    return {
      port: data.PORT,
      frontendOrigin,
      nodeEnv,
      identity: { userId: data.AURVIN_USER_ID },
      persistence: {
        profile,
        mongoUri: data.MONGODB_URI,
        mongoDbName: data.MONGODB_DB_NAME,
        documentHeadroomBytes: documentLimit,
      },
      topology: {
        executor: data.AURVIN_EXECUTOR_TOPOLOGY,
        localCrashRecovery,
      },
      safety,
      encryption: parseEncryptionKey(data.AURVIN_CONFIG_ENCRYPTION_KEY),
      calendar: loadCalendarBootstrap(env, frontendOrigin, data.PORT),
      livekit: parseLiveKitConfig(env, nodeEnv),
      workos: loadWorkosBootstrap(env),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    configurationError();
  }
}
