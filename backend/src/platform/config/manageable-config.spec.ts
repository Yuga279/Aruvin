/**
 * ============================================================================
 * FILE: manageable-config.spec.ts
 * LOCATION: backend/src/platform/config/manageable-config.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify safe defaults and later bootstrap-aware settings projection.
 *
 * ROLE IN PROJECT:
 *    Ensures default settings are detached copies and remain unconfigured until
 *    explicit validation and snapshot helpers are added.
 *
 * KEY COMPONENTS:
 *    - Default isolation tests: Fresh objects and arrays on every call.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { loadBootstrapConfig } from './bootstrap-config.js';
import {
  buildRuntimeSnapshot,
  composeRuntimeBudgets,
  defaultManageableSettings,
  validateManageableSettings,
} from './manageable-config.js';
import type { ManageableSettings } from '../../contracts/admin-config-wire.js';

describe('defaultManageableSettings', () => {
  it('returns detached default objects and arrays', () => {
    const first = defaultManageableSettings();
    const second = defaultManageableSettings();
    first.deepgram.keyterms.push('changed');
    first.voice.enabledModes.dictation = true;
    first.chat.maxOutputTokens = 1;
    expect(second.deepgram.keyterms).toEqual([]);
    expect(second.voice.enabledModes.dictation).toBe(false);
    expect(second.chat.maxOutputTokens).toBe(2048);
  });
});

describe('validateManageableSettings', () => {
  it('composes shared safety without accepting it as a settings override', () => {
    const b = loadBootstrapConfig({ CONNECT_TIMEOUT_MS: '9000', MAX_MESSAGE_BYTES: '16000' });
    const s = defaultManageableSettings();
    s.voice.limits.connectMs = 9000;
    s.chat.maxOutputTokens = 1000;
    const budgets = composeRuntimeBudgets(validateManageableSettings(s, b), b.safety);
    expect(budgets.connectTimeoutMs).toBe(9000);
    expect(budgets.maxMessageBytes).toBe(16000);
    expect(budgets.maxConcurrentAttemptsPerSession).toBe(1);
    expect(() => validateManageableSettings({ ...s,
      chat: { ...s.chat, maxInputTokens: 16001 } }, b)).toThrow();
    expect(() => validateManageableSettings({ ...s,
      voice: { ...s.voice, limits: { ...s.voice.limits, connectMs: 9001 } } }, b)).toThrow();
  });

  it('freezes a detached revision without copying secrets into settings', () => {
    const b = loadBootstrapConfig({});
    const settings = defaultManageableSettings();
    settings.openRouter.modelId = 'fixture/model';
    const candidate = { revision: 3, settings,
      credentials: { openrouter: 'fixture-A', deepgram: 'fixture-B' } };
    const limits = { modelId: 'fixture/model', contextTokens: 32768,
      outputTokens: 4096, supportsMaxTokens: true, source: 'fixture' as const };
    const snap = buildRuntimeSnapshot(b, candidate, limits);
    settings.chat.maxOutputTokens = 512;
    settings.deepgram.keyterms.push('changed');
    candidate.credentials.openrouter = 'fixture-C';
    limits.outputTokens = 1;
    expect(snap.revision).toBe(3);
    expect(snap.budgets.maxOutputTokens).toBe(2048);
    expect(snap.openRouter.apiKey).toBe('fixture-A');
    expect(snap.voice.deepgram.apiKey).toBe('fixture-B');
    expect(snap.modelLimits?.outputTokens).toBe(4096);
    expect(snap.settings.deepgram.keyterms).toEqual([]);
    expect(Object.isFrozen(snap.settings.deepgram.keyterms)).toBe(true);
    expect(Object.isFrozen(snap.voice.deepgram)).toBe(true);
    expect(JSON.stringify(snap.settings)).not.toContain('fixture-A');
  });

  it.each([
    ['context starved by output+margin', (s: ManageableSettings) => {
      s.chat.maxContextTokens = 2000;
      s.chat.maxOutputTokens = 1500;
      s.chat.modelMarginTokens = 600;
      return s;
    }],
    ['input above usable reserve', (s: ManageableSettings) => {
      s.chat.maxInputTokens = 14_000;
      return s;
    }],
    ['first output above total', (s: ManageableSettings) => {
      s.chat.firstOutputTimeoutMs = 180_001;
      return s;
    }],
    ['idle above total', (s: ManageableSettings) => {
      s.chat.idleStreamTimeoutMs = 180_001;
      return s;
    }],
    ['retry max below base', (s: ManageableSettings) => {
      s.chat.retryBaseDelayMs = 800;
      s.chat.retryMaxDelayMs = 500;
      return s;
    }],
    ['retry max above total', (s: ManageableSettings) => {
      s.chat.retryMaxDelayMs = 180_001;
      return s;
    }],
    ['timer overflow', (s: ManageableSettings) => {
      s.chat.totalRunTimeoutMs = 2_147_483_648;
      return s;
    }],
    ['voice connect above shared', (s: ManageableSettings) => {
      s.voice.limits.connectMs = 10_001;
      return s;
    }],
    ['input queue 4071', (s: ManageableSettings) => {
      s.voice.limits.inputQueueMs = 4071;
      return s;
    }],
    ['output queue 2727', (s: ManageableSettings) => {
      s.voice.limits.outputQueueMs = 2727;
      return s;
    }],
    ['unsafe daily minutes', (s: ManageableSettings) => {
      s.voice.quotas.globalDailyMinutes = 35_792;
      s.voice.quotas.identityDailyMinutes = 35_792;
      return s;
    }],
    ['spend with unknown rates', (s: ManageableSettings) => {
      s.voice.quotas.dailySpendUsd = 1;
      return s;
    }],
  ])('rejects %s', (_name, mutate) => {
    const b = loadBootstrapConfig({});
    expect(() => validateManageableSettings(mutate(defaultManageableSettings()), b)).toThrow(
      'Invalid application configuration.',
    );
  });

  it.each([
    ['input queue 4070', (s: ManageableSettings) => {
      s.voice.limits.inputQueueMs = 4070;
      return s;
    }],
    ['output queue 2726', (s: ManageableSettings) => {
      s.voice.limits.outputQueueMs = 2726;
      return s;
    }],
    ['independent dictation flag', (s: ManageableSettings) => {
      s.voice.enabledModes.dictation = true;
      return s;
    }],
    ['independent live flag', (s: ManageableSettings) => {
      s.voice.enabledModes.live = true;
      return s;
    }],
  ])('accepts %s', (_name, mutate) => {
    const b = loadBootstrapConfig({});
    expect(validateManageableSettings(mutate(defaultManageableSettings()), b)).toBeTruthy();
  });

  it('rejects mismatched, undersized, nonfinite, or bypassed model limits', () => {
    const b = loadBootstrapConfig({});
    const settings = defaultManageableSettings();
    settings.openRouter.modelId = 'fixture/model';
    const candidate = {
      revision: 1,
      settings,
      credentials: { openrouter: 'fixture-A', deepgram: null as string | null },
    };
    const valid = {
      modelId: 'fixture/model', contextTokens: 32768, outputTokens: 4096,
      supportsMaxTokens: true, source: 'fixture' as const,
    };
    expect(() => buildRuntimeSnapshot(b, candidate, null)).toThrow();
    expect(() => buildRuntimeSnapshot(b, candidate, { ...valid, modelId: 'other' })).toThrow();
    expect(() => buildRuntimeSnapshot(b, candidate, { ...valid, contextTokens: 100 })).toThrow();
    expect(() => buildRuntimeSnapshot(b, candidate, { ...valid, outputTokens: 1 })).toThrow();
    expect(() => buildRuntimeSnapshot(b, candidate, { ...valid, supportsMaxTokens: false })).toThrow();
    expect(() => buildRuntimeSnapshot(b, candidate, { ...valid, contextTokens: Number.NaN })).toThrow();
  });

  it('leaves no usable secret when credentials are null and voice flags are true', () => {
    const b = loadBootstrapConfig({});
    const settings = defaultManageableSettings();
    settings.voice.enabledModes = { dictation: true, live: true };
    const snap = buildRuntimeSnapshot(b, {
      revision: 0,
      settings,
      credentials: { openrouter: null, deepgram: null },
    }, null);
    expect(snap.openRouter.apiKey).toBe('');
    expect(snap.voice.deepgram.apiKey).toBe('');
    expect(snap.voice.enabledModes).toEqual({ dictation: true, live: true });
    expect(snap.modelLimits).toBeNull();
  });

  it('projects frozen LiveKit bootstrap config onto snapshot.voice without exposing it in manageable settings', () => {
    const b = loadBootstrapConfig({
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'fixture-livekit-secret',
    });
    const settings = defaultManageableSettings();
    settings.voice.enabledModes = { dictation: true, live: true };
    const snap = buildRuntimeSnapshot(b, {
      revision: 2,
      settings,
      credentials: { openrouter: null, deepgram: 'fixture-deepgram' },
    }, null);
    expect(snap.voice.livekit).toEqual({
      url: 'ws://127.0.0.1:7880',
      apiKey: 'devkey',
      apiSecret: 'fixture-livekit-secret',
    });
    expect(Object.isFrozen(snap.voice.livekit)).toBe(true);
    expect(JSON.stringify(snap.settings)).not.toContain('fixture-livekit-secret');
    expect(JSON.stringify(snap.settings)).not.toContain('devkey');
  });

  it('projects unchanged legacy idle fields and the independent Flux timeout', () => {
    const settings = defaultManageableSettings();
    settings.voice.limits.liveMaxMs = 30_000;
    settings.voice.limits.liveWarningMs = 20_000;
    const snapshot = buildRuntimeSnapshot(loadBootstrapConfig({}), {
      revision: 1, settings, credentials: { openrouter: null, deepgram: null },
    }, null);
    expect(snapshot.voice.limits.idleWarningMs).toBe(60_000);
    expect(snapshot.voice.limits.idleExitAfterWarningMs).toBe(30_000);
    expect(snapshot.voice.deepgram.eotTimeoutMs).toBe(5000);
    expect(Object.keys(snapshot.settings.voice).sort())
      .toEqual(['dictationWarningMs', 'enabledModes', 'limits', 'quotas']);
  });
});
