/**
 * ============================================================================
 * FILE: import-config.spec.ts
 * LOCATION: backend/src/scripts/import-config.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the explicit empty-store legacy import and its sanitized CLI.
 *
 * ROLE IN PROJECT:
 *    Locks atomic single-document import, populated-store refusal, guarded
 *    ownership, and secret-free reporting without touching operator data.
 *
 * KEY COMPONENTS:
 *    - Empty-store import: one encrypted revision with validated credentials.
 *    - Refusals: populated store, invalid keys, ownership, aborts, ambiguity.
 * ============================================================================
 */

import { AppError } from '../platform/errors/app-error.js';
import { AdminConfigFault } from '../admin-config/errors.js';
import { secret } from '../../test/admin-config/fixtures.js';
import { assemblyFixture } from '../../test/assembly/admin-config-fixture.js';
import { ImportCloseFault, importLegacyConfiguration, runImportCommand } from './import-config.js';

const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

function baseEnv(): Record<string, string | undefined> {
  return {
    PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'fixture-injected-only',
    NODE_ENV: 'development',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    AURVIN_CONFIG_ENCRYPTION_KEY: MASTER_KEY,
    OPENROUTER_API_KEY: secret,
    OPENROUTER_MODEL: 'fixture/model',
    ENABLE_DICTATION_MODE: 'false',
    ENABLE_LIVE_VOICE_MODE: 'false',
  };
}

function openrouterSuccess() {
  return vi.fn<typeof fetch>(async url => {
    if (String(url) === 'https://openrouter.ai/api/v1/key') {
      return Response.json({ data: { label: 'discard', limit: null, usage: 0, is_free_tier: false } });
    }
    throw new Error('Unhandled fixture URL');
  });
}

