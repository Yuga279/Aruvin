/**
 * ============================================================================
 * FILE: admin-config.spec.ts
 * LOCATION: backend/test/assembly/admin-config.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify central assembly prepares, opens, and publishes config safely.
 *
 * ROLE IN PROJECT:
 *    Covers detached snapshot preparation, single-bundle bootstrap, and
 *    confirmed-only publication without live providers or real databases.
 *
 * KEY COMPONENTS:
 *    - Pure preparation: unconfigured/configured/capped candidate projections.
 *    - Single owner: one guarded bundle, blank-key admin, chat not ready.
 * ============================================================================
 */

import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import {
  configurationAdapter,
  prepareConfigurationSnapshot,
  AppService,
} from '../../src/app.service.js';
import { actor, document, secret, at } from '../admin-config/fixtures.js';
import type { ConfigCasResult } from '../../src/contracts/config-runtime.js';

import { Admission } from '../../src/operations/admission.js';
import { observedRuntime } from '../../src/operations/observed-runtime.js';
import { Readiness } from '../../src/operations/readiness.js';
import { Telemetry } from '../../src/operations/telemetry.js';
import { options } from '../operations/fixtures.js';
import { assemblyFixture, deferred } from './admin-config-fixture.js';

describe('assembly preparation', () => {
  it('prepares unconfigured settings without a catalogue or runtime', async () => {
    const f = assemblyFixture();
    const candidate = {
      revision: 0,
      settings: defaultManageableSettings(),
      credentials: { openrouter: null, deepgram: null },
    };
    const snapshot = await prepareConfigurationSnapshot(
      f.bootstrap,
      candidate,
      f.assets,
      f.limits as never,
      f.fetcher as never,
      new AbortController().signal,
    );
    expect(snapshot.revision).toBe(0);
    expect(snapshot.modelLimits).toBeNull();
    expect(snapshot.openRouter.apiKey).toBe('');
    expect(snapshot.voice.enabledModes).toEqual({ dictation: false, live: false });
    expect(Object.isFrozen(snapshot.voice)).toBe(true);
    expect(f.limits).not.toHaveBeenCalled();
    expect(f.runtime).not.toHaveBeenCalled();
  });

  it('prepares configured settings only with matching catalogue limits', async () => {
    const f = assemblyFixture();
    const settings = defaultManageableSettings();
    settings.openRouter.modelId = 'fixture/model';
    const snapshot = await prepareConfigurationSnapshot(
      f.bootstrap,
      { revision: 1, settings, credentials: { openrouter: 'fixture-key', deepgram: null } },
      f.assets,
      f.limits as never,
      f.fetcher as never,
      new AbortController().signal,
    );
    expect(snapshot.revision).toBe(1);
    expect(snapshot.modelLimits?.modelId).toBe('fixture/model');
    expect(snapshot.openRouter.apiKey).toBe('fixture-key');
    expect(f.limits).toHaveBeenCalledTimes(1);
  });

  it('rejects configured settings when catalogue limits mismatch the model', async () => {
    const f = assemblyFixture();
    const settings = defaultManageableSettings();
    settings.openRouter.modelId = 'fixture/other-model';
    f.limits.mockResolvedValueOnce({
      modelId: 'fixture/model',
      contextTokens: 32768,
      outputTokens: 4096,
      supportsMaxTokens: true,
      source: 'fixture',
    });
    await expect(
      prepareConfigurationSnapshot(
        f.bootstrap,
        { revision: 1, settings, credentials: { openrouter: 'fixture-key', deepgram: null } },
        f.assets,
        f.limits as never,
        f.fetcher as never,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('rejects configured settings when catalogue output falls below the cap', async () => {
    const f = assemblyFixture();
    const settings = defaultManageableSettings();
    settings.openRouter.modelId = 'fixture/model';
    settings.chat.maxOutputTokens = 8192;
    await expect(
      prepareConfigurationSnapshot(
        f.bootstrap,
        { revision: 1, settings, credentials: { openrouter: 'fixture-key', deepgram: null } },
        f.assets,
        f.limits as never,
        f.fetcher as never,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('rejects cross-field settings without touching catalogue or runtime', async () => {
    const f = assemblyFixture();
    const settings = defaultManageableSettings();
    settings.voice.dictationWarningMs = settings.voice.limits.dictationMaxMs;
    await expect(
      prepareConfigurationSnapshot(
        f.bootstrap,
        { revision: 0, settings, credentials: { openrouter: null, deepgram: null } },
        f.assets,
        f.limits as never,
        f.fetcher as never,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(f.limits).not.toHaveBeenCalled();
    expect(f.runtime).not.toHaveBeenCalled();
  });

  it('rejects settings above fixed storage ceilings without a catalogue', async () => {
    const f = assemblyFixture();
    const settings = defaultManageableSettings();
    settings.chat.maxInputTokens = f.bootstrap.safety.maxMessageBytes + 1;
    await expect(
      prepareConfigurationSnapshot(
        f.bootstrap,
        { revision: 0, settings, credentials: { openrouter: null, deepgram: null } },
        f.assets,
        f.limits as never,
        f.fetcher as never,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(f.limits).not.toHaveBeenCalled();
  });

  it('leaves no snapshot behind when the catalogue cannot be verified', async () => {
    const f = assemblyFixture();
    const before = await prepareConfigurationSnapshot(
      f.bootstrap,
      { revision: 0, settings: defaultManageableSettings(), credentials: { openrouter: null, deepgram: null } },
      f.assets,
      f.limits as never,
      f.fetcher as never,
      new AbortController().signal,
    );
    const settings = defaultManageableSettings();
    settings.openRouter.modelId = 'fixture/model';
    f.limits.mockRejectedValueOnce(new Error('fixture catalogue unavailable'));
    await expect(
      prepareConfigurationSnapshot(
        f.bootstrap,
        { revision: 1, settings, credentials: { openrouter: 'fixture-key', deepgram: null } },
        f.assets,
        f.limits as never,
        f.fetcher as never,
        new AbortController().signal,
      ),
    ).rejects.toThrowError('fixture catalogue unavailable');
    expect(before.revision).toBe(0);
    expect(before.modelLimits).toBeNull();
  });

  it('adapts bootstrap infrastructure without environment keys or the master key', async () => {
    const f = assemblyFixture();
    const snapshot = await prepareConfigurationSnapshot(
      f.bootstrap,
      { revision: 0, settings: defaultManageableSettings(), credentials: { openrouter: null, deepgram: null } },
      f.assets,
      f.limits as never,
      f.fetcher as never,
      new AbortController().signal,
    );
    const adapted = configurationAdapter(f.bootstrap, snapshot);
    expect(adapted.port).toBe(f.bootstrap.port);
    expect(adapted.frontendOrigin).toBe(f.bootstrap.frontendOrigin);
    expect(adapted.identity).toEqual(f.bootstrap.identity);
    expect(adapted.budgets).toEqual(snapshot.budgets);
    expect(adapted.openRouter).toEqual(snapshot.openRouter);
    expect(adapted.openRouter.apiKey).toBe('');
    expect(adapted.voice.deepgram.apiKey).toBe('');
    expect(adapted).not.toHaveProperty('encryption');
    expect(JSON.stringify(adapted)).not.toContain('openrouter');
  });
});

describe('assembly bootstrap', () => {
  it('opens one bundle and keeps blank-key admin usable with chat not ready', async () => {
    const f = assemblyFixture();
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      expect(f.open).toHaveBeenCalledTimes(1);
      expect(f.repository.read).toHaveBeenCalledTimes(1);
      expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
      expect(f.runtime).toHaveBeenCalledTimes(1);
      expect(f.runtime.mock.calls[0]![0].currentConfig).toBe(service.currentConfig);
      expect(await service.adminConfig.read(actor)).toMatchObject({
        revision: 0, state: 'missing', activation: 'unconfigured',
      });
      expect((await service.operations.readiness.read()).acceptReady).toBe(false);
      expect(f.limits).not.toHaveBeenCalled();
    } finally {
      await service.operations.shutdown();
    }
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('boots a configured revision through read, decrypt, and preparation before admission', async () => {
    const f = assemblyFixture();
    const stored = document(1);
    stored.settings.openRouter.modelId = 'fixture/model';
    stored.credentials.openrouter = {
      envelope: f.credentials.seal('openrouter', secret), validatedAt: at,
    };
    f.seed(stored);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      expect(f.open).toHaveBeenCalledTimes(1);
      expect(f.repository.read).toHaveBeenCalledTimes(1);
      expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
      expect(f.limits).toHaveBeenCalledTimes(1);
      expect(f.runtime).toHaveBeenCalledTimes(1);
      expect(f.runtime.mock.calls[0]![0].currentConfig).toBe(service.currentConfig);
      expect(service.currentConfig.current()?.revision).toBe(1);
      expect(service.currentConfig.current()?.openRouter.modelId).toBe('fixture/model');
      expect(service.currentConfig.current()?.modelLimits?.modelId).toBe('fixture/model');
      expect(f.repository.read.mock.invocationCallOrder[0])
        .toBeLessThan(f.runtime.mock.invocationCallOrder[0]!);
      expect(f.limits.mock.invocationCallOrder[0])
        .toBeLessThan(f.runtime.mock.invocationCallOrder[0]!);
      expect(await service.adminConfig.read(actor)).toMatchObject({ revision: 1, state: 'stored' });
      expect((await service.operations.readiness.read()).acceptReady).toBe(true);
      expect(f.fetcher).not.toHaveBeenCalled();
    } finally {
      await service.operations.shutdown();
    }
  });

  it('constructs the production repository from the admitted owner store', async () => {
    const f = assemblyFixture();
    const service = await AppService.create(f.bootstrap, { ...f.ports, configRepository: undefined });
    try {
      expect(f.storeCollection).toHaveBeenCalledWith('config');
      expect(f.controlCollection).not.toHaveBeenCalled();
      expect(service.currentConfig.current()?.revision).toBe(0);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('ignores obsolete manageable env values instead of overlaying them', async () => {
    const f = assemblyFixture();
    vi.stubEnv('OPENROUTER_API_KEY', 'fixture-obsolete-key');
    vi.stubEnv('OPENROUTER_MODEL', 'fixture-obsolete-model');
    try {
      const service = await AppService.create(f.bootstrap, f.ports);
      try {
        expect(service.currentConfig.current()?.revision).toBe(0);
        expect(service.currentConfig.current()?.openRouter.apiKey).toBe('');
        expect(f.limits).not.toHaveBeenCalled();
      } finally {
        await service.operations.shutdown();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('leaves admin diagnostic without opening storage when no URI is configured', async () => {
    const f = assemblyFixture();
    const bootstrap = loadBootstrapConfig({
      NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173',
      AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    const service = await AppService.create(bootstrap, f.ports);
    try {
      expect(f.open).not.toHaveBeenCalled();
      expect(service.currentConfig.current()).toBeNull();
      expect((await service.operations.readiness.read()).acceptReady).toBe(false);
      await expect(service.adminConfig.read(actor)).rejects.toMatchObject({ code: 'CONFIG_STORAGE_UNAVAILABLE' });
      expect(f.fetcher).not.toHaveBeenCalled();
    } finally {
      await service.operations.shutdown();
    }
  });

  it('refuses unverified persistence profiles without opening a config store', async () => {
    const f = assemblyFixture();
    const bootstrap = loadBootstrapConfig({
      NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173',
      PERSISTENCE_PROFILE: 'cosmos-mongodb-ru', MONGODB_URI: 'fixture-only',
      AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    const service = await AppService.create(bootstrap, f.ports);
    try {
      expect(f.open).not.toHaveBeenCalled();
      expect(service.currentConfig.current()).toBeNull();
      expect((await service.operations.readiness.read()).acceptReady).toBe(false);
      await expect(service.adminConfig.read(actor)).rejects.toMatchObject({ code: 'CONFIG_STORAGE_UNAVAILABLE' });
    } finally {
      await service.operations.shutdown();
    }
  });

  it('stays diagnostic when the guarded open rejects without ownership conflict', async () => {
    const f = assemblyFixture();
    f.open.mockRejectedValueOnce(new AppError('NOT_READY', 'fixture storage unavailable'));
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      expect(f.open).toHaveBeenCalledTimes(1);
      expect(service.currentConfig.current()).toBeNull();
      expect((await service.operations.readiness.read())).toMatchObject({ live: true, acceptReady: false });
      await expect(service.adminConfig.read(actor)).rejects.toMatchObject({ code: 'CONFIG_STORAGE_UNAVAILABLE' });
      expect(f.fetcher).not.toHaveBeenCalled();
    } finally {
      await service.operations.shutdown();
    }
  });

  it('refuses startup hard when a competing executor owns the store', async () => {
    const f = assemblyFixture();
    f.open.mockRejectedValueOnce(new AppError('UNSUPPORTED_TOPOLOGY', 'fixture competing executor'));
    await expect(AppService.create(f.bootstrap, f.ports)).rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.runtime).not.toHaveBeenCalled();
  });

  it('keeps the pointer null and reports stored-invalid for a malformed document', async () => {
    const f = assemblyFixture();
    const malformed = { ...document(1), revision: 'nope' };
    f.seed(malformed as never);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      expect(service.currentConfig.current()).toBeNull();
      expect((await service.operations.readiness.read()).acceptReady).toBe(false);
      await expect(service.adminConfig.read(actor)).rejects.toMatchObject({ code: 'CONFIG_STORED_INVALID' });
      expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
      expect(f.repository.compareAndSwap).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(JSON.stringify(f.stored())).toContain('"revision":"nope"');
    } finally {
      await service.operations.shutdown();
    }
  });

  it('keeps the pointer null when the master key cannot open the envelope', async () => {
    const f = assemblyFixture();
    const stored = document(1);
    stored.settings.openRouter.modelId = 'fixture/model';
    stored.credentials.openrouter = {
      envelope: f.credentials.seal('openrouter', secret), validatedAt: at,
    };
    f.seed(stored);
    const bootstrap = loadBootstrapConfig({
      NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:5173',
      PERSISTENCE_PROFILE: 'native-mongodb', MONGODB_URI: 'fixture-injected-only',
      AURVIN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    });
    const service = await AppService.create(bootstrap, f.ports);
    try {
      expect(service.currentConfig.current()).toBeNull();
      expect((await service.operations.readiness.read()).acceptReady).toBe(false);
      expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.stored()).toEqual(stored);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('keeps the pointer null for a tampered credential envelope', async () => {
    const f = assemblyFixture();
    const stored = document(1);
    stored.settings.openRouter.modelId = 'fixture/model';
    const envelope = f.credentials.seal('openrouter', secret);
    const text = envelope.ciphertext;
    envelope.ciphertext = `${text.slice(0, -1)}${text.endsWith('A') ? 'B' : 'A'}`;
    stored.credentials.openrouter = { envelope, validatedAt: at };
    f.seed(stored);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      expect(service.currentConfig.current()).toBeNull();
      expect((await service.operations.readiness.read()).acceptReady).toBe(false);
      expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
      expect(f.stored()).toEqual(stored);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('keeps the pointer null for stored settings above fixed storage ceilings', async () => {
    const f = assemblyFixture();
    const stored = document(1);
    stored.settings.chat.maxInputTokens = f.bootstrap.safety.maxMessageBytes + 1;
    f.seed(stored);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      expect(service.currentConfig.current()).toBeNull();
      expect((await service.operations.readiness.read()).acceptReady).toBe(false);
      await expect(service.adminConfig.read(actor)).rejects.toMatchObject({ code: 'CONFIG_STORED_INVALID' });
      expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
      expect(f.limits).not.toHaveBeenCalled();
    } finally {
      await service.operations.shutdown();
    }
  });

  it('preserves archive reads while catalogue verification fails', async () => {
    const f = assemblyFixture();
    const stored = document(1);
    stored.settings.openRouter.modelId = 'fixture/model';
    stored.credentials.openrouter = {
      envelope: f.credentials.seal('openrouter', secret), validatedAt: at,
    };
    f.seed(stored);
    f.limits.mockRejectedValueOnce(new AppError('CONFIGURATION_ERROR', 'fixture catalogue unavailable'));
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      expect(service.currentConfig.current()).toBeNull();
      const ready = await service.operations.readiness.read();
      expect(ready).toMatchObject({ live: true, acceptReady: false });
      expect(ready.issues).toContain('model_limits');
      expect(await service.sessions.list('server-user', { cursor: null, limit: 20 }))
        .toEqual({ items: [], nextCursor: null });
      expect(f.fetcher).not.toHaveBeenCalled();
    } finally {
      await service.operations.shutdown();
    }
  });
});

function configuredSeed(f: ReturnType<typeof assemblyFixture>, revision = 1) {
  const stored = document(revision);
  stored.settings.openRouter.modelId = 'fixture/model';
  stored.credentials.openrouter = {
    envelope: f.credentials.seal('openrouter', secret), validatedAt: at,
  };
  f.seed(stored);
  return stored;
}

describe('assembly publication', () => {
  it('publishes only after a confirmed write without replacing owners', async () => {
    const f = assemblyFixture();
    const stored = document(1);
    stored.settings.openRouter.modelId = 'fixture/model';
    stored.credentials.openrouter = {
      envelope: f.credentials.seal('openrouter', secret), validatedAt: at,
    };
    f.seed(stored);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const old = service.currentConfig.current();
      const usage = service.voiceUsage;
      const sessions = service.voiceSessions;
      const write = deferred<ConfigCasResult>();
      const started = deferred<void>();
      vi.mocked(f.repository.compareAndSwap).mockImplementationOnce(async () => {
        started.resolve();
        return write.promise;
      });
      const settings = structuredClone(stored.settings);
      settings.chat.titleMaxChars = 70;
      const saving = service.adminConfig.saveSettings({
        protocolVersion: 1, expectedRevision: 1, settings,
      }, actor);
      await started.promise;
      expect(service.currentConfig.current()).toBe(old);
      write.resolve({
        outcome: 'confirmed',
        document: { ...stored, revision: 2, settings },
      });
      expect(await saving).toMatchObject({ revision: 2, activeRevision: 2 });
      expect(service.currentConfig.current()?.budgets.titleMaxChars).toBe(70);
      expect(service.voiceUsage).toBe(usage);
      expect(service.voiceSessions).toBe(sessions);
      expect(f.open).toHaveBeenCalledTimes(1);
      expect(f.runtime).toHaveBeenCalledTimes(1);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('shares one current config across runtime, http, and voice ports', async () => {
    const f = assemblyFixture();
    configuredSeed(f);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      expect(f.runtime.mock.calls[0]![0].currentConfig).toBe(service.currentConfig);
      const options = service.httpOptions(service.identity);
      expect(options.currentConfig?.current).toEqual(expect.any(Function));
    } finally {
      await service.operations.shutdown();
    }
  });

  it('applies voice and credential edits to new work while active snapshots stay put', async () => {
    const f = assemblyFixture();
    configuredSeed(f);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const before = service.currentConfig.current();
      const usageTotals = service.voiceUsage.snapshot();
      const settings = defaultManageableSettings();
      settings.openRouter.modelId = 'fixture/model';
      settings.voice.enabledModes = { dictation: true, live: false };
      settings.deepgram.rates = {
        novaPerMinuteUsd: 0.0043, fluxSttPerMinuteUsd: 0.004,
        fluxTtsPerThousandCharsUsd: 0.01,
      };
      const saved = await service.adminConfig.saveSettings({
        protocolVersion: 1, expectedRevision: 1, settings,
      }, actor);
      expect(saved).toMatchObject({ revision: 2, activeRevision: 2 });
      expect(service.currentConfig.current()?.voice.enabledModes)
        .toEqual({ dictation: true, live: false });
      expect(before?.voice.enabledModes).toEqual({ dictation: false, live: false });
      expect(before?.budgets.titleMaxChars).toBe(service.currentConfig.current()?.budgets.titleMaxChars);
      expect(service.voiceUsage.snapshot()).toMatchObject({
        active: usageTotals.active, sessions: usageTotals.sessions,
      });
      expect((await service.operations.readiness.read()).speech).toBe('unconfigured');
      const removed = await service.adminConfig.updateCredential('deepgram', {
        protocolVersion: 1, expectedRevision: 2, action: 'remove', confirm: true,
      }, actor);
      expect(removed).toMatchObject({ revision: 3, activeRevision: 3 });
      expect(service.currentConfig.current()?.voice.deepgram.apiKey).toBe('');
      expect((await service.operations.readiness.read()).acceptReady).toBe(true);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('enables dictation without a configured text model or catalogue', async () => {
    const f = assemblyFixture();
    f.seed(document(1));
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const settings = structuredClone(document(1).settings);
      settings.voice.enabledModes = { dictation: true, live: false };
      const saved = await service.adminConfig.saveSettings({
        protocolVersion: 1, expectedRevision: 1, settings,
      }, actor);
      expect(saved).toMatchObject({ revision: 2, activeRevision: 2 });
      expect(service.currentConfig.current()?.voice.enabledModes)
        .toEqual({ dictation: true, live: false });
      expect(service.currentConfig.current()?.modelLimits).toBeNull();
      expect(f.limits).not.toHaveBeenCalled();
      expect((await service.operations.readiness.read()).acceptReady).toBe(false);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('rejects conflicts and failed validation without publishing or extra writes', async () => {
    const f = assemblyFixture();
    const seeded = configuredSeed(f);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const before = service.currentConfig.current();
      const settings = structuredClone(seeded.settings);
      await expect(service.adminConfig.saveSettings({
        protocolVersion: 1, expectedRevision: 999, settings,
      }, actor)).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
      expect(service.currentConfig.current()).toBe(before);
      expect(f.repository.compareAndSwap).not.toHaveBeenCalled();
      await expect(service.adminConfig.updateCredential('openrouter', {
        protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'fixture-bad-key',
      }, actor)).rejects.toMatchObject({ code: 'CREDENTIAL_PROVIDER_UNAVAILABLE' });
      expect(service.currentConfig.current()).toBe(before);
      expect(f.stored()).toEqual(seeded);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('quarantines later activation after an uncertain write', async () => {
    const f = assemblyFixture();
    configuredSeed(f);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const before = service.currentConfig.current();
      vi.mocked(f.repository.compareAndSwap).mockResolvedValueOnce({ outcome: 'uncertain' });
      const settings = structuredClone(configuredSeed(f).settings);
      settings.chat.titleMaxChars = 70;
      await expect(service.adminConfig.saveSettings({
        protocolVersion: 1, expectedRevision: 1, settings,
      }, actor)).rejects.toMatchObject({ code: 'CONFIG_WRITE_UNCERTAIN' });
      expect(service.currentConfig.current()).toBe(before);
      await expect(service.adminConfig.saveSettings({
        protocolVersion: 1, expectedRevision: 1, settings,
      }, actor)).rejects.toMatchObject({ code: 'CONFIG_WRITE_UNCERTAIN' });
    } finally {
      await service.operations.shutdown();
    }
  });

  it('rejects delayed-validation revision conflicts without overwriting newer settings', async () => {
    const f = assemblyFixture();
    configuredSeed(f);
    const bumped = configuredSeed(f, 2);
    const validating = vi.fn<typeof fetch>(async url => {
      if (String(url) === 'https://openrouter.ai/api/v1/key') {
        f.seed(bumped);
        return Response.json({ data: { label: 'discard', limit: null, usage: 0, is_free_tier: false } });
      }
      throw new Error('Unhandled fixture URL');
    });
    const service = await AppService.create(f.bootstrap, { ...f.ports, fetcher: validating });
    try {
      f.seed(configuredSeed(f, 1));
      const before = f.stored();
      await expect(service.adminConfig.updateCredential('openrouter', {
        protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'fixture-new-key',
      }, actor)).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
      expect(validating).toHaveBeenCalledTimes(1);
      expect(f.repository.compareAndSwap).not.toHaveBeenCalled();
      expect(f.stored()).toEqual(bumped);
      expect(before).not.toEqual(bumped);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('accepts publication only from this assembly preparation', async () => {
    const f = assemblyFixture();
    configuredSeed(f);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const current = service.currentConfig.current();
      expect(current?.revision).toBe(1);
      expect(() => service.activation.publish(current!)).toThrowError(
        expect.objectContaining({ code: 'CONFIG_ACTIVATION_UNAVAILABLE' }));
      expect(service.currentConfig.current()).toBe(current);
    } finally {
      await service.operations.shutdown();
    }
  });

  it('reloads saved encrypted settings across restarts without legacy env overlay', async () => {
    const f = assemblyFixture();
    configuredSeed(f);
    const first = await AppService.create(f.bootstrap, f.ports);
    const settings = structuredClone(configuredSeed(f).settings);
    settings.chat.titleMaxChars = 70;
    const saved = await first.adminConfig.saveSettings({
      protocolVersion: 1, expectedRevision: 1, settings,
    }, actor);
    expect(saved).toMatchObject({ revision: 2, activeRevision: 2 });
    await first.operations.shutdown();
    vi.stubEnv('OPENROUTER_API_KEY', 'fixture-obsolete-key');
    vi.stubEnv('OPENROUTER_MODEL', 'fixture-obsolete-model');
    try {
      const second = await AppService.create(f.bootstrap, f.ports);
      try {
        expect(second.currentConfig.current()?.revision).toBe(2);
        expect(second.currentConfig.current()?.openRouter.modelId).toBe('fixture/model');
        expect(second.currentConfig.current()?.openRouter.apiKey).toBe(secret);
        expect(second.currentConfig.current()?.budgets.titleMaxChars).toBe(70);
        expect((await second.operations.readiness.read()).acceptReady).toBe(true);
      } finally {
        await second.operations.shutdown();
      }
    } finally {
      vi.unstubAllEnvs();
    }
    expect(f.open).toHaveBeenCalledTimes(2);
  });
});

describe('assembly admission', () => {
  it('keeps admission history when its live ceiling changes', () => {
    let cap = 10;
    const admission = new Admission(() => cap);
    admission.take('generation', 1000);
    admission.take('generation', 1001);
    cap = 2;
    expect(() => admission.take('generation', 1002)).toThrowError(
      expect.objectContaining({ code: 'RATE_LIMITED' }));
    cap = 3;
    expect(() => admission.take('generation', 1003)).not.toThrow();
    expect(() => admission.take('generation', 1004)).toThrowError(
      expect.objectContaining({ code: 'RATE_LIMITED' }));
    expect(() => admission.take('control', 1004)).not.toThrow();
  });

  it('applies live rate ceilings without resetting admission history', async () => {
    const f = assemblyFixture();
    configuredSeed(f);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const admission = service.operations.admission;
      admission.take('generation', 1000);
      admission.take('generation', 1001);
      const lower = defaultManageableSettings();
      lower.openRouter.modelId = 'fixture/model';
      lower.chat.maxRequestsPerMinutePerUser = 2;
      await service.adminConfig.saveSettings({
        protocolVersion: 1, expectedRevision: 1, settings: lower,
      }, actor);
      expect(() => admission.take('generation', 1002)).toThrowError(
        expect.objectContaining({ code: 'RATE_LIMITED' }));
      const raise = structuredClone(lower);
      raise.chat.maxRequestsPerMinutePerUser = 3;
      await service.adminConfig.saveSettings({
        protocolVersion: 1, expectedRevision: 2, settings: raise,
      }, actor);
      expect(() => admission.take('generation', 1003)).not.toThrow();
      expect(() => admission.take('generation', 1004)).toThrowError(
        expect.objectContaining({ code: 'RATE_LIMITED' }));
      expect(() => admission.take('control', 1004)).not.toThrow();
    } finally {
      await service.operations.shutdown();
    }
  });

  it('holds admitted work when concurrency is lowered and refuses only new work', async () => {
    const f = assemblyFixture();
    configuredSeed(f);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const snapshot = vi.mocked(f.raw.snapshot);
      const stop = vi.mocked(f.raw.stopAccepting);
      const drain = vi.mocked(f.raw.drain);
      snapshot.mockReturnValue({ accepting: true, active: 2, unresolvedWrites: 0, degraded: false });
      const lower = defaultManageableSettings();
      lower.openRouter.modelId = 'fixture/model';
      lower.chat.maxConcurrentGenerationsPerProcess = 1;
      await service.adminConfig.saveSettings({
        protocolVersion: 1, expectedRevision: 1, settings: lower,
      }, actor);
      await expect(service.operations.accept()).rejects.toMatchObject({ code: 'CONCURRENCY_LIMIT' });
      expect(stop).not.toHaveBeenCalled();
      expect(drain).not.toHaveBeenCalled();
      snapshot.mockReturnValue({ accepting: true, active: 0, unresolvedWrites: 0, degraded: false });
      await expect(service.operations.accept()).resolves.toBeUndefined();
    } finally {
      await service.operations.shutdown();
    }
  });

  it('forwards attempt-bound stream budgets from the raw runtime', () => {
    const { o } = options();
    const telemetry = new Telemetry(() => undefined);
    const readiness = new Readiness(o);
    const raw = {
      attemptStreamBudgets: () => ({ idleStreamTimeoutMs: 111, maxMessageBytes: 222 }),
    };
    const observed = observedRuntime(() => raw as never, telemetry, readiness);
    expect(observed.attemptStreamBudgets?.('u', 's', 'a'))
      .toEqual({ idleStreamTimeoutMs: 111, maxMessageBytes: 222 });
    const bare = observedRuntime(() => null, telemetry, readiness);
    expect(bare.attemptStreamBudgets).toBeUndefined();
  });

  it('keeps control routes and active snapshots working while a key is replaced', async () => {
    const f = assemblyFixture();
    configuredSeed(f);
    const service = await AppService.create(f.bootstrap, f.ports);
    try {
      const active = service.currentConfig.current();
      const calls = f.limits.mock.calls.length;
      const removed = await service.adminConfig.updateCredential('openrouter', {
        protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: true,
      }, actor);
      expect(removed).toMatchObject({ revision: 2, activeRevision: 2 });
      expect(active?.openRouter.apiKey).toBe(secret);
      expect(service.currentConfig.current()?.openRouter.apiKey).toBe('');
      expect(f.limits.mock.calls.length).toBe(calls);
      expect(f.runtime).toHaveBeenCalledTimes(1);
      expect((await service.operations.readiness.read()).acceptReady).toBe(false);
      expect(await service.sessions.list('server-user', { cursor: null, limit: 20 }))
        .toEqual({ items: [], nextCursor: null });
      expect(await service.adminConfig.read(actor)).toMatchObject({ revision: 2, state: 'stored' });
    } finally {
      await service.operations.shutdown();
    }
  });
});
