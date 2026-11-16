/**
 * ============================================================================
 * FILE: native-preparation.spec.ts
 * LOCATION: backend/test/performance/native-preparation.spec.ts
 * PURPOSE: Check native safety and measurement using offline objects only.
 * ROLE IN PROJECT: Injects offline clients and never reads real credentials.
 * KEY COMPONENTS: Authorization branches; complete event counts and phase timing.
 * ============================================================================
 */
import { describe, expect, it } from 'vitest';
import { authorizeNative, nativePreflight, NativeCommandMeasurement } from './native-safety.js';
import { openNativePerformanceDatabase } from './native-database.js';
import type { MongoClient, MongoClientOptions } from 'mongodb';

const approved = (): NodeJS.ProcessEnv => ({
  AURVIN_NATIVE_PERF_ENABLE: 'authorized',
  AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET: 'attested',
  AURVIN_NATIVE_PERF_CREATE_DROP: 'approved',
  AURVIN_NATIVE_PERF_SAMPLE_LOAD: 'approved-max-18-databases-81-turns',
  AURVIN_NATIVE_PERF_REPLICA_SET: 'offline-set',
  AURVIN_NATIVE_PERF_REVISION: 'a'.repeat(40),
  AURVIN_NATIVE_PERF_LABEL: 'current',
  AURVIN_NATIVE_PERF_SAMPLES: '1',
  AURVIN_TEST_DB_PREFIX: 'aurvin_p2_test_',
  AURVIN_TEST_MONGODB_URI: 'offline-placeholder-not-a-connection-string',
});

