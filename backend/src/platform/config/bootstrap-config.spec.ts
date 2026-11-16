/**
 * ============================================================================
 * FILE: bootstrap-config.spec.ts
 * LOCATION: backend/src/platform/config/bootstrap-config.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify infrastructure-only bootstrap parsing, master-key state, and warnings.
 *
 * ROLE IN PROJECT:
 *    Proves environment-only settings stay off the manageable surface and that
 *    obsolete names are reported without values or secret leakage.
 *
 * KEY COMPONENTS:
 *    - Isolation tests: Ignore legacy manageable values during bootstrap.
 *    - Master-key tests: Canonical 32-byte base64 or missing/invalid state.
 *    - Source-map tests: Disjoint bootstrap and manageable name registries.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_ENV_NAMES,
  LEGACY_MANAGEABLE_ENV_NAMES,
  LIVEKIT_BOOTSTRAP_ENV_NAMES,
  loadBootstrapConfig,
  legacyConfigWarning,
  obsoleteManageableNames,
} from './bootstrap-config.js';
import { CALENDAR_BOOTSTRAP_ENV_NAMES } from './calendar-config.js';

const PREVIOUS_LOADER_ENV_NAMES = [
  'PORT',
  'FRONTEND_ORIGIN',
  'NODE_ENV',
  'AURVIN_USER_ID',
  'PERSISTENCE_PROFILE',
  'MONGODB_URI',
  'MONGODB_DB_NAME',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENROUTER_DATA_COLLECTION',
  'OPENROUTER_DISABLE_TRANSFORMS',
  'AURVIN_EXECUTOR_TOPOLOGY',
  'AURVIN_LOCAL_CRASH_RECOVERY',
  'MAX_INPUT_CHARS',
  'MAX_INPUT_TOKENS',
  'MAX_MESSAGES_IN_CONTEXT',
  'MAX_CONTEXT_TOKENS',
  'MAX_OUTPUT_TOKENS',
  'MODEL_MARGIN_TOKENS',
  'MAX_MESSAGE_BYTES',
  'MAX_DOCUMENT_BYTES',
  'MAX_MANIFEST_BYTES',
  'MAX_PAGE_SIZE',
  'DEFAULT_PAGE_SIZE',
  'TITLE_MAX_CHARS',
  'MAX_CONCURRENT_GENERATIONS_PER_PROCESS',
  'MAX_REQUESTS_PER_MINUTE_PER_USER',
  'RETRY_MAX_ATTEMPTS',
  'RETRY_BASE_DELAY_MS',
  'RETRY_MAX_DELAY_MS',
  'CONNECT_TIMEOUT_MS',
  'FIRST_OUTPUT_TIMEOUT_MS',
  'IDLE_STREAM_TIMEOUT_MS',
  'TOTAL_RUN_TIMEOUT_MS',
  'PERSISTENCE_TIMEOUT_MS',
  'SHUTDOWN_DRAIN_MS',
  'DEEPGRAM_API_KEY',
  'ENABLE_DICTATION_MODE',
  'ENABLE_LIVE_VOICE_MODE',
  'DEEPGRAM_API_BASE',
  'DEEPGRAM_DICTATION_MODEL',
  'DEEPGRAM_LIVE_MODEL',
  'DEEPGRAM_TTS_MODEL',
  'DEEPGRAM_DICTATION_ENDPOINTING_MS',
  'DEEPGRAM_SPOKEN_PUNCTUATION',
  'DEEPGRAM_KEYTERMS',
  'DEEPGRAM_FLUX_EOT_THRESHOLD',
  'DEEPGRAM_FLUX_EOT_TIMEOUT_MS',
  'VOICE_DICTATION_MAX_MS',
  'VOICE_LIVE_MAX_MS',
  'VOICE_LIVE_WARNING_MS',
  'VOICE_IDLE_WARNING_MS',
  'VOICE_IDLE_EXIT_AFTER_WARNING_MS',
  'VOICE_FINALIZATION_MS',
  'VOICE_RECONNECT_MS',
  'VOICE_CONNECT_MS',
  'VOICE_INPUT_QUEUE_MS',
  'VOICE_OUTPUT_QUEUE_MS',
  'VOICE_IDENTITY_CONCURRENT',
  'VOICE_GLOBAL_CONCURRENT',
  'VOICE_IDENTITY_DAILY_MINUTES',
  'VOICE_GLOBAL_DAILY_MINUTES',
  'VOICE_DAILY_SPEND_USD',
  'DEEPGRAM_NOVA_RATE_PER_MIN_USD',
  'DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD',
  'DEEPGRAM_FLUX_TTS_RATE_PER_1K_CHARS_USD',
] as const;

describe('loadBootstrapConfig', () => {
  it('ignores even malformed legacy values without copying or exposing them', () => {
    const env = { OPENROUTER_API_KEY: 'fixture-secret-A', OPENROUTER_MODEL: 'fixture/model',
      MAX_INPUT_CHARS: 'not-a-number', ENABLE_LIVE_VOICE_MODE: 'not-a-boolean',
      DEEPGRAM_API_KEY: 'fixture-secret-B', MONGODB_DB_NAME: 'fixture-db' };
    const b = loadBootstrapConfig(env);
    expect(b.persistence.mongoDbName).toBe('fixture-db');
    expect(b).not.toHaveProperty('openRouter');
    expect(b).not.toHaveProperty('voice');
    expect(b).not.toHaveProperty('budgets');
    expect(b.encryption).toEqual({ status: 'missing' });
    const names = obsoleteManageableNames(env);
    expect(names).toEqual(['DEEPGRAM_API_KEY', 'ENABLE_LIVE_VOICE_MODE',
      'MAX_INPUT_CHARS', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL']);
    const warning = legacyConfigWarning(env)!;
    expect(warning).toContain(names.join(', '));
    for (const value of Object.values(env)) expect(warning).not.toContain(value);
    expect(JSON.stringify(b)).not.toContain('fixture-secret');
  });

  it('accepts only canonical base64 encoding of exactly 32 bytes', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const b = loadBootstrapConfig({ AURVIN_CONFIG_ENCRYPTION_KEY: key });
    expect(b.encryption.status).toBe('ready');
    if (b.encryption.status === 'ready') expect([...b.encryption.key]).toEqual([...Buffer.alloc(32, 7)]);
    for (const invalid of [' ', key.trimEnd().slice(0, -1), key + '\n',
      Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'),
      '!'.repeat(44), key.replace(/=/g, '')]) {
      expect(loadBootstrapConfig({ AURVIN_CONFIG_ENCRYPTION_KEY: invalid }).encryption)
        .toEqual({ status: 'invalid' });
    }
    expect(loadBootstrapConfig({ AURVIN_CONFIG_ENCRYPTION_KEY: '' }).encryption)
      .toEqual({ status: 'missing' });
  });

  it('parses all 18 infrastructure fields and explicit local recovery', () => {
    const key = Buffer.alloc(32, 1).toString('base64');
    const b = loadBootstrapConfig({
      PORT: '8080',
      FRONTEND_ORIGIN: 'https://aurvin.example',
      NODE_ENV: 'production',
      AURVIN_USER_ID: 'operator-1',
      PERSISTENCE_PROFILE: 'native-mongodb',
      MONGODB_URI: 'mongodb://localhost:27017',
      MONGODB_DB_NAME: 'aurvin_prod',
      AURVIN_EXECUTOR_TOPOLOGY: 'single-process',
      AURVIN_LOCAL_CRASH_RECOVERY: 'true',
      AURVIN_CONFIG_ENCRYPTION_KEY: key,
      MAX_MESSAGE_BYTES: '4096',
      MAX_DOCUMENT_BYTES: '100000',
      MAX_MANIFEST_BYTES: '2048',
      MAX_PAGE_SIZE: '10',
      DEFAULT_PAGE_SIZE: '5',
      CONNECT_TIMEOUT_MS: '1234',
      PERSISTENCE_TIMEOUT_MS: '2345',
      SHUTDOWN_DRAIN_MS: '3456',
    });
    expect(b.port).toBe(8080);
    expect(b.frontendOrigin).toBe('https://aurvin.example');
    expect(b.nodeEnv).toBe('production');
    expect(b.identity.userId).toBe('operator-1');
    expect(b.persistence).toEqual({
      profile: 'native-mongodb',
      mongoUri: 'mongodb://localhost:27017',
      mongoDbName: 'aurvin_prod',
      documentHeadroomBytes: 1_800_000,
    });
    expect(b.topology).toEqual({ executor: 'single-process', localCrashRecovery: true });
    expect(b.safety).toEqual({
      maxMessageBytes: 4096,
      maxDocumentBytes: 100000,
      maxManifestBytes: 2048,
      maxPageSize: 10,
      defaultPageSize: 5,
      connectTimeoutMs: 1234,
      persistenceTimeoutMs: 2345,
      shutdownDrainMs: 3456,
    });
    expect(b.encryption.status).toBe('ready');
    expect(b.calendar).toBeNull();
    expect(b.livekit).toBeNull();
  });

  it('parses LiveKit bootstrap settings when complete and fails closed on partial or insecure values', () => {
    const b = loadBootstrapConfig({
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'fixture-livekit-secret',
    });
    expect(b.livekit).toEqual({
      url: 'ws://127.0.0.1:7880',
      apiKey: 'devkey',
      apiSecret: 'fixture-livekit-secret',
    });
    for (const bad of [
      { LIVEKIT_URL: 'ws://127.0.0.1:7880' },
      { LIVEKIT_URL: 'ws://remote.example:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'fixture-livekit-secret' },
      { NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://aurvin.example', LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'fixture-livekit-secret' },
    ]) {
      expect(() => loadBootstrapConfig(bad)).toThrow('Invalid application configuration.');
    }
  });

  it.each([
    ['invalid port', { PORT: '0' }],
    ['port overflow', { PORT: '65536' }],
    ['remote HTTP origin', { FRONTEND_ORIGIN: 'http://example.com' }],
    ['origin credentials', { FRONTEND_ORIGIN: 'https://user:pass@aurvin.example' }],
    ['origin path', { FRONTEND_ORIGIN: 'https://aurvin.example/admin' }],
    ['origin query', { FRONTEND_ORIGIN: 'https://aurvin.example?x=1' }],
    ['origin fragment', { FRONTEND_ORIGIN: 'https://aurvin.example#x' }],
    ['trailing origin slash', { FRONTEND_ORIGIN: 'https://aurvin.example/' }],
    ['production localhost HTTP', { NODE_ENV: 'production', FRONTEND_ORIGIN: 'http://localhost:5173' }],
    ['test remote HTTP', { NODE_ENV: 'test', FRONTEND_ORIGIN: 'http://example.com' }],
    ['invalid topology', { AURVIN_EXECUTOR_TOPOLOGY: 'multi-replica' }],
    ['empty user id', { AURVIN_USER_ID: '' }],
    ['invalid profile', { PERSISTENCE_PROFILE: 'cosmos' }],
    ['empty db name', { MONGODB_DB_NAME: '' }],
    ['local recovery without native', { AURVIN_LOCAL_CRASH_RECOVERY: 'true' }],
    ['empty safety integer', { MAX_MESSAGE_BYTES: '' }],
    ['document above headroom', { MAX_DOCUMENT_BYTES: '1800001' }],
    ['message at document size', { MAX_MESSAGE_BYTES: '1800000' }],
    ['default page above max', { DEFAULT_PAGE_SIZE: '51', MAX_PAGE_SIZE: '50' }],
    ['timer overflow', { CONNECT_TIMEOUT_MS: '2147483648' }],
  ])('rejects %s', (_name, env) => {
    expect(() => loadBootstrapConfig(env)).toThrow('Invalid application configuration.');
  });

  it('accepts HTTPS and development loopback HTTP origins', () => {
    expect(loadBootstrapConfig({ FRONTEND_ORIGIN: 'https://aurvin.example' }).frontendOrigin)
      .toBe('https://aurvin.example');
    expect(loadBootstrapConfig({ FRONTEND_ORIGIN: 'http://localhost:5173' }).frontendOrigin)
      .toBe('http://localhost:5173');
    expect(loadBootstrapConfig({ FRONTEND_ORIGIN: 'http://127.0.0.1:5173' }).frontendOrigin)
      .toBe('http://127.0.0.1:5173');
    expect(loadBootstrapConfig({ FRONTEND_ORIGIN: 'http://[::1]:5173' }).frontendOrigin)
      .toBe('http://[::1]:5173');
  });

  it('leaves HTTPS admin operation unchanged when Calendar is absent', () => {
    const b = loadBootstrapConfig({
      NODE_ENV: 'production',
      FRONTEND_ORIGIN: 'https://aurvin.example',
    });
    expect(b.frontendOrigin).toBe('https://aurvin.example');
    expect(b.calendar).toBeNull();
    expect(b).not.toHaveProperty('openRouter');
  });

  it('keeps blank WorkOS diagnostic-only and validates complete private setup', () => {
    expect(loadBootstrapConfig({}).workos).toBeNull();
    expect(loadBootstrapConfig({ WORKOS_API_KEY: '', WORKOS_CLIENT_ID: '', WORKOS_COOKIE_PASSWORD: '' }).workos).toBeNull();
    expect(() => loadBootstrapConfig({ WORKOS_API_KEY: 'sk_fixture' })).toThrow('Invalid application configuration.');
    expect(() => loadBootstrapConfig({ WORKOS_API_KEY: 'sk_fixture', WORKOS_CLIENT_ID: 'client_fixture', WORKOS_COOKIE_PASSWORD: 'short' })).toThrow();
    const env = { WORKOS_API_KEY: 'sk_fixture', WORKOS_CLIENT_ID: 'client_fixture', WORKOS_COOKIE_PASSWORD: 'f'.repeat(32) };
    expect(loadBootstrapConfig(env).workos).toEqual({ apiKey: env.WORKOS_API_KEY,
      clientId: env.WORKOS_CLIENT_ID, cookiePassword: env.WORKOS_COOKIE_PASSWORD });
    expect(legacyConfigWarning(env)).toBeNull();
    for (const name of Object.keys(env)) expect(BOOTSTRAP_ENV_NAMES).toContain(name);
    expect(() => loadBootstrapConfig({ ...env, WORKOS_API_KEY: 'sk_fixture\n' })).toThrow();
  });
});

describe('legacyConfigWarning', () => {
  it('reports empty legacy values and ignores unknown or inherited names', () => {
    expect(obsoleteManageableNames({ OPENROUTER_API_KEY: '', MAX_INPUT_CHARS: '' }))
      .toEqual(['MAX_INPUT_CHARS', 'OPENROUTER_API_KEY']);
    expect(legacyConfigWarning({
      PORT: '3000',
      AWS_SECRET_ACCESS_KEY: 'fixture-secret',
      OPENROUTER_TRACE: '1',
    })).toBeNull();
    const inherited = Object.create({ OPENROUTER_API_KEY: 'inherited-secret' }) as Record<string, string | undefined>;
    inherited.MONGODB_DB_NAME = 'aurvin';
    expect(obsoleteManageableNames(inherited)).toEqual([]);
    expect(legacyConfigWarning({ AURVIN_CONFIG_ENCRYPTION_KEY: 'not-a-key' })).toBeNull();
  });
});

describe('configuration source map', () => {
  it('classifies previous loader names into exactly one source class', () => {
    const bootstrap = new Set<string>(BOOTSTRAP_ENV_NAMES);
    const manageable = new Set<string>(LEGACY_MANAGEABLE_ENV_NAMES);
    expect(BOOTSTRAP_ENV_NAMES).toHaveLength(
      21 + CALENDAR_BOOTSTRAP_ENV_NAMES.length + LIVEKIT_BOOTSTRAP_ENV_NAMES.length,
    );
    for (const name of bootstrap) expect(manageable.has(name)).toBe(false);
    for (const name of [...CALENDAR_BOOTSTRAP_ENV_NAMES, ...LIVEKIT_BOOTSTRAP_ENV_NAMES]) {
      expect(bootstrap.has(name)).toBe(true);
      expect(manageable.has(name)).toBe(false);
    }
    const previous = new Set([...PREVIOUS_LOADER_ENV_NAMES, 'AURVIN_CONFIG_ENCRYPTION_KEY']);
    const union = [...bootstrap, ...manageable].filter(name => previous.has(name)).sort();
    expect(union).toEqual([...previous].sort());
    for (const name of [
      'VOICE_DICTATION_WARNING_MS',
      'PATH',
      'SystemRoot',
      'TEMP',
      'TMP',
      'ComSpec',
      'AURVIN_TEST_MONGODB_URI',
      'AURVIN_TEST_DB_PREFIX',
      'AURVIN_AZURE_TEST_FACTS_JSON',
      'AURVIN_AZURE_TEST_URI',
      'AURVIN_AZURE_TEST_DB_NAME',
      'AURVIN_AZURE_TEST_AUTHORIZED',
      'AURVIN_LIVE_SMOKE',
      'AURVIN_P10_LOAD',
      'AURVIN_VOICE_PILOT_EVIDENCE',
      'AURVIN_FIXTURE_SCRIPT',
      'AURVIN_FIXTURE_KEY',
      'VITE_API_BASE',
      'OPENROUTER_SESSION_ID',
      'OPENROUTER_TRACE',
    ]) {
      expect(bootstrap.has(name)).toBe(false);
      expect(manageable.has(name)).toBe(false);
    }
  });
});
