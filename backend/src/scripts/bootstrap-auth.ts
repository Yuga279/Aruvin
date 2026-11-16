/**
 * ============================================================================
 * FILE: bootstrap-auth.ts
 * LOCATION: backend/src/scripts/bootstrap-auth.ts
 * ============================================================================
 * PURPOSE:
 *    Explicitly inspect and adopt the first Super Admin's legacy owner ID.
 * ROLE IN PROJECT:
 *    Runs only as an operator command, never during application startup/login.
 *    Preserves personal records and uses the existing executor for insertion.
 * KEY COMPONENTS:
 *    - Argument parsing, read-only inspection, guarded insertion and safe CLI.
 * ============================================================================
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { MongoClient, type Db, type Document } from 'mongodb';
import { normalizedEmailSchema, userAccountSchema, type UsersRepository, type UserAccount } from '../contracts/auth.js';
import { idSchema } from '../contracts/identifiers.js';
import { createWorkosProvider, type AuthProvider, type ProviderUser } from '../auth/provider.js';
import { loadBootstrapConfig, type BootstrapConfig } from '../platform/config/bootstrap-config.js';
import { configurationAdapter } from '../app.service.js';
import { buildRuntimeSnapshot, defaultManageableSettings } from '../platform/config/manageable-config.js';
import { openPersistence } from '../persistence/index.js';
import { decode, executorSchema, graphThreadId, key } from '../persistence/records.js';

type FaultCode = 'INVALID_ARGUMENTS' | 'CONFIGURATION_REQUIRED' | 'TARGET_MISMATCH'
  | 'ALREADY_BOOTSTRAPPED' | 'ACCOUNT_CONFLICT' | 'AMBIGUOUS_OWNER' | 'INSPECTION_LIMIT'
  | 'RECOVERY_REQUIRED' | 'UNSUPPORTED_TOPOLOGY' | 'PROVIDER_UNAVAILABLE'
  | 'STORAGE_UNAVAILABLE' | 'WRITE_UNCONFIRMED' | 'CLOSE_UNCONFIRMED' | 'CANCELLED';
export class BootstrapFault extends Error {
  constructor(readonly code: FaultCode) { super(code); }
}
export type BootstrapArguments = {
  mode: 'preflight' | 'adopt'; workosUserId: string; emailNormalized: string;
  legacyOwner: string; authorized: boolean;
};
export function parseBootstrapArguments(argv: string[]): BootstrapArguments {
  const bad = (): never => { throw new BootstrapFault('INVALID_ARGUMENTS'); };
  const [mode, ...rest] = argv;
  if (mode !== 'preflight' && mode !== 'adopt') return bad();
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const valueFlags = new Set(['--workos-user', '--email', '--legacy-owner', '--confirm-owner']);
  const switchFlags = new Set(['--app-stopped', '--backup-confirmed', '--authorized']);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (values.has(flag) || switches.has(flag)) return bad();
    if (valueFlags.has(flag)) {
      const value = rest[++i];
      if (!value || value.startsWith('--')) return bad();
      values.set(flag, value);
    } else if (switchFlags.has(flag)) switches.add(flag);
    else return bad();
  }
  const owner = values.get('--legacy-owner');
  const subject = values.get('--workos-user');
  const email = normalizedEmailSchema.safeParse(values.get('--email'));
  if (!owner || !idSchema.safeParse(owner).success || owner !== owner.trim() ||
    /[\u0000-\u001f\u007f]/.test(owner) || owner.startsWith('__aurvin_') ||
    !subject || !/^user_[A-Za-z0-9_-]+$/.test(subject) || !idSchema.safeParse(subject).success ||
    !email.success) return bad();
  if (mode === 'preflight' && (switches.size !== 0 || values.has('--confirm-owner'))) return bad();
  if (mode === 'adopt' && (switches.size !== 3 || values.get('--confirm-owner') !== owner)) return bad();
  return { mode, workosUserId: subject, emailNormalized: email.data, legacyOwner: owner,
    authorized: mode === 'adopt' };
}
export const INSPECTION_COLLECTIONS = ['users', 'sessions', 'messages', 'agent-memory',
  'metadata', 'checkpoints', 'checkpoint_writes', 'integration_connections'] as const;
export type BootstrapInventory = Record<typeof INSPECTION_COLLECTIONS[number], Document[]>;
export type BootstrapReport = {
  userId: string; workosUserId: string; emailNormalized: string; source: 'bootstrap-operator';
  counts: Record<typeof INSPECTION_COLLECTIONS[number], number>;
  calendar: 'absent' | 'preserved-unverified';
};
export function checkBootstrapPreflight(a: BootstrapArguments, b: BootstrapConfig,
  target: ProviderUser, rows: BootstrapInventory, executorId?: string): BootstrapReport {
  if (!b.workos || !b.persistence.mongoUri) throw new BootstrapFault('CONFIGURATION_REQUIRED');
  if (b.persistence.profile !== 'native-mongodb' || b.topology.executor !== 'single-process')
    throw new BootstrapFault('UNSUPPORTED_TOPOLOGY');
  const email = normalizedEmailSchema.safeParse(target.email);
  if (a.legacyOwner !== b.identity.userId || target.id !== a.workosUserId || !email.success ||
    email.data !== a.emailNormalized || (target.externalId !== null && target.externalId !== a.legacyOwner))
    throw new BootstrapFault('TARGET_MISMATCH');
  if (rows.users.some(r => r.role === 'super-admin')) throw new BootstrapFault('ALREADY_BOOTSTRAPPED');
  const accounts = rows.users.map(r => {
    try {
      const value = decode(userAccountSchema, r)!;
      if (r._id !== value.userId || !Number.isSafeInteger(r._revision) || r._revision < 0) throw new Error();
      return value;
    } catch { throw new BootstrapFault('ACCOUNT_CONFLICT'); }
  });
  if (accounts.some(r => r.userId === a.legacyOwner || r.workosUserId === a.workosUserId ||
    r.emailNormalized === a.emailNormalized)) throw new BootstrapFault('ACCOUNT_CONFLICT');
  for (const field of ['userId', 'workosUserId', 'emailNormalized'] as const) {
    if (new Set(accounts.map(r => r[field])).size !== accounts.length) throw new BootstrapFault('ACCOUNT_CONFLICT');
  }
  const personalMetadata = rows.metadata.filter(r => r._id !== key('executor'));
  for (const raw of rows.metadata.filter(r => r._id === key('executor'))) {
    try {
      const control = decode(executorSchema, raw)!;
      if (control.ownerId !== executorId && control.local &&
        (!b.topology.localCrashRecovery || !control.local.released || control.local.pending ||
          control.local.mutation.state !== 'idle' || control.local.ancestors.length !== 0)) throw new Error();
    } catch { throw new BootstrapFault('RECOVERY_REQUIRED'); }
  }
  for (const list of [rows.sessions, rows.messages, rows['agent-memory'], personalMetadata,
    rows.integration_connections]) {
    if (list.some(r => r.userId !== a.legacyOwner)) throw new BootstrapFault('AMBIGUOUS_OWNER');
  }
  if (rows.sessions.some(r => r.execution?.ownerId != null || r.execution?.activeAttemptId != null))
    throw new BootstrapFault('RECOVERY_REQUIRED');
  const threads = new Set<string>();
  for (const session of rows.sessions) {
    if (!idSchema.safeParse(session.sessionId).success) throw new BootstrapFault('AMBIGUOUS_OWNER');
    const thread = graphThreadId(a.legacyOwner, session.sessionId as string);
    if (threads.has(thread)) throw new BootstrapFault('AMBIGUOUS_OWNER');
    threads.add(thread);
  }
  if ([...rows.checkpoints, ...rows.checkpoint_writes].some(r =>
    typeof r.thread_id !== 'string' || !threads.has(r.thread_id))) throw new BootstrapFault('AMBIGUOUS_OWNER');
  return { userId: a.legacyOwner, workosUserId: a.workosUserId, emailNormalized: a.emailNormalized,
    source: 'bootstrap-operator', counts: Object.fromEntries(INSPECTION_COLLECTIONS.map(name =>
      [name, name === 'metadata' ? personalMetadata.length : rows[name].length])) as BootstrapReport['counts'],
    calendar: rows.integration_connections.length === 0 ? 'absent' : 'preserved-unverified' };
}
export const INSPECTION_LIMIT = 5000;
export const INVENTORY_PROJECTION = {
  _id: 1, _revision: 1, schemaVersion: 1, userId: 1, sessionId: 1, thread_id: 1,
  kind: 1, execution: 1, ownerId: 1, local: 1,
  workosUserId: 1, emailNormalized: 1, role: 1, status: 1, passwordChangeRequired: 1,
  currentWorkosSessionId: 1, sessionEpoch: 1, createdAt: 1, updatedAt: 1,
} as const;
export async function inspectBootstrapDatabase(db: Db, timeoutMs: number): Promise<BootstrapInventory> {
  const rows = {} as BootstrapInventory;
  for (const name of INSPECTION_COLLECTIONS) {
    // ponytail: bounded one-time scan, max 5,000 rows/collection; larger datasets
    // need an explicitly planned paged adoption check, never silent truncation.
    rows[name] = await db.collection(name).find({}, {
      projection: INVENTORY_PROJECTION, maxTimeMS: timeoutMs, timeoutMS: timeoutMs,
    }).batchSize(50).limit(INSPECTION_LIMIT + 1).toArray();
    if (rows[name].length > INSPECTION_LIMIT) throw new BootstrapFault('INSPECTION_LIMIT');
  }
  return rows;
}
function inspectionClient(b: BootstrapConfig): MongoClient {
  return new MongoClient(b.persistence.mongoUri, { appName: 'aurvin-auth-preflight',
    retryWrites: false, retryReads: false, readPreference: 'primary', readConcern: { level: 'majority' },
    connectTimeoutMS: Math.min(b.safety.connectTimeoutMs, 10_000),
    serverSelectionTimeoutMS: Math.min(b.safety.connectTimeoutMs, 10_000),
    timeoutMS: Math.min(b.safety.persistenceTimeoutMs, 10_000) });
}
export async function readBootstrapInventory(b: BootstrapConfig,
  supplied?: Pick<MongoClient, 'options' | 'connect' | 'db' | 'close'>): Promise<BootstrapInventory> {
  if (b.persistence.profile !== 'native-mongodb' || !b.persistence.mongoUri)
    throw new BootstrapFault('UNSUPPORTED_TOPOLOGY');
  const client = supplied ?? inspectionClient(b);
  const timeoutMs = Math.min(b.safety.persistenceTimeoutMs, 10_000);
  try {
    await client.connect();
    await client.db(b.persistence.mongoDbName).command({ ping: 1, maxTimeMS: timeoutMs }, { timeoutMS: timeoutMs });
    const hello = await client.db('admin').command({ hello: 1, maxTimeMS: timeoutMs }, { timeoutMS: timeoutMs });
    const isReplicaSet = Boolean(client.options.replicaSet);
    if (b.topology.localCrashRecovery && !isReplicaSet) throw new BootstrapFault('UNSUPPORTED_TOPOLOGY');
    if (isReplicaSet) {
      if (client.options.directConnection || client.options.loadBalanced ||
        hello.setName !== client.options.replicaSet || hello.isWritablePrimary !== true || hello.msg === 'isdbgrid')
        throw new BootstrapFault('UNSUPPORTED_TOPOLOGY');
    } else if (hello.isWritablePrimary !== true) {
      throw new BootstrapFault('UNSUPPORTED_TOPOLOGY');
    }
    return await inspectBootstrapDatabase(client.db(b.persistence.mongoDbName), timeoutMs);
  } catch (error) {
    throw error instanceof BootstrapFault ? error : new BootstrapFault('STORAGE_UNAVAILABLE');
  } finally {
    try { await client.close(); } catch { throw new BootstrapFault('CLOSE_UNCONFIRMED'); }
  }
}
export type BootstrapOpened = {
  users: UsersRepository; owner: { executorId: string; assertExecutor(): Promise<void> };
  inspect(): Promise<BootstrapInventory>; close(): Promise<void>;
};
export type BootstrapPorts = {
  inspect(b: BootstrapConfig): Promise<BootstrapInventory>;
  open(b: BootstrapConfig): Promise<BootstrapOpened>;
  provider: Pick<AuthProvider, 'getUser'>; now(): Date;
};
export type BootstrapResult = BootstrapReport & { outcome: 'preflight' | 'adopted' };
function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BootstrapFault('CANCELLED');
}
export async function executeBootstrap(a: BootstrapArguments, b: BootstrapConfig,
  ports: BootstrapPorts, signal?: AbortSignal): Promise<BootstrapResult> {
  checkCancellation(signal);
  if (!b.workos || !b.persistence.mongoUri) throw new BootstrapFault('CONFIGURATION_REQUIRED');
  if (a.mode === 'adopt' && !a.authorized) throw new BootstrapFault('INVALID_ARGUMENTS');
  let target: ProviderUser;
  try { target = await ports.provider.getUser(a.workosUserId); }
  catch { throw new BootstrapFault('PROVIDER_UNAVAILABLE'); }
  checkCancellation(signal);
  const report = checkBootstrapPreflight(a, b, target, await ports.inspect(b));
  checkCancellation(signal);
  if (a.mode === 'preflight') return { ...report, outcome: 'preflight' };
  let opened: BootstrapOpened;
  try { opened = await ports.open(b); }
  catch { throw new BootstrapFault('STORAGE_UNAVAILABLE'); }
  try {
    await opened.owner.assertExecutor();
    const current = checkBootstrapPreflight(a, b, target, await opened.inspect(), opened.owner.executorId);
    checkCancellation(signal);
    if (await opened.users.get(a.legacyOwner) || await opened.users.bySubject(a.workosUserId) ||
      await opened.users.byEmail(a.emailNormalized)) throw new BootstrapFault('ACCOUNT_CONFLICT');
    const now = ports.now().toISOString();
    const next: UserAccount = userAccountSchema.parse({ schemaVersion: 1,
      userId: a.legacyOwner, workosUserId: a.workosUserId, emailNormalized: a.emailNormalized,
      role: 'super-admin', status: 'active', passwordChangeRequired: true,
      currentWorkosSessionId: null, sessionEpoch: 0, createdAt: now, updatedAt: now });
    checkCancellation(signal);
    try {
      const saved = await opened.users.insert(next);
      await opened.owner.assertExecutor();
      if (!isDeepStrictEqual(saved.account, next)) throw new Error();
    } catch { throw new BootstrapFault('WRITE_UNCONFIRMED'); }
    return { ...current, outcome: 'adopted' };
  } finally {
    try { await opened.close(); } catch { throw new BootstrapFault('CLOSE_UNCONFIRMED'); }
  }
}
export function defaultBootstrapPorts(b: BootstrapConfig): BootstrapPorts {
  if (!b.workos) throw new BootstrapFault('CONFIGURATION_REQUIRED');
  return {
    provider: createWorkosProvider(b.workos), now: () => new Date(), inspect: readBootstrapInventory,
    open: async bootstrap => {
      const adapter = configurationAdapter(bootstrap, buildRuntimeSnapshot(bootstrap, {
        revision: 0, settings: defaultManageableSettings(),
        credentials: { openrouter: null, deepgram: null },
      }, null));
      const opened = await openPersistence(adapter);
      return { users: opened.users, owner: opened.owner, close: () => opened.close(),
        inspect: () => inspectBootstrapDatabase(opened.owner.store.db,
          Math.min(bootstrap.safety.persistenceTimeoutMs, 10_000)) };
    },
  };
}
export type BootstrapCommandOptions = {
  argv?: string[]; bootstrap?: BootstrapConfig; loadEnvFile?: (path: string) => void;
  makePorts?: (b: BootstrapConfig) => BootstrapPorts; stdout?: (line: string) => void;
  stderr?: (line: string) => void; signal?: AbortSignal;
};
const refused = new Set<FaultCode>(['INVALID_ARGUMENTS', 'CONFIGURATION_REQUIRED', 'TARGET_MISMATCH',
  'ALREADY_BOOTSTRAPPED', 'ACCOUNT_CONFLICT', 'AMBIGUOUS_OWNER', 'INSPECTION_LIMIT',
  'RECOVERY_REQUIRED', 'UNSUPPORTED_TOPOLOGY']);
export async function runBootstrapCommand(o: BootstrapCommandOptions = {}): Promise<number> {
  const stdout = o.stdout ?? (line => { process.stdout.write(`${line}\n`); });
  const stderr = o.stderr ?? (line => { process.stderr.write(`${line}\n`); });
  try {
    const a = parseBootstrapArguments(o.argv ?? process.argv.slice(2));
    (o.loadEnvFile ?? (path => { if (existsSync(path)) process.loadEnvFile(path); }))(resolve(process.cwd(), '.env'));
    const b = o.bootstrap ?? loadBootstrapConfig(process.env);
    const result = await executeBootstrap(a, b, (o.makePorts ?? defaultBootstrapPorts)(b), o.signal);
    // Only this allowlisted report is serialized; never a provider/local account object.
    const { userId, workosUserId, emailNormalized, source, counts, calendar } = result;
    stdout(`BOOTSTRAP_${result.outcome === 'preflight' ? 'PREFLIGHT_OK' : 'ADOPTED'} ${JSON.stringify({
      userId, workosUserId, emailNormalized, source, counts, calendar })}`);
    return 0;
  } catch (error) {
    const code = error instanceof BootstrapFault ? error.code : 'BOOTSTRAP_FAILED';
    const isRefusal = error instanceof BootstrapFault && refused.has(error.code);
    stderr(`BOOTSTRAP_${isRefusal ? 'REFUSED' : 'FAILED'} ${code}`);
    return isRefusal ? 2 : 1;
  }
}
const entry = process.argv[1] ? resolve(process.argv[1]) : null;
if (entry && fileURLToPath(import.meta.url) === entry) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onMessage = (message: unknown) => { if (message === 'shutdown') controller.abort(); };
  process.once('SIGINT', abort);
  if (process.platform !== 'win32') process.once('SIGTERM', abort);
  process.on('message', onMessage);
  try { process.exitCode = await runBootstrapCommand({ signal: controller.signal }); }
  catch { process.stderr.write('BOOTSTRAP_FAILED BOOTSTRAP_FAILED\n'); process.exitCode = 1; }
  finally {
    process.off('SIGINT', abort);
    if (process.platform !== 'win32') process.off('SIGTERM', abort);
    process.off('message', onMessage);
  }
}