describe('native performance preconnect authorization (offline)', () => {
  it('reports every missing public field without reading a URI getter', () => {
    const env = {};
    Object.defineProperty(env, 'AURVIN_TEST_MONGODB_URI', { get: () => { throw new Error('Secret read forbidden'); } });
    const report = nativePreflight(env);
    expect(report).toMatchObject({ mode: 'offline-no-connect', executionReady: false,
      publicFieldsValid: false, uri: 'present-uninspected', proposedPair: { samplesPerSource: 1, databases: 12, turns: 54 } });
    expect(report.fields.every(field => field.status === 'unset')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Secret read forbidden');
  });
  it('validates public field combinations using existing authorization policy, never URI contents', () => {
    const env = approved();
    Object.defineProperty(env, 'AURVIN_TEST_MONGODB_URI', { get: () => { throw new Error('Secret read forbidden'); } });
    expect(nativePreflight(env)).toMatchObject({ publicFieldsValid: true, proposalMatches: true, executionReady: false });
    expect(nativePreflight({ ...approved(), AURVIN_NATIVE_PERF_REVISION: 'main' })).toMatchObject({ publicFieldsValid: false });
    expect(nativePreflight({ ...approved(), AURVIN_NATIVE_PERF_SAMPLES: '3' })).toMatchObject({ publicFieldsValid: true, proposalMatches: false });
  });
  it('reports missing URI presence and never reflects invalid public values', () => {
    const env = approved();
    delete env.AURVIN_TEST_MONGODB_URI;
    env.AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET = 'private-value-never-reflected';
    const report = nativePreflight(env);
    expect(report.uri).toBe('unset');
    expect(report.fields.find(field => field.name === 'AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET')?.status).toBe('invalid');
    expect(JSON.stringify(report)).not.toContain('private-value-never-reflected');
  });
  it('does not even access URI when explicitly disabled', () => {
    const env = { AURVIN_NATIVE_PERF_ENABLE: 'disabled' };
    Object.defineProperty(env, 'AURVIN_TEST_MONGODB_URI', { get: () => { throw new Error('URI accessed'); } });
    expect(() => authorizeNative(env)).toThrow('disabled');
  });
  for (const field of Object.keys(approved())) {
    it(`blocks missing ${field}`, () => {
      const env = approved();
      delete env[field];
      expect(() => authorizeNative(env)).toThrow();
    });
  }
  it.each(['0', '4', '1.5', '01', 'NaN'])('blocks invalid sample bound %s', value => {
    expect(() => authorizeNative({ ...approved(), AURVIN_NATIVE_PERF_SAMPLES: value })).toThrow();
  });
  it.each(['aurvin_', 'aurvin_p2_test_other', ''])('requires exact prefix %s', value => {
    expect(() => authorizeNative({ ...approved(), AURVIN_TEST_DB_PREFIX: value })).toThrow();
  });
  it('accepts only explicit complete authorization, without parsing URI', () => {
    expect(authorizeNative(approved())).toMatchObject({ samples: 1, replicaSet: 'offline-set', label: 'current' });
  });
  it('blocks before constructing any client', async () => {
    let constructions = 0;
    await expect(openNativePerformanceDatabase({}, () => { constructions++; throw new Error('Must not construct'); })).rejects.toThrow('disabled');
    expect(constructions).toBe(0);
  });
  it.each([
    ['AURVIN_NATIVE_PERF_DEDICATED_REPLICA_SET', 'yes'],
    ['AURVIN_NATIVE_PERF_CREATE_DROP', 'true'],
    ['AURVIN_NATIVE_PERF_SAMPLE_LOAD', 'approved'],
    ['AURVIN_NATIVE_PERF_REVISION', 'main'],
    ['AURVIN_NATIVE_PERF_LABEL', 'comparison'],
    ['AURVIN_NATIVE_PERF_REPLICA_SET', 'a/b'],
    ['AURVIN_TEST_MONGODB_URI', '  '],
  ])('rejects incorrect %s before constructing a client', async (field, value) => {
    let constructions = 0;
    await expect(openNativePerformanceDatabase({ ...approved(), [field]: value }, () => {
      constructions++; throw new Error('Must not construct');
    })).rejects.toThrow();
    expect(constructions).toBe(0);
  });
  it('uses only a generated DB, majority writes and explicit replica set, then drops/closes', async () => {
    const calls: string[] = [];
    let options: MongoClientOptions | undefined;
    const client = {
      connect: async () => { calls.push('connect'); },
      close: async () => { calls.push('close'); },
      db: (name: string) => ({ command: async () => { calls.push(name); return { setName: 'offline-set', isWritablePrimary: true }; },
        dropDatabase: async () => { calls.push(`drop:${name}`); } }),
    } as unknown as MongoClient;
    const db = await openNativePerformanceDatabase(approved(), (_uri, opts) => { options = opts; return client; });
    expect(db.name).toMatch(/^aurvin_p2_test_[a-f0-9]{32}$/);
    expect(options).toMatchObject({ monitorCommands: true, replicaSet: 'offline-set', writeConcern: { w: 'majority' }, retryWrites: false });
    await db.close();
    expect(calls).toEqual(['connect', 'admin', `drop:${db.name}`, 'close']);
  });
  it.each([
    {},
    { setName: 'wrong', isWritablePrimary: true },
    { setName: 'offline-set', isWritablePrimary: false },
    { setName: 'offline-set', isWritablePrimary: true, msg: 'isdbgrid' },
  ])('closes on rejected topology %j without creating or dropping a DB', async hello => {
    const calls: string[] = [];
    const client = { connect: async () => {}, close: async () => { calls.push('close'); },
      db: (name: string) => { calls.push(name); return { command: async () => hello }; },
    } as unknown as MongoClient;
    await expect(openNativePerformanceDatabase(approved(), () => client)).rejects.toThrow('details suppressed');
    expect(calls).toEqual(['admin', 'close']);
  });
  it('sanitizes connection failure and closes without DB access', async () => {
    let closed = false;
    const client = { connect: async () => { throw new Error('private URI'); }, close: async () => { closed = true; },
      db: () => { throw new Error('Must not use DB'); },
    } as unknown as MongoClient;
    await expect(openNativePerformanceDatabase(approved(), () => client)).rejects.toThrow('connection details suppressed');
    expect(closed).toBe(true);
  });
  it('reports failed generated DB cleanup and still closes', async () => {
    let closed = false;
    const client = { connect: async () => {}, close: async () => { closed = true; },
      db: () => ({ command: async () => ({ setName: 'offline-set', isWritablePrimary: true }),
        dropDatabase: async () => { throw new Error('private URI'); } }),
    } as unknown as MongoClient;
    const db = await openNativePerformanceDatabase(approved(), () => client);
    await expect(db.close()).rejects.toThrow('operator cleanup required');
    expect(closed).toBe(true);
  });
  it('preserves the operator drop-cleanup error when close also fails', async () => {
    const client = { connect: async () => {}, close: async () => { throw new Error('private close details'); },
      db: () => ({ command: async () => ({ setName: 'offline-set', isWritablePrimary: true }),
        dropDatabase: async () => { throw new Error('private drop details'); } }),
    } as unknown as MongoClient;
    const db = await openNativePerformanceDatabase(approved(), () => client);
    await expect(db.close()).rejects.toThrow('operator cleanup required');
  });
});

describe('native command measurement (offline events, not native evidence)', () => {
  it('counts every command including cursor, retry/failure, and non-target traffic', () => {
    let now = 0;
    const m = new NativeCommandMeasurement('generated', () => now);
    m.start({ requestId: 1, databaseName: 'generated', commandName: 'find' });
    now = 2;
    m.start({ requestId: 2, databaseName: 'generated', commandName: 'getMore' });
    now = 5; m.finish({ requestId: 1 });
    now = 8; m.finish({ requestId: 2 }, true);
    m.start({ requestId: 3, databaseName: 'admin', commandName: 'ping' });
    now = 9; m.finish({ requestId: 3 });
    m.start({ requestId: 4, databaseName: 'generated', commandName: 'getMore' });
    now = 11; m.finish({ requestId: 4 });
    expect(m.summary()).toMatchObject({ total: 4, failed: 1, pending: 0, unmatched: 0,
      commands: { find: 1, getMore: 2, ping: 1 }, storageBusyMs: 11 });
  });
  it('clips overlapping intervals at seal and preserves first milestone', () => {
    let now = 0;
    const m = new NativeCommandMeasurement('generated', () => now);
    m.start({ requestId: 1, databaseName: 'generated', commandName: 'update', command: { writeConcern: { w: 'majority' } } });
    now = 4; m.mark('seal');
    now = 6; m.mark('seal');
    now = 10; m.finish({ requestId: 1 });
    m.mark('settled');
    expect(m.summary()).toMatchObject({ postSealBusyMs: 6, milestones: { seal: 4, settled: 10 }, nonMajorityWrites: 0 });
  });
  it('exposes pending, unmatched completions and non-majority writes instead of hiding them', () => {
    const m = new NativeCommandMeasurement('generated', () => 0);
    m.start({ requestId: 1, databaseName: 'generated', commandName: 'findAndModify', command: { writeConcern: { w: 1 } } });
    m.finish({ requestId: 99 });
    expect(m.summary()).toMatchObject({ pending: 1, unmatched: 1, nonMajorityWrites: 1, postSealBusyMs: null });
  });
  it('clips pre-dispatch/first-answer busy time without calling intervals causal waves', () => {
    let now = 100;
    const m = new NativeCommandMeasurement('generated', () => now);
    m.start({ requestId: 1, databaseName: 'generated', commandName: 'find' });
    now = 104; m.mark('dispatch');
    now = 106; m.mark('firstAnswer');
    now = 108; m.finish({ requestId: 1 });
    now = 110; m.mark('settled');
    now = 200; // Reporting must not extend the settled measurement window.
    expect(m.summary()).toMatchObject({ elapsedMs: 10, storageBusyMs: 8, commandDurationSumMs: 8,
      preDispatch: { busyMs: 4, startedCommands: 1 }, firstAnswer: { busyMs: 6, startedCommands: 1 } });
  });
});
