/**
 * ============================================================================
 * FILE: migrate-accounting.ts
 * LOCATION: backend/src/scripts/migrate-accounting.ts
 * PURPOSE: Run opt-in, explicit-target accounting maintenance without provider calls.
 * ROLE IN PROJECT: Dry run opens read-only IO; apply reuses admitted persistence ownership.
 * KEY COMPONENTS: Strict CLI flags, bounded pages, sanitized output, one close owner.
 * ============================================================================
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { DEFAULT_BUDGETS } from '../contracts/budgets.js';
import { APP_ERROR_CODES } from '../contracts/errors.js';
import { loadConfig, type AurvinConfig } from '../platform/config/load-config.js';
import { AppError } from '../platform/errors/app-error.js';
import { MongoMetadata } from '../persistence/metadata.js';
import { RecordStore } from '../persistence/store.js';
import { openPersistence } from '../persistence/persistence.js';
import type { MongoOwnership } from '../persistence/ownership.js';

type MaintenanceStore = { metadata: Pick<MongoMetadata, 'migrateAccountingPage'>; owner?: MongoOwnership; close: () => Promise<void> };
export type AccountingCommandOptions = { argv?: string[]; env?: Record<string, string | undefined>;
  openRead?: (config: AurvinConfig) => Promise<MaintenanceStore>; openApply?: (config: AurvinConfig) => Promise<MaintenanceStore>;
  stdout?: (line: string) => void; stderr?: (line: string) => void; signal?: AbortSignal };
async function openRead(config: AurvinConfig): Promise<MaintenanceStore> {
  const client = new MongoClient(config.persistence.mongoUri, { retryWrites: false, readPreference: 'primary',
    readConcern: { level: 'majority' }, timeoutMS: DEFAULT_BUDGETS.persistenceTimeoutMs,
    serverSelectionTimeoutMS: DEFAULT_BUDGETS.connectTimeoutMs });
  try {
    await client.connect();
    const hello = await client.db('admin').command({ hello: 1, maxTimeMS: DEFAULT_BUDGETS.persistenceTimeoutMs });
    if (hello.setName !== client.options.replicaSet || hello.isWritablePrimary !== true || hello.msg === 'isdbgrid')
      throw new AppError('UNSUPPORTED_TOPOLOGY', 'A native replica-set primary is required.');
    return { metadata: new MongoMetadata(new RecordStore(client.db(config.persistence.mongoDbName),
      DEFAULT_BUDGETS.persistenceTimeoutMs), DEFAULT_BUDGETS), close: () => client.close() };
  } catch (error) { await client.close(); throw error; }
}
export async function runAccountingMigrationCommand(options: AccountingCommandOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const stderr = options.stderr ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  let opened: MaintenanceStore | undefined;
  let code = 1;
  try {
    const { values } = parseArgs({ args: options.argv ?? process.argv.slice(2), allowPositionals: false,
      options: { database: { type: 'string' }, apply: { type: 'boolean' }, 'maintenance-confirmed': { type: 'boolean' },
        'page-size': { type: 'string' }, 'max-pages': { type: 'string' }, 'after-id': { type: 'string' }, help: { type: 'boolean' } } });
    if (values.help) {
      stdout('node dist/scripts/migrate-accounting.js --database TARGET [--apply --maintenance-confirmed] [--page-size 1..50] [--max-pages 1..1000] [--after-id HEX]');
      stdout('Default is dry run. Private URI: AURVIN_ACCOUNTING_MONGODB_URI. No application .env is loaded.');
      return 0;
    }
    const database = values.database;
    const limit = Number(values['page-size'] ?? 50); const maxPages = Number(values['max-pages'] ?? 1000);
    if (!database || !/^[a-zA-Z0-9_-]{1,63}$/.test(database) || ['admin', 'local', 'config'].includes(database.toLowerCase())
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000
      || (values.apply && !values['maintenance-confirmed'])
      || (values['after-id'] && !/^[a-f0-9]{64}$/.test(values['after-id'])))
      throw new AppError('INVALID_REQUEST', 'An explicit target and valid maintenance flags are required.');
    const env = options.env ?? process.env;
    const uri = env.AURVIN_ACCOUNTING_MONGODB_URI;
    if (!uri || !new URL(uri).searchParams.get('replicaSet')
      || ['true', '1'].includes(new URL(uri).searchParams.get('directConnection') ?? '')
      || ['true', '1'].includes(new URL(uri).searchParams.get('loadBalanced') ?? ''))
      throw new AppError('UNSUPPORTED_TOPOLOGY', 'An explicit private replica-set URI is required.');
    if (options.signal?.aborted) throw new AppError('CANCELLED', 'Accounting maintenance was stopped.');
    const config = loadConfig({ MONGODB_URI: uri, MONGODB_DB_NAME: database, PERSISTENCE_PROFILE: 'native-mongodb',
      AURVIN_LOCAL_CRASH_RECOVERY: env.AURVIN_ACCOUNTING_LOCAL_CRASH_RECOVERY ?? 'false' });
    opened = values.apply ? await (options.openApply ?? openPersistence)(config) : await (options.openRead ?? openRead)(config);
    const totals = { scanned: 0, eligible: 0, converted: 0, unchanged: 0, invalid: 0, conflicts: 0 };
    let cursor: string | null = values['after-id'] ?? null; let pages = 0;
    do {
      const result = await opened.metadata.migrateAccountingPage({ limit, cursor, apply: Boolean(values.apply),
        maintenanceConfirmed: Boolean(values['maintenance-confirmed']), owner: opened.owner, signal: options.signal });
      for (const field of Object.keys(totals) as (keyof typeof totals)[]) totals[field] += result[field];
      cursor = result.nextCursor; pages++;
      stdout(JSON.stringify({ dryRun: !values.apply, pages, ...totals, nextCursor: cursor, complete: cursor === null }));
    } while (cursor !== null && pages < maxPages);
    code = cursor !== null || totals.invalid > 0 || totals.conflicts > 0 ? 2 : 0;
  } catch (error) {
    const category = error instanceof AppError && (APP_ERROR_CODES as readonly string[]).includes(error.code)
      ? error.code : 'ACCOUNTING_MIGRATION_FAILED';
    stderr(`ACCOUNTING_MIGRATION_FAILED ${category}`);
  } finally {
    try { await opened?.close(); }
    catch { stderr('ACCOUNTING_MIGRATION_CLOSE_UNCONFIRMED'); code = 1; }
  }
  return code;
}
const entry = process.argv[1] ? resolve(process.argv[1]) : null;
if (entry && fileURLToPath(import.meta.url) === entry) {
  const controller = new AbortController(); const abort = () => controller.abort();
  process.once('SIGINT', abort);
  try { process.exitCode = await runAccountingMigrationCommand({ signal: controller.signal }); }
  finally { process.off('SIGINT', abort); }
}
