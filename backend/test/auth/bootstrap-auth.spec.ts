/**
 * ============================================================================
 * FILE: bootstrap-auth.spec.ts
 * LOCATION: backend/test/auth/bootstrap-auth.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify explicit bootstrap/adoption without services or application data.
 * ROLE IN PROJECT:
 *    Exercises P5 operator boundaries using deterministic P1 fixtures.
 *    Separates fixture preservation from unrun real migration evidence.
 * KEY COMPONENTS:
 *    - Argument, inspection, insertion, lifecycle and preservation checks.
 * ============================================================================
 */
import type { Db, Document, MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { ProviderUser } from '../../src/auth/provider.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { graphThreadId, key } from '../../src/persistence/records.js';
import { CalendarSecretCipher } from '../../src/platform/crypto/calendar-secret-cipher.js';
import { MongoUsers } from '../../src/persistence/users.js';
import { usersStore } from '../persistence/auth-users-fixture.js';
import { account, at } from './fixtures.js';
import { checkBootstrapPreflight, executeBootstrap, inspectBootstrapDatabase, INSPECTION_COLLECTIONS,
  INSPECTION_LIMIT, INVENTORY_PROJECTION, parseBootstrapArguments, readBootstrapInventory,
  runBootstrapCommand, type BootstrapInventory, type BootstrapPorts } from '../../src/scripts/bootstrap-auth.js';

const selection = ['--workos-user', 'user_operator', '--email', ' Admin@Example.com ',
  '--legacy-owner', 'aurvin-dev-user'];
const acknowledgements = ['--confirm-owner', 'aurvin-dev-user', '--app-stopped',
  '--backup-confirmed', '--authorized'];

it('requires explicit preflight selection and normalizes only email', () => {
  expect(parseBootstrapArguments(['preflight', ...selection])).toEqual({
    mode: 'preflight', workosUserId: 'user_operator', emailNormalized: 'admin@example.com',
    legacyOwner: 'aurvin-dev-user', authorized: false,
  });
});
it('requires all adoption acknowledgements and exact owner confirmation', () => {
  expect(parseBootstrapArguments(['adopt', ...selection, ...acknowledgements]).authorized).toBe(true);
  for (const flag of ['--app-stopped', '--backup-confirmed', '--authorized']) {
    expect(() => parseBootstrapArguments(['adopt', ...selection,
      ...acknowledgements.filter(v => v !== flag)])).toThrow('INVALID_ARGUMENTS');
  }
  expect(() => parseBootstrapArguments(['adopt', ...selection, ...acknowledgements,
    '--confirm-owner', 'other'])).toThrow('INVALID_ARGUMENTS');
});
it.each([
  [], ['adopt', ...selection], ['preflight'], ['login', ...selection],
  ['preflight', ...selection, '--force'], ['preflight', ...selection, '--password', 'secret'],
  ['preflight', ...selection, '--email', 'other@example.com'],
  ['preflight', ...selection, '--authorized'],
  ['preflight', '--workos-user', 'not-a-subject', '--email', 'admin@example.com', '--legacy-owner', 'owner'],
  ['preflight', '--workos-user', 'user_x', '--email', 'bad', '--legacy-owner', 'owner'],
  ['preflight', '--workos-user', 'user_x', '--email', 'a@example.com', '--legacy-owner', '__aurvin_system__'],
  ['preflight', '--workos-user', 'user_x', '--email', 'a@example.com', '--legacy-owner', ' owner'],
  ['preflight', '--workos-user', 'user_x', '--email', 'a@example.com', '--legacy-owner', 'x'.repeat(129)],
].map(argv => ({ argv })))('refuses missing, duplicate, unsupported or malformed arguments: %j', ({ argv }) => {
  expect(() => parseBootstrapArguments(argv)).toThrow('INVALID_ARGUMENTS');
});

const target: ProviderUser = { id: 'user_operator', email: 'admin@example.com', externalId: null };
function bootstrap() {
  return loadBootstrapConfig({ PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/fixture?replicaSet=rs0', MONGODB_DB_NAME: 'fixture',
    AURVIN_USER_ID: 'aurvin-dev-user', WORKOS_API_KEY: 'fixture-not-a-key',
    WORKOS_CLIENT_ID: 'client_fixture', WORKOS_COOKIE_PASSWORD: 'x'.repeat(32) });
}
function inventory(): BootstrapInventory {
  return { users: [], sessions: [], messages: [], 'agent-memory': [], metadata: [],
    checkpoints: [], checkpoint_writes: [], integration_connections: [] };
}
function legacyInventory(): BootstrapInventory {
  const rows = inventory();
  rows.sessions.push({ _id: 'session_record', userId: 'aurvin-dev-user', sessionId: 's1',
    execution: { ownerId: null, activeAttemptId: null } });
  rows.messages.push({ _id: 'message_record', userId: 'aurvin-dev-user', sessionId: 's1' });
  rows.metadata.push({ _id: 'usage_record', kind: 'accounting', userId: 'aurvin-dev-user', sessionId: 's1' });
  rows.checkpoints.push({ _id: 'checkpoint_record', thread_id: graphThreadId('aurvin-dev-user', 's1') });
  rows.checkpoint_writes.push({ _id: 'write_record', thread_id: graphThreadId('aurvin-dev-user', 's1') });
  return rows;
}
const args = () => parseBootstrapArguments(['preflight', ...selection]);

it('preflights empty or exact-owner data without mutating its inputs', () => {
  for (const rows of [inventory(), legacyInventory()]) {
    const before = structuredClone(rows);
    const report = checkBootstrapPreflight(args(), bootstrap(), target, rows);
    expect(report).toMatchObject({ userId: 'aurvin-dev-user', workosUserId: 'user_operator',
      emailNormalized: 'admin@example.com', source: 'bootstrap-operator', calendar: 'absent' });
    expect(rows).toEqual(before);
  }
});
it.each([
  ['existing Super Admin', (r: BootstrapInventory) => r.users.push({ _id: 'admin', _revision: 0,
    ...account({ userId: 'admin', role: 'super-admin', status: 'inactive' }) }), 'ALREADY_BOOTSTRAPPED'],
  ['mapped owner', (r: BootstrapInventory) => r.users.push({ _id: 'aurvin-dev-user', _revision: 0,
    ...account({ userId: 'aurvin-dev-user' }) }), 'ACCOUNT_CONFLICT'],
  ['mapped subject', (r: BootstrapInventory) => r.users.push({ _id: 'u1', _revision: 0,
    ...account({ workosUserId: 'user_operator' }) }), 'ACCOUNT_CONFLICT'],
  ['mapped email', (r: BootstrapInventory) => r.users.push({ _id: 'u1', _revision: 0,
    ...account({ emailNormalized: 'admin@example.com' }) }), 'ACCOUNT_CONFLICT'],
  ['mixed message owner', (r: BootstrapInventory) => { r.messages[0]!.userId = 'someone-else'; }, 'AMBIGUOUS_OWNER'],
  ['missing owner', (r: BootstrapInventory) => { delete r.messages[0]!.userId; }, 'AMBIGUOUS_OWNER'],
  ['orphan checkpoint', (r: BootstrapInventory) => { r.checkpoints[0]!.thread_id = 'unknown'; }, 'AMBIGUOUS_OWNER'],
  ['orphan pending write', (r: BootstrapInventory) => { r.checkpoint_writes[0]!.thread_id = 'unknown'; }, 'AMBIGUOUS_OWNER'],
  ['active work', (r: BootstrapInventory) => { r.sessions[0]!.execution = { activeAttemptId: 'a1' }; }, 'RECOVERY_REQUIRED'],
  ['retained local control', (r: BootstrapInventory) => r.metadata.push({ _id: key('executor'),
    _revision: 0, schemaVersion: 1, kind: 'executor', userId: '__aurvin_system__',
    sessionId: '__executor__', ownerId: 'old', local: { pending: true } }), 'RECOVERY_REQUIRED'],
] as const)('refuses %s without rewriting records', (_label, mutate, code) => {
  const rows = legacyInventory(); mutate(rows);
  const before = structuredClone(rows);
  expect(() => checkBootstrapPreflight(args(), bootstrap(), target, rows)).toThrow(code);
  expect(rows).toEqual(before);
});
it.each([
  { ...target, id: 'user_other' }, { ...target, email: 'other@example.com' },
  { ...target, externalId: 'another-owner' },
])('refuses a different provider identity rather than retargeting: %j', candidate => {
  expect(() => checkBootstrapPreflight(args(), bootstrap(), candidate, inventory())).toThrow('TARGET_MISMATCH');
});
it('requires the explicit owner to equal configured AURVIN_USER_ID', () => {
  expect(() => checkBootstrapPreflight({ ...args(), legacyOwner: 'other' }, bootstrap(), target, inventory()))
    .toThrow('TARGET_MISMATCH');
  expect(checkBootstrapPreflight(args(), bootstrap(), { ...target, externalId: 'aurvin-dev-user' }, inventory())
    .userId).toBe('aurvin-dev-user');
});
it.each(['sessions', 'messages', 'agent-memory', 'metadata', 'integration_connections'] as const)
('refuses a foreign owner in %s', name => {
  const rows = inventory(); rows[name].push({ _id: 'foreign', userId: 'other' });
  expect(() => checkBootstrapPreflight(args(), bootstrap(), target, rows)).toThrow('AMBIGUOUS_OWNER');
});
it('does not treat a system-looking personal record as the executor', () => {
  const rows = inventory(); rows.metadata.push({ _id: 'not-the-executor', kind: 'executor',
    userId: '__aurvin_system__' });
  expect(() => checkBootstrapPreflight(args(), bootstrap(), target, rows)).toThrow('AMBIGUOUS_OWNER');
});
function databaseFixture(rows = inventory()) {
  const calls: { name: string; filter: Document; options: Document }[] = [];
  const db = {
    command: vi.fn<(command: Document) => Promise<Document>>(async command => command.hello
      ? { setName: 'rs0', isWritablePrimary: true } : { ok: 1 }),
    collection: vi.fn((name: keyof BootstrapInventory) => ({
      find: (filter: Document, options: Document) => {
        calls.push({ name, filter, options }); let cap = Infinity;
        const cursor = {
          batchSize: vi.fn((_n: number) => cursor),
          limit: vi.fn((n: number) => { cap = n; return cursor; }),
          toArray: vi.fn(async () => rows[name].slice(0, cap).map(row =>
            Object.fromEntries(Object.keys(INVENTORY_PROJECTION).filter(k => Object.hasOwn(row, k))
              .map(k => [k, structuredClone(row[k])])))),
        };
        return cursor;
      },
    })),
  };
  const client = { options: { replicaSet: 'rs0' }, connect: vi.fn(async () => undefined),
    db: vi.fn(() => db), close: vi.fn(async () => undefined) };
  return { db, client, calls, rows };
}
it('inspects by projections and closes the read-only client without opening persistence', async () => {
  const f = databaseFixture(legacyInventory());
  f.rows.messages[0]!.text = 'private message';
  const before = structuredClone(f.rows);
  const rows = await readBootstrapInventory(bootstrap(), f.client as unknown as MongoClient);
  expect(rows.messages[0]).not.toHaveProperty('text');
  expect(f.rows).toEqual(before);
  expect(f.client.close).toHaveBeenCalledTimes(1);
  expect(f.calls.map(c => c.name)).toEqual([...INSPECTION_COLLECTIONS]);
  for (const call of f.calls) {
    expect(call.filter).toEqual({});
    expect(call.options).toMatchObject({ projection: INVENTORY_PROJECTION });
    expect(call.options.maxTimeMS).toBeGreaterThan(0);
    expect(call.options.timeoutMS).toBeLessThanOrEqual(10_000);
  }
  expect(Object.keys(INVENTORY_PROJECTION)).not.toEqual(expect.arrayContaining([
    'credentials', 'checkpoint', 'writes', 'text', 'content', 'ciphertext', 'encryptedVerifier',
  ]));
});
it.each(INSPECTION_COLLECTIONS)('refuses overflow in %s instead of truncating approval', async name => {
  const f = databaseFixture();
  f.rows[name] = Array.from({ length: INSPECTION_LIMIT + 1 }, (_, n) => ({ _id: String(n) }));
  await expect(inspectBootstrapDatabase(f.db as unknown as Db, 1000)).rejects.toThrow('INSPECTION_LIMIT');
});
it.each([
  { setName: 'other', isWritablePrimary: true }, { isWritablePrimary: true },
  { setName: 'rs0', isWritablePrimary: false }, { msg: 'isdbgrid', isWritablePrimary: true },
])('refuses unsupported or unverified native topology: %j', async hello => {
  const f = databaseFixture();
  f.db.command.mockImplementation(async (command: Document) => command.hello ? hello : { ok: 1 });
  await expect(readBootstrapInventory(bootstrap(), f.client as unknown as MongoClient))
    .rejects.toThrow('UNSUPPORTED_TOPOLOGY');
  expect(f.client.close).toHaveBeenCalledTimes(1);
});
it('closes on connection/query failure and never swallows unconfirmed close', async () => {
  const f = databaseFixture(); f.client.connect.mockRejectedValueOnce(new Error('uri=secret'));
  await expect(readBootstrapInventory(bootstrap(), f.client as unknown as MongoClient)).rejects.toThrow('STORAGE_UNAVAILABLE');
  expect(f.client.close).toHaveBeenCalledTimes(1);
  const g = databaseFixture(); g.client.close.mockRejectedValueOnce(new Error('credential'));
  await expect(readBootstrapInventory(bootstrap(), g.client as unknown as MongoClient)).rejects.toThrow('CLOSE_UNCONFIRMED');
});
it('never projects credential or transcript payload fields', () => {
  for (const field of ['credentials', 'checkpoint', 'writes', 'text', 'content',
    'ciphertext', 'encryptedVerifier']) expect(INVENTORY_PROJECTION).not.toHaveProperty(field);
});
it('closes when a projected query fails', async () => {
  const f = databaseFixture(); f.db.collection.mockImplementation(() => { throw new Error('raw db failure'); });
  await expect(readBootstrapInventory(bootstrap(), f.client as unknown as MongoClient)).rejects.toThrow('STORAGE_UNAVAILABLE');
  expect(f.client.close).toHaveBeenCalledTimes(1);
});
function commandFixture(initial = legacyInventory()) {
  const storage = usersStore();
  const users = new MongoUsers(storage.store, storage.owner, 8192);
  const rows = initial;
  const snapshot = (): BootstrapInventory => ({ ...structuredClone(rows),
    users: [...storage.documents.values()].map(r => structuredClone(r)) });
  const close = vi.fn(async () => undefined);
  const assertExecutor = vi.fn(async () => undefined);
  const inspect = vi.fn(async () => snapshot());
  const opened = { users, owner: { executorId: 'bootstrap_executor', assertExecutor },
    inspect: vi.fn(async () => snapshot()), close };
  const open = vi.fn(async () => opened);
  const provider = { getUser: vi.fn(async () => ({ ...target })) };
  const ports: BootstrapPorts = { inspect, open, provider, now: () => new Date(at) };
  return { storage, users, rows, opened, close, assertExecutor, inspect, open, provider, ports };
}
const adoptArgs = () => parseBootstrapArguments(['adopt', ...selection, ...acknowledgements]);

it('preflight never opens admitted persistence or inserts an account', async () => {
  const f = commandFixture();
  expect(await executeBootstrap(args(), bootstrap(), f.ports)).toMatchObject({ outcome: 'preflight' });
  expect(f.open).not.toHaveBeenCalled();
  expect(f.storage.collection.updateOne).not.toHaveBeenCalled();
  expect(f.storage.documents.size).toBe(0);
});
it('inserts exactly one active first Super Admin under the unchanged internal ID', async () => {
  const f = commandFixture();
  const result = await executeBootstrap(adoptArgs(), bootstrap(), f.ports);
  expect(result).toMatchObject({ outcome: 'adopted', userId: 'aurvin-dev-user', source: 'bootstrap-operator' });
  expect((await f.users.get('aurvin-dev-user'))?.account).toEqual(account({ userId: 'aurvin-dev-user',
    workosUserId: 'user_operator', emailNormalized: 'admin@example.com', role: 'super-admin',
    status: 'active', passwordChangeRequired: true, currentWorkosSessionId: null, sessionEpoch: 0 }));
  expect(f.storage.collection.updateOne).toHaveBeenCalledTimes(1);
  expect(f.storage.collection.replaceOne).not.toHaveBeenCalled();
  expect(f.open).toHaveBeenCalledTimes(1);
  expect(f.opened.inspect).toHaveBeenCalledTimes(1);
  expect(f.assertExecutor).toHaveBeenCalledTimes(2);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.provider.getUser).toHaveBeenCalledWith('user_operator');
});
it('refuses a repeat rather than overwriting or reporting a second success', async () => {
  const f = commandFixture(); await executeBootstrap(adoptArgs(), bootstrap(), f.ports);
  const before = structuredClone([...f.storage.documents]);
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('ALREADY_BOOTSTRAPPED');
  expect([...f.storage.documents]).toEqual(before);
  expect(f.open).toHaveBeenCalledTimes(1);
});
it('rechecks conflicts after opening and closes without insertion', async () => {
  const f = commandFixture(); f.open.mockImplementationOnce(async () => {
    await f.users.insert(account({ userId: 'other', emailNormalized: 'admin@example.com' }));
    f.storage.collection.updateOne.mockClear(); return f.opened;
  });
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('ACCOUNT_CONFLICT');
  expect(f.storage.collection.updateOne).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(1);
});
it('does not announce success when insert or close is unconfirmed', async () => {
  const f = commandFixture(); vi.spyOn(f.users, 'insert').mockRejectedValueOnce(new Error('raw write error'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('WRITE_UNCONFIRMED');
  expect(f.close).toHaveBeenCalledTimes(1);
  const g = commandFixture(); g.close.mockRejectedValueOnce(new Error('raw close error'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), g.ports)).rejects.toThrow('CLOSE_UNCONFIRMED');
  expect(g.storage.documents.size).toBe(1); // May have committed: never compensate/delete or auto-retry.
});
it('refuses provider mismatch and cancellation before opening a mutation client', async () => {
  const f = commandFixture(); f.provider.getUser.mockResolvedValueOnce({ ...target, externalId: 'other' });
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('TARGET_MISMATCH');
  expect(f.open).not.toHaveBeenCalled();
  const g = commandFixture(); const controller = new AbortController(); controller.abort();
  await expect(executeBootstrap(adoptArgs(), bootstrap(), g.ports, controller.signal)).rejects.toThrow('CANCELLED');
  expect(g.provider.getUser).not.toHaveBeenCalled(); expect(g.open).not.toHaveBeenCalled();
});
it('refuses executor loss before insert and treats post-write loss as uncertain', async () => {
  const f = commandFixture(); f.assertExecutor.mockRejectedValueOnce(new Error('not owner'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow();
  expect(f.storage.collection.updateOne).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
  const g = commandFixture(); g.assertExecutor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lost'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), g.ports)).rejects.toThrow('WRITE_UNCONFIRMED');
  expect(g.storage.documents.size).toBe(1); expect(g.close).toHaveBeenCalledTimes(1);
});
it('refuses changes to legacy ownership between inspection and mutation', async () => {
  const f = commandFixture(); f.open.mockImplementationOnce(async () => {
    f.rows.messages[0]!.userId = 'other'; return f.opened;
  });
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('AMBIGUOUS_OWNER');
  expect(f.storage.collection.updateOne).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
});
it('parses before environment loading and prints only safe command outcomes', async () => {
  const load = vi.fn(), stdout = vi.fn(), stderr = vi.fn(), makePorts = vi.fn();
  expect(await runBootstrapCommand({ argv: ['adopt'], loadEnvFile: load, makePorts, stdout, stderr })).toBe(2);
  expect(load).not.toHaveBeenCalled(); expect(makePorts).not.toHaveBeenCalled();
  expect(stderr).toHaveBeenCalledWith('BOOTSTRAP_REFUSED INVALID_ARGUMENTS');
});
it('prints a preflight report without opening admitted persistence', async () => {
  const f = commandFixture(); const stdout = vi.fn(), stderr = vi.fn();
  expect(await runBootstrapCommand({ argv: ['preflight', ...selection], bootstrap: bootstrap(),
    loadEnvFile: () => undefined, makePorts: () => f.ports, stdout, stderr })).toBe(0);
  expect(stdout).toHaveBeenCalledTimes(1);
  expect(stdout.mock.calls[0]![0]).toMatch(/^BOOTSTRAP_PREFLIGHT_OK /);
  expect(stderr).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled();
});
it('prints successful preflight/adoption only after close, never provider or DB details', async () => {
  const f = commandFixture(); const lines: string[] = [];
  expect(await runBootstrapCommand({ argv: ['adopt', ...selection, ...acknowledgements],
    bootstrap: bootstrap(), loadEnvFile: () => undefined, makePorts: () => f.ports,
    stdout: line => { expect(f.close).toHaveBeenCalledTimes(1); lines.push(line); },
    stderr: line => lines.push(line) })).toBe(0);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('BOOTSTRAP_ADOPTED ');
  expect(lines[0]).toContain('"source":"bootstrap-operator"');
  expect(lines[0]).not.toMatch(/fixture-not-a-key|currentWorkosSessionId|sealedSession|password|mongodb:/);
});
it('redacts arbitrary errors and distinguishes uncertain writes from known refusals', async () => {
  const f = commandFixture(); const stderr = vi.fn();
  f.provider.getUser.mockRejectedValueOnce(new Error('apiKey=secret&resetToken=raw'));
  expect(await runBootstrapCommand({ argv: ['preflight', ...selection], bootstrap: bootstrap(),
    loadEnvFile: () => undefined, makePorts: () => f.ports, stderr, stdout: vi.fn() })).toBe(1);
  expect(stderr).toHaveBeenLastCalledWith('BOOTSTRAP_FAILED PROVIDER_UNAVAILABLE');
  const g = commandFixture(); g.close.mockRejectedValueOnce(new Error('password=raw'));
  expect(await runBootstrapCommand({ argv: ['adopt', ...selection, ...acknowledgements], bootstrap: bootstrap(),
    loadEnvFile: () => undefined, makePorts: () => g.ports, stderr, stdout: vi.fn() })).toBe(1);
  expect(stderr).toHaveBeenLastCalledWith('BOOTSTRAP_FAILED CLOSE_UNCONFIRMED');
});
it('preserves transcript, checkpoints, usage, global config and encrypted Calendar binding', async () => {
  const cipher = new CalendarSecretCipher({ status: 'ready', key: new Uint8Array(32).fill(7) });
  const aad = { version: 1, userId: 'aurvin-dev-user', provider: 'google-calendar',
    connectionId: 'connection_1', credentialVersion: 1, googleSubjectId: 'google_1', tokenKind: 'refresh' };
  const grant = cipher.sealToken(aad, 'synthetic-refresh-token');
  const f = commandFixture();
  f.rows.messages[0] = { ...f.rows.messages[0], messageId: 'm1', turnId: 't1', sequence: 9,
    content: 'synthetic transcript', provenance: { inputId: 'original_input' } };
  f.rows.checkpoints[0]!.checkpoint = Buffer.from('synthetic checkpoint');
  f.rows.checkpoint_writes[0]!.value = Buffer.from('synthetic pending write');
  f.rows.metadata[0]!.openRouterUser = 'aurvin-dev-user';
  f.rows.metadata[0]!.providerGenerationId = 'original_generation';
  f.rows.integration_connections.push({ _id: 'connection', userId: 'aurvin-dev-user',
    provider: 'google-calendar', grantedScopes: ['existing-consent'], credentials: { refresh: grant } });
  const globalConfig = { _id: 'aurvin', revision: 12, updatedBy: 'aurvin-dev-user', settings: { shared: true } };
  const before = structuredClone({ rows: f.rows, globalConfig });
  const result = await executeBootstrap(adoptArgs(), bootstrap(), f.ports);
  expect(structuredClone({ rows: f.rows, globalConfig })).toEqual(before);
  expect(result.calendar).toBe('preserved-unverified');
  expect(cipher.openToken(aad, grant)).toBe('synthetic-refresh-token');
  expect(() => cipher.openToken({ ...aad, userId: 'user_operator' }, grant)).toThrow();
  const wrongKey = new CalendarSecretCipher({ status: 'ready', key: new Uint8Array(32).fill(8) });
  expect(() => wrongKey.openToken(aad, grant)).toThrow();
  expect(f.storage.collection.replaceOne).not.toHaveBeenCalled();
});
it('does not open mutation persistence after an unconfirmed read-only close', async () => {
  const f = commandFixture();
  const { BootstrapFault } = await import('../../src/scripts/bootstrap-auth.js');
  f.inspect.mockRejectedValueOnce(new BootstrapFault('CLOSE_UNCONFIRMED'));
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports)).rejects.toThrow('CLOSE_UNCONFIRMED');
  expect(f.open).not.toHaveBeenCalled();
});
it('cancels after inspection without opening admitted persistence', async () => {
  const f = commandFixture(); const c = new AbortController();
  f.inspect.mockImplementationOnce(async () => { c.abort(); return legacyInventory(); });
  await expect(executeBootstrap(adoptArgs(), bootstrap(), f.ports, c.signal)).rejects.toThrow('CANCELLED');
  expect(f.open).not.toHaveBeenCalled();
});
it('reports reconnect verification without touching an unusable fixture envelope', async () => {
  const f = commandFixture();
  f.rows.integration_connections.push({ _id: 'connection', userId: 'aurvin-dev-user',
    provider: 'google-calendar', status: 'reconnect-required', credentials: { ciphertext: 'invalid-fixture' } });
  const before = structuredClone(f.rows);
  expect((await executeBootstrap(adoptArgs(), bootstrap(), f.ports)).calendar).toBe('preserved-unverified');
  expect(f.rows).toEqual(before);
});
it('exposes only the compiled explicit bootstrap entry and records unrun migration gates', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(pkg.scripts['auth:bootstrap']).toBe('node dist/scripts/bootstrap-auth.js');
  const runbook = readFileSync(new URL('../../../docs/workos-authentication/operations.md', import.meta.url), 'utf8');
  for (const required of ['## Authorization and evidence boundary', '## Preflight', '## Explicit adoption',
    '## Backup and rollback', '## Verification', '## Evidence ledger', 'Real application-data adoption: **UNRUN**',
    'Review: **SKIPPED**', '--confirm-owner', '--backup-confirmed', 'preserved-unverified']) {
    expect(runbook).toContain(required);
  }
});
