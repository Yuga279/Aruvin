/**
 * ============================================================================
 * FILE: legacy-config-import.spec.ts
 * LOCATION: backend/src/platform/config/legacy-config-import.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify explicit legacy-environment import projection without side effects.
 *
 * ROLE IN PROJECT:
 *    Ensures one-time import reads only manageable names, preserves disabled
 *    voice and unknown rates, and refuses unsafe policy or bound changes.
 *
 * KEY COMPONENTS:
 *    - Mapping tests: Known names, derived warning, and credential extraction.
 *    - Refusal tests: Policy weakening, empty numbers, and unknown rates+spend.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { LEGACY_MANAGEABLE_ENV_NAMES } from './bootstrap-config.js';
import { loadBootstrapConfig } from './bootstrap-config.js';
import { parseLegacyConfigImport } from './legacy-config-import.js';

describe('parseLegacyConfigImport', () => {
  it('imports only manageable names while preserving disabled voice and unknown rates', () => {
    const b = loadBootstrapConfig({ CONNECT_TIMEOUT_MS: '12000' });
    const imported = parseLegacyConfigImport({ OPENROUTER_API_KEY: 'fixture-openrouter',
      OPENROUTER_MODEL: 'fixture/model', DEEPGRAM_API_KEY: 'fixture-deepgram',
      ENABLE_DICTATION_MODE: 'false', ENABLE_LIVE_VOICE_MODE: 'false',
      VOICE_DICTATION_MAX_MS: '10000', DEEPGRAM_API_BASE: 'wss://api.eu.deepgram.com',
      DEEPGRAM_KEYTERMS: ' Aurvin, , LangGraph ', DEEPGRAM_NOVA_RATE_PER_MIN_USD: '',
      MONGODB_URI: 'ignored-private-uri', CONNECT_TIMEOUT_MS: '1',
    }, b);
    expect(imported.credentials).toEqual({ openrouter: 'fixture-openrouter', deepgram: 'fixture-deepgram' });
    expect(imported.settings.voice.enabledModes).toEqual({ dictation: false, live: false });
    expect(imported.settings.voice.dictationWarningMs).toBeNull();
    expect(imported.settings.deepgram.region).toBe('eu');
    expect(imported.settings.deepgram.keyterms).toEqual(['Aurvin', 'LangGraph']);
    expect(imported.settings.deepgram.rates.novaPerMinuteUsd).toBeNull();
    expect(imported.importedNames).not.toContain('MONGODB_URI');
    expect(imported.importedNames).not.toContain('CONNECT_TIMEOUT_MS');
    expect(imported.settings).not.toHaveProperty('persistence');
  });

  it('refuses unsafe import rather than normalizing policy or reporting values', () => {
    const b = loadBootstrapConfig({});
    for (const env of [ { OPENROUTER_DATA_COLLECTION: 'allow' },
      { OPENROUTER_DISABLE_TRANSFORMS: 'false' }, { ENABLE_DICTATION_MODE: 'yes' },
      { MAX_INPUT_CHARS: '' }, { MAX_CONTEXT_TOKENS: '100' },
      { DEEPGRAM_API_BASE: 'wss://evil.invalid' }, { VOICE_DAILY_SPEND_USD: '1' },
    ]) expect(() => parseLegacyConfigImport({ ...env, DEEPGRAM_API_KEY: 'fixture-secret' }, b))
      .toThrow('Invalid application configuration.');
  });

  it.each([
    ['OPENROUTER_API_KEY', { OPENROUTER_API_KEY: 'fixture-openrouter' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.credentials.openrouter).toBe('fixture-openrouter')],
    ['OPENROUTER_MODEL', { OPENROUTER_MODEL: 'fixture/model' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.settings.openRouter.modelId).toBe('fixture/model')],
    ['OPENROUTER_DATA_COLLECTION', { OPENROUTER_DATA_COLLECTION: 'deny' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.settings.openRouter.dataCollection).toBe('deny')],
    ['OPENROUTER_DISABLE_TRANSFORMS', { OPENROUTER_DISABLE_TRANSFORMS: 'true' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.settings.openRouter.disableTransforms).toBe(true)],
    ['MAX_INPUT_CHARS', { MAX_INPUT_CHARS: '1000' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.settings.chat.maxInputChars).toBe(1000)],
    ['ENABLE_DICTATION_MODE', { ENABLE_DICTATION_MODE: 'true' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.settings.voice.enabledModes.dictation).toBe(true)],
    ['ENABLE_LIVE_VOICE_MODE', { ENABLE_LIVE_VOICE_MODE: 'true' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.settings.voice.enabledModes.live).toBe(true)],
    ['DEEPGRAM_TTS_MODEL', { DEEPGRAM_TTS_MODEL: 'flux-priya-en' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.settings.deepgram.ttsModel).toBe('flux-priya-en')],
    ['DEEPGRAM_NOVA_RATE_PER_MIN_USD zero', { DEEPGRAM_NOVA_RATE_PER_MIN_USD: '0' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.settings.deepgram.rates.novaPerMinuteUsd).toBe(0)],
    ['VOICE_CONNECT_MS', { VOICE_CONNECT_MS: '8000' }, (r: ReturnType<typeof parseLegacyConfigImport>) =>
      expect(r.settings.voice.limits.connectMs).toBe(8000)],
  ] as const)('maps %s', (_name, env, assert) => {
    const imported = parseLegacyConfigImport({ ...env }, loadBootstrapConfig({}));
    assert(imported);
  });

  it('treats missing numbers as defaults and empty numbers as errors', () => {
    const b = loadBootstrapConfig({});
    expect(parseLegacyConfigImport({}, b).settings.chat.maxInputChars).toBe(32000);
    expect(() => parseLegacyConfigImport({ MAX_OUTPUT_TOKENS: '' }, b)).toThrow(
      'Invalid application configuration.',
    );
    expect(parseLegacyConfigImport({ DEEPGRAM_FLUX_STT_RATE_PER_MIN_USD: '' }, b)
      .settings.deepgram.rates.fluxSttPerMinuteUsd).toBeNull();
  });

  it('does not import aliases, infrastructure, or test names', () => {
    const imported = parseLegacyConfigImport({
      OPENROUTER_TRACE: '1',
      OPENROUTER_SESSION_ID: 'sess',
      AURVIN_TEST_MONGODB_URI: 'mongodb://localhost',
      PATH: 'C:\\Windows',
    }, loadBootstrapConfig({}));
    expect(imported.importedNames).toEqual([]);
    expect(imported.credentials).toEqual({ openrouter: null, deepgram: null });
  });

  it('covers every manageable registry name', () => {
    expect(LEGACY_MANAGEABLE_ENV_NAMES.length).toBeGreaterThan(40);
    const imported = parseLegacyConfigImport(
      Object.fromEntries(LEGACY_MANAGEABLE_ENV_NAMES.map((name) => [name, undefined])),
      loadBootstrapConfig({}),
    );
    expect(imported.importedNames).toEqual([]);
  });
});