describe('importLegacyConfiguration', () => {
  it('imports one encrypted document and refuses a populated store', async () => {
    const f = assemblyFixture();
    const fetcher = openrouterSuccess();
    const env = baseEnv();
    expect(await importLegacyConfiguration(env, { ...f.ports, fetcher })).toMatchObject({ outcome: 'imported' });
    const saved = f.stored()!;
    expect(saved.updatedBy).toBe(f.bootstrap.identity.userId);
    expect(saved.revision).toBe(1);
    expect(saved.credentials.openrouter?.envelope.algorithm).toBe('aes-256-gcm');
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(f.credentials.decrypt(saved).openrouter).toBe(secret);
    expect(saved.settings.voice.enabledModes).toEqual({ dictation: false, live: false });
    expect(saved.settings.deepgram.rates.novaPerMinuteUsd).toBeNull();
    expect(await importLegacyConfiguration(env, { ...f.ports, fetcher })).toMatchObject({ outcome: 'already-configured' });
    expect(f.repository.createIfAbsent).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(f.runtime).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledTimes(2);
  });

  it('leaves no document when legacy settings are invalid', async () => {
    const f = assemblyFixture();
    const env = { ...baseEnv(), MAX_INPUT_CHARS: 'not-a-number' };
    await expect(importLegacyConfiguration(env, { ...f.ports, fetcher: openrouterSuccess() }))
      .rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(f.stored()).toBeNull();
    expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('requires an encryption key before validating nonempty credentials', async () => {
    const f = assemblyFixture();
    const fetcher = openrouterSuccess();
    const env = { ...baseEnv(), AURVIN_CONFIG_ENCRYPTION_KEY: undefined };
    await expect(importLegacyConfiguration(env, { ...f.ports, fetcher }))
      .rejects.toMatchObject({ code: 'CONFIG_ENCRYPTION_UNAVAILABLE' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.stored()).toBeNull();
  });

  it('rejects unrecognized credentials without writing', async () => {
    const f = assemblyFixture();
    const fetcher = vi.fn<typeof fetch>(async () => new Response('nope', { status: 401 }));
    await expect(importLegacyConfiguration(baseEnv(), { ...f.ports, fetcher }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_REJECTED' });
    expect(f.stored()).toBeNull();
    expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
  });

  it('validates the second credential after the first and writes nothing on failure', async () => {
    const f = assemblyFixture();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      if (String(url) === 'https://openrouter.ai/api/v1/key') {
        return Response.json({ data: { label: 'discard', limit: null, usage: 0, is_free_tier: false } });
      }
      if (String(url) === 'https://api.deepgram.com/v1/auth/token' && auth.startsWith('Token ')) {
        return new Response('bad key', { status: 401 });
      }
      throw new Error('Unhandled fixture URL');
    });
    const env = { ...baseEnv(), DEEPGRAM_API_KEY: 'fixture-deepgram-key' };
    await expect(importLegacyConfiguration(env, { ...f.ports, fetcher }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_REJECTED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(f.stored()).toBeNull();
    expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
  });

  it('leaves no document when the catalogue cannot verify the model', async () => {
    const f = assemblyFixture();
    const limits = vi.fn(async () => {
      throw new AppError('CONFIGURATION_ERROR', 'fixture catalogue unavailable');
    });
    await expect(importLegacyConfiguration(baseEnv(), {
      ...f.ports, fetcher: openrouterSuccess(), limits: limits as never,
    })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(f.stored()).toBeNull();
    expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
  });

  it('refuses without storage when no URI is configured', async () => {
    const f = assemblyFixture();
    const { MONGODB_URI: _dropped, ...env } = baseEnv();
    await expect(importLegacyConfiguration(env, { ...f.ports, fetcher: openrouterSuccess() }))
      .rejects.toMatchObject({ code: 'CONFIG_STORAGE_UNAVAILABLE' });
    expect(f.open).not.toHaveBeenCalled();
  });

  it('refuses a non-native profile without opening a store', async () => {
    const f = assemblyFixture();
    const env = { ...baseEnv(), PERSISTENCE_PROFILE: 'cosmos-mongodb-ru' };
    await expect(importLegacyConfiguration(env, { ...f.ports, fetcher: openrouterSuccess() }))
      .rejects.toMatchObject({ code: 'CONFIG_STORAGE_UNAVAILABLE' });
    expect(f.open).not.toHaveBeenCalled();
  });

  it('refuses concurrent backend ownership without becoming an external writer', async () => {
    const f = assemblyFixture();
    f.owner.assertExecutor.mockRejectedValueOnce(
      new AppError('UNSUPPORTED_TOPOLOGY', 'fixture competing executor'));
    await expect(importLegacyConfiguration(baseEnv(), { ...f.ports, fetcher: openrouterSuccess() }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
    expect(f.stored()).toBeNull();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('refuses pending local recovery without finishing it', async () => {
    const f = assemblyFixture();
    f.owner.observedExecutor.mockResolvedValueOnce({
      record: { local: { pending: true, ancestors: ['previous'] } },
    });
    await expect(importLegacyConfiguration(baseEnv(), { ...f.ports, fetcher: openrouterSuccess() }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_TOPOLOGY' });
    expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
    expect(f.stored()).toBeNull();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('reports uncertain writes without claiming absence or retrying', async () => {
    const f = assemblyFixture();
    vi.mocked(f.repository.createIfAbsent).mockResolvedValueOnce({ outcome: 'uncertain' });
    await expect(importLegacyConfiguration(baseEnv(), { ...f.ports, fetcher: openrouterSuccess() }))
      .rejects.toMatchObject({ code: 'CONFIG_WRITE_UNCERTAIN' });
    expect(f.repository.createIfAbsent).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('treats an invalid stored document as a diagnostic refusal, never as empty', async () => {
    const f = assemblyFixture();
    f.seed({ revision: 'nope' } as never);
    await expect(importLegacyConfiguration(baseEnv(), { ...f.ports, fetcher: openrouterSuccess() }))
      .rejects.toMatchObject({ code: 'CONFIG_STORED_INVALID' });
    expect(f.repository.createIfAbsent).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('refuses before dispatch when already aborted and still imports after late abort', async () => {
    const f = assemblyFixture();
    const early = new AbortController();
    early.abort();
    await expect(importLegacyConfiguration(baseEnv(), {
      ...f.ports, fetcher: openrouterSuccess(), signal: early.signal,
    })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(f.open).not.toHaveBeenCalled();

    const late = new AbortController();
    const { promise, resolve } = (() => {
      let release!: () => void;
      const gate = new Promise<void>(yes => { release = yes; });
      return { promise: gate, resolve: release };
    })();
    vi.mocked(f.repository.createIfAbsent).mockImplementationOnce(async document => {
      late.abort();
      await promise;
      if (f.stored()) return { outcome: 'conflict', currentRevision: f.stored()!.revision };
      return { outcome: 'confirmed', document: structuredClone(document) };
    });
    const importing = importLegacyConfiguration(baseEnv(), {
      ...f.ports, fetcher: openrouterSuccess(), signal: late.signal,
    });
    resolve();
    expect(await importing).toMatchObject({ outcome: 'imported' });
  });

  it('never constructs a runtime, edits env, or prints during import', async () => {
    const f = assemblyFixture();
    const env = baseEnv();
    const snapshot = { ...env };
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      await importLegacyConfiguration(env, { ...f.ports, fetcher: openrouterSuccess() });
      expect(env).toEqual(snapshot);
      expect(f.runtime).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
      error.mockRestore();
    }
  });

  it('keeps thrown provider secrets out of import failures', async () => {
    const f = assemblyFixture();
    const marker = 'fixture-thrown-secret-marker';
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error(marker); });
    const failure = await importLegacyConfiguration(baseEnv(), { ...f.ports, fetcher })
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(AdminConfigFault);
    expect(String((failure as { message: string }).message)).not.toContain(marker);
  });
});

describe('runImportCommand', () => {
  it('CLI never prints thrown secret text', async () => {
    const lines: string[] = [];
    const marker = 'fixture-key-uri-envelope-master-key';
    const code = await runImportCommand({
      env: {}, loadEnvFile: () => undefined,
      importConfig: async () => { throw new Error(marker); },
      stdout: line => { lines.push(line); }, stderr: line => { lines.push(line); },
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).not.toContain(marker);
    expect(lines.join('\n')).toContain('IMPORT_FAILED');
  });

  it('reports imported names and counts without values', async () => {
    const lines: string[] = [];
    let loads = 0;
    let imports = 0;
    const code = await runImportCommand({
      env: { OPENROUTER_API_KEY: 'marker-value-a', OPENROUTER_MODEL: 'marker-value-b' },
      loadEnvFile: () => { loads += 1; },
      importConfig: async () => {
        imports += 1;
        return { outcome: 'imported', importedNames: ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'] };
      },
      stdout: line => { lines.push(line); }, stderr: line => { lines.push(line); },
    });
    expect(code).toBe(0);
    expect(loads).toBe(1);
    expect(imports).toBe(1);
    const text = lines.join('\n');
    expect(text).toContain('IMPORT_IMPORTED');
    expect(text).toContain('OPENROUTER_API_KEY');
    expect(text).not.toContain('marker-value-a');
    expect(text).not.toContain('marker-value-b');
  });

  it('treats an existing store as a safe refusal', async () => {
    const lines: string[] = [];
    const code = await runImportCommand({
      env: {}, loadEnvFile: () => undefined,
      importConfig: async () => ({ outcome: 'already-configured', importedNames: [] }),
      stdout: line => { lines.push(line); }, stderr: line => { lines.push(line); },
    });
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('IMPORT_ALREADY_CONFIGURED');
  });

  it('maps an unconfirmed close to a nonzero close category', async () => {
    const lines: string[] = [];
    const code = await runImportCommand({
      env: {}, loadEnvFile: () => undefined,
      importConfig: async () => { throw new ImportCloseFault(); },
      stdout: line => { lines.push(line); }, stderr: line => { lines.push(line); },
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('IMPORT_CLOSE_UNCONFIRMED');
  });

  it('rejects unexpected command arguments without importing', async () => {
    const lines: string[] = [];
    let imports = 0;
    const code = await runImportCommand({
      env: {}, loadEnvFile: () => undefined, argv: ['--uri', 'fixture'],
      importConfig: async () => {
        imports += 1;
        return { outcome: 'imported', importedNames: [] };
      },
      stdout: line => { lines.push(line); }, stderr: line => { lines.push(line); },
    });
    expect(code).toBe(1);
    expect(imports).toBe(0);
    expect(lines.join('\n')).toContain('IMPORT_FAILED');
  });

  it('does nothing on plain module import', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const module = await import('./import-config.js');
      expect(typeof module.runImportCommand).toBe('function');
      expect(typeof module.importLegacyConfiguration).toBe('function');
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});
