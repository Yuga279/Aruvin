/**
 * ============================================================================
 * FILE: import-config.ts
 * LOCATION: backend/src/scripts/import-config.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Import legacy manageable environment values into one encrypted document.
 *
 * ROLE IN PROJECT:
 *    Runs only as an explicit operator command against an empty config store.
 *    It claims no runtime, performs no inference, rewrites no .env files, and
 *    prints no secrets; refusal and close outcomes use static categories.
 *
 * KEY COMPONENTS:
 *    - importLegacyConfiguration: Guarded empty-store-only atomic import.
 *    - ImportCloseFault: Distinct unconfirmed-close outcome for the CLI.
 * ============================================================================
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  MAX_CONFIG_DOCUMENT_BYTES,
  storedConfigDocumentSchema,
  type StoredConfigDocument,
} from '../contracts/admin-config.js';
import { ADMIN_CONFIG_ERROR_CODES } from '../contracts/admin-config-wire.js';
import { APP_ERROR_CODES } from '../contracts/errors.js';
import type { ConfigRepository } from '../contracts/config-runtime.js';
import { AppError } from '../platform/errors/app-error.js';
import {
  loadBootstrapConfig,
  obsoleteManageableNames,
  type BootstrapConfig,
} from '../platform/config/bootstrap-config.js';
import { parseLegacyConfigImport } from '../platform/config/legacy-config-import.js';
import {
  buildRuntimeSnapshot,
  defaultManageableSettings,
  validateManageableSettings,
} from '../platform/config/manageable-config.js';
import { AdminConfigFault } from '../admin-config/errors.js';
import { CredentialService } from '../admin-config/credential-service.js';
import { CredentialValidator } from '../admin-config/credential-validation.js';
import { loadFixedAssets } from '../instructions/fixed-assets.js';
import { loadModelLimits } from '../model/index.js';
import { resolvedIdentitySchema } from '../contracts/identity.js';
import { assertBytes } from '../persistence/records.js';
import { MongoConfigRepository, openPersistence } from '../persistence/index.js';
import {
  configurationAdapter,
  prepareConfigurationSnapshot,
  type AssemblyPorts,
  type OpenedPersistence,
} from '../app.service.js';

export type ImportPorts = Pick<
  AssemblyPorts,
  'open' | 'assets' | 'limits' | 'fetcher' | 'configRepository'
> & { signal?: AbortSignal };

export type ImportResult = {
  outcome: 'imported' | 'already-configured';
  importedNames: string[];
};

export class ImportCloseFault extends Error {
  readonly code = 'IMPORT_CLOSE_UNCONFIRMED' as const;
  constructor() {
    super('IMPORT_CLOSE_UNCONFIRMED');
    this.name = 'ImportCloseFault';
  }
}

export type ImportCommandOptions = {
  env?: Record<string, string | undefined>;
  loadEnvFile?: (path: string) => void;
  importConfig?: (env: Record<string, string | undefined>, ports: ImportPorts) => Promise<ImportResult>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  signal?: AbortSignal;
  argv?: string[];
};

function defaultLoadEnvFile(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

function failureCategory(error: unknown): string {
  if (error instanceof ImportCloseFault) return error.code;
  if (error instanceof AdminConfigFault
    && (ADMIN_CONFIG_ERROR_CODES as readonly string[]).includes(error.code)) {
    return error.code;
  }
  if (error instanceof AppError
    && (APP_ERROR_CODES as readonly string[]).includes(error.code)) {
    return error.code;
  }
  return 'IMPORT_FAILED';
}

function printObsolete(stdout: (line: string) => void, env: Record<string, string | undefined>): void {
  const obsolete = obsoleteManageableNames(env);
  if (obsolete.length > 0) stdout(`OBSOLETE_ENV_SETTINGS ${obsolete.join(', ')}`);
}

export async function runImportCommand(options: ImportCommandOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const stderr = options.stderr ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const argv = options.argv ?? process.argv.slice(2);
  if (argv.length > 0) {
    stderr('IMPORT_FAILED UNEXPECTED_ARGUMENTS');
    return 1;
  }
  try {
    (options.loadEnvFile ?? defaultLoadEnvFile)(resolve(process.cwd(), '.env'));
  } catch {
    stderr('IMPORT_FAILED ENV_LOAD_FAILED');
    return 1;
  }
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const importConfig = options.importConfig
    ?? ((candidate, ports) => importLegacyConfiguration(candidate, ports));
  const ports: ImportPorts = {
    ...defaultImportPorts(),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  let result: ImportResult;
  try {
    result = await importConfig(env, ports);
  } catch (error) {
    if (error instanceof AppError
      && (APP_ERROR_CODES as readonly string[]).includes(error.code)
      && error.code === 'UNSUPPORTED_TOPOLOGY') {
      stderr(`IMPORT_REFUSED ${error.code}`);
      return 2;
    }
    stderr(`IMPORT_FAILED ${failureCategory(error)}`);
    return 1;
  }
  if (result.outcome === 'already-configured') {
    stdout('IMPORT_ALREADY_CONFIGURED');
    printObsolete(stdout, env);
    return 2;
  }
  const names = result.importedNames;
  stdout(`IMPORT_IMPORTED ${names.length} setting(s)`);
  if (names.length > 0) stdout(`IMPORTED_SETTINGS ${names.join(', ')}`);
  printObsolete(stdout, env);
  return 0;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : null;
if (entry && (fileURLToPath(import.meta.url) === entry || fileURLToPath(import.meta.url) === `${entry}.js`)) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  if (process.platform !== 'win32') process.once('SIGTERM', abort);
  const onMessage = (message: unknown) => {
    if (message === 'shutdown') controller.abort();
  };
  process.on('message', onMessage);
  try {
    process.exitCode = await runImportCommand({ signal: controller.signal });
  } catch {
    // Static fallback only; runImportCommand already reports categories.
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', abort);
    if (process.platform !== 'win32') process.off('SIGTERM', abort);
    process.off('message', onMessage);
  }
}

export function defaultImportPorts(): Pick<ImportPorts, 'open' | 'assets' | 'limits' | 'fetcher'> {
  return {
    open: openPersistence,
    assets: () => loadFixedAssets({
      instructions: new URL('../instructions/system.md', import.meta.url),
      knowledge: new URL('../../product_knowledge.md', import.meta.url),
    }),
    limits: loadModelLimits,
    fetcher: fetch,
  };
}

function cancelled(): never {
  throw new AppError('CANCELLED', 'The import was cancelled before dispatch.');
}

function strictStoredConfig(
  raw: StoredConfigDocument | null,
  bootstrap: BootstrapConfig,
): StoredConfigDocument | null {
  if (raw === null) return null;
  const parsed = storedConfigDocumentSchema.safeParse(raw);
  if (!parsed.success) throw new AdminConfigFault('CONFIG_STORED_INVALID');
  try {
    assertBytes(parsed.data,
      Math.min(MAX_CONFIG_DOCUMENT_BYTES, bootstrap.safety.maxDocumentBytes));
    validateManageableSettings(parsed.data.settings, bootstrap);
  } catch (error) {
    if (error instanceof AdminConfigFault) throw error;
    throw new AdminConfigFault('CONFIG_STORED_INVALID');
  }
  return parsed.data;
}

async function assertOwnedExecutor(opened: OpenedPersistence): Promise<void> {
  try {
    await opened.owner.assertExecutor();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
  }
}

export async function importLegacyConfiguration(
  env: Record<string, string | undefined>,
  ports: ImportPorts,
): Promise<ImportResult> {
  const signal = ports.signal;
  if (signal?.aborted) cancelled();
  const bootstrap = loadBootstrapConfig(env);
  if (!bootstrap.persistence.mongoUri || bootstrap.persistence.profile !== 'native-mongodb') {
    throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
  }
  if (signal?.aborted) cancelled();
  // Open through the unconfigured infrastructure adapter only. No runtime,
  // reservation, usage owner, or second persistence client is constructed here.
  const adapter = configurationAdapter(bootstrap, buildRuntimeSnapshot(bootstrap, {
    revision: 0,
    settings: defaultManageableSettings(),
    credentials: { openrouter: null, deepgram: null },
  }, null));
  let opened: OpenedPersistence | undefined;
  let closed = false;
  const closeOnce = async (): Promise<void> => {
    if (closed || !opened) return;
    closed = true;
    await opened.close();
  };
  let result: ImportResult;
  try {
    try {
      opened = await ports.open(adapter);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
    }
    const repository: ConfigRepository = ports.configRepository
      ? ports.configRepository(opened)
      : new MongoConfigRepository(opened.owner.store, opened.owner,
        Math.min(MAX_CONFIG_DOCUMENT_BYTES, bootstrap.safety.maxDocumentBytes));
    await assertOwnedExecutor(opened);
    let observed: Awaited<ReturnType<OpenedPersistence['owner']['observedExecutor']>>;
    try {
      observed = await opened.owner.observedExecutor();
    } catch {
      throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
    }
    const local = (observed.record as { local?: unknown } | undefined)?.local;
    if (local != null) {
      throw new AppError('UNSUPPORTED_TOPOLOGY',
        'Local recovery evidence requires operator reconciliation before import.');
    }
    if (signal?.aborted) cancelled();
    let existing: StoredConfigDocument | null;
    try {
      existing = strictStoredConfig(await repository.read(), bootstrap);
    } catch (error) {
      if (error instanceof AdminConfigFault) throw error;
      throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
    }
    if (existing !== null) {
      result = { outcome: 'already-configured', importedNames: [] };
    } else {
      const projected = parseLegacyConfigImport(env, bootstrap);
      const hasCredential = (projected.credentials.openrouter ?? projected.credentials.deepgram) !== null;
      if (hasCredential && bootstrap.encryption.status !== 'ready') {
        throw new AdminConfigFault('CONFIG_ENCRYPTION_UNAVAILABLE');
      }
      const credentials = new CredentialService(
        bootstrap.encryption, new CredentialValidator(ports.fetcher));
      if (projected.credentials.openrouter !== null) {
        await credentials.validate(
          'openrouter', projected.credentials.openrouter, projected.settings.deepgram.region);
      }
      if (projected.credentials.deepgram !== null) {
        await credentials.validate(
          'deepgram', projected.credentials.deepgram, projected.settings.deepgram.region);
      }
      if (signal?.aborted) cancelled();
      const assets = await ports.assets();
      await prepareConfigurationSnapshot(bootstrap,
        { revision: 1, settings: projected.settings, credentials: projected.credentials },
        assets, ports.limits, ports.fetcher, signal ?? new AbortController().signal);
      const identity = resolvedIdentitySchema.parse({ userId: bootstrap.identity.userId,
        openRouterUser: bootstrap.identity.userId, source: 'bootstrap-operator' });
      const now = new Date().toISOString();
      const document: StoredConfigDocument = {
        _id: 'aurvin',
        schemaVersion: 1,
        revision: 1,
        settings: projected.settings,
        credentials: {
          openrouter: projected.credentials.openrouter === null ? null : {
            envelope: credentials.seal('openrouter', projected.credentials.openrouter),
            validatedAt: now,
          },
          deepgram: projected.credentials.deepgram === null ? null : {
            envelope: credentials.seal('deepgram', projected.credentials.deepgram),
            validatedAt: now,
          },
        },
        updatedAt: now,
        updatedBy: identity.userId,
      };
      if (signal?.aborted) cancelled();
      await assertOwnedExecutor(opened);
      const outcome = await repository.createIfAbsent(document);
      if (outcome.outcome === 'uncertain') throw new AdminConfigFault('CONFIG_WRITE_UNCERTAIN');
      if (outcome.outcome === 'conflict') {
        result = { outcome: 'already-configured', importedNames: [] };
      } else {
        result = { outcome: 'imported', importedNames: projected.importedNames };
      }
    }
  } catch (error) {
    await closeOnce().catch(() => undefined);
    throw error;
  }
  try {
    await closeOnce();
  } catch {
    throw new ImportCloseFault();
  }
  return result;
}
