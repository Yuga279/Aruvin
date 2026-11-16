/**
 * ============================================================================
 * FILE: database-observation.spec.ts
 * LOCATION: backend/test/operations/database-observation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Check safe attribution and lifecycle of native command observations.
 *
 * ROLE IN PROJECT:
 *    Exercises observer events without a database or private payload logging.
 *
 * KEY COMPONENTS:
 *    - Event source: Simulates originating and completing request contexts.
 *    - Sanitization: Ensures command bodies never reach diagnostics.
 * ============================================================================
 */
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { MongoClient } from 'mongodb';
import { observeDatabaseCommands } from '../../src/persistence/database-observation.js';
import { Telemetry } from '../../src/operations/telemetry.js';
import { openPersistence } from '../../src/persistence/persistence.js';
import { loadConfig } from '../../src/platform/config/load-config.js';

it('attributes a command to its starting scope without retaining sensitive fields and disposes listeners', () => {
  const lines: string[] = [];
  const t = new Telemetry(line => lines.push(line));
  const source = new EventEmitter();
  const stop = observeDatabaseCommands(source, 'isolated-test', t);
  t.inRequest('11111111-1111-4111-8111-111111111111', () => {
    source.emit('commandStarted', { requestId: 7, databaseName: 'isolated-test', commandName: 'find',
      command: { find: 'checkpoints', filter: { content: 'PRIVATE', uri: 'SECRET' } } });
  });
  source.emit('commandSucceeded', { requestId: 7, commandName: 'find', duration: 12,
    reply: { cursor: { firstBatch: [{ content: 'PRIVATE' }] } } });
  expect(lines.join('')).not.toMatch(/PRIVATE|SECRET|isolated-test|firstBatch|filter/);
  expect(t.snapshot().mongo_read.count).toBe(1);
  stop();
  expect(source.listenerCount('commandStarted')).toBe(0);
  expect(source.listenerCount('commandSucceeded')).toBe(0);
  expect(source.listenerCount('commandFailed')).toBe(0);
});

it('enables driver command monitoring before connecting, without making a network request', async () => {
  let enabled: boolean | undefined;
  let connectionEnabled: unknown;
  const connect = vi.spyOn(MongoClient.prototype, 'connect').mockImplementation(async function (this: MongoClient) {
    enabled = this.options.monitorCommands;
    // Instantiate the installed driver's connection without opening a socket.
    const require = createRequire(import.meta.url);
    const { Connection } = require(join(dirname(require.resolve('mongodb')), 'cmap', 'connection.js')) as {
      Connection: new (stream: PassThrough, options: object) => object;
    };
    const stream = new PassThrough();
    const connection = new Connection(stream, { ...this.options, id: 1, generation: 0 });
    connectionEnabled = Reflect.get(connection, 'monitorCommands');
    stream.destroy();
    throw new Error('fixture stops before network');
  });
  const close = vi.spyOn(MongoClient.prototype, 'close').mockResolvedValue();
  try {
    await expect(openPersistence(loadConfig({ PERSISTENCE_PROFILE: 'native-mongodb',
      MONGODB_URI: 'mongodb://never-connect.invalid', MONGODB_DB_NAME: 'synthetic' })))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    expect(enabled).toBe(true);
    expect(connectionEnabled).toBe(true);
  } finally { connect.mockRestore(); close.mockRestore(); }
});

it('preserves admission attribution across turn scope and command completion in another context', () => {
  const t = new Telemetry(() => undefined);
  const source = new EventEmitter();
  const stop = observeDatabaseCommands(source, 'synthetic', t);
  let counts: ReturnType<Telemetry['databaseCounts']> | undefined;
  t.inRequest('11111111-1111-4111-8111-111111111111', () => {
    t.inTurn({ sessionId: 's', turnId: 't', attemptId: 'a' }, () => {
      t.inDatabasePhase('admission', 'checkpoint', () => source.emit('commandStarted', {
        requestId: 8, databaseName: 'synthetic', commandName: 'getMore', command: { collection: 'checkpoints' },
      }));
    });
    t.inRequest('22222222-2222-4222-8222-222222222222', () => source.emit('commandSucceeded', {
      requestId: 8, commandName: 'getMore', duration: 7,
    }));
    counts = t.databaseCounts();
  });
  expect(counts).toMatchObject({ read: 1, write: 0 });
  expect(counts?.phases.admission).toBe(1);
  expect(counts?.origins.checkpoint).toBe(1);
  expect(counts?.collections.checkpoints).toBe(1);
  expect(t.snapshot().mongo_read.count).toBe(1);
  stop();
});

it('counts failures, cursor termination and process-wide pool waits without recording payloads', () => {
  const lines:string[] = [];
  const t = new Telemetry(line => lines.push(line));
  const source = new EventEmitter();
  const stop = observeDatabaseCommands(source, 'synthetic', t);
  source.emit('commandStarted', { requestId: 10, databaseName: 'synthetic', commandName: 'update',
    command: { update: 'metadata', updates: [{ secret: 'PRIVATE' }] } });
  source.emit('commandFailed', { requestId: 10, commandName: 'update', duration: 9, failure: new Error('SECRET') });
  source.emit('commandStarted', { requestId: 11, databaseName: 'synthetic', commandName: 'killCursors',
    command: { killCursors: 'messages', cursors: [123] } });
  source.emit('commandSucceeded', { requestId: 11, commandName: 'killCursors', duration: 3 });
  source.emit('connectionCheckedOut', { durationMS: 11, address: 'SECRET' });
  source.emit('connectionCheckOutFailed', { durationMS: 17, reason: 'SECRET' });
  expect(t.snapshot().mongo_write.count).toBe(1);
  expect(t.snapshot().mongo_failed.count).toBe(1);
  expect(t.snapshot().mongo_other.count).toBe(1);
  expect(t.snapshot().mongo_pool_wait).toMatchObject({ count: 2, sumMs: 28 });
  expect(lines.join('')).not.toMatch(/SECRET|PRIVATE|synthetic/);
  stop();
  expect(source.listenerCount('connectionCheckedOut')).toBe(0);
});

it('bounds in-flight metadata and expires stale observations without exposing event bodies', () => {
  const t = new Telemetry(() => undefined);
  let now = 0;
  vi.spyOn(t, 'monotonic').mockImplementation(() => now);
  const source = new EventEmitter();
  const stop = observeDatabaseCommands(source, 'synthetic', t);
  for (let id = 0; id < 4097; id++) source.emit('commandStarted', {
    requestId: id, databaseName: 'synthetic', commandName: 'find', command: { find: 'messages', secret: 'PRIVATE' },
  });
  expect(t.snapshot().mongo_observation_dropped.count).toBe(1);
  now = 120_001;
  source.emit('commandStarted', { requestId: 5000, databaseName: 'synthetic', commandName: 'find', command: {} });
  expect(t.snapshot().mongo_observation_dropped.count).toBe(4097);
  source.emit('commandSucceeded', { requestId: 0, duration: 1 });
  source.emit('commandSucceeded', { requestId: 5000, duration: 1 });
  expect(t.snapshot().mongo_read.count).toBe(1);
  stop();
});

it('cleans up listeners when observer installation fails', () => {
  const source = new EventEmitter();
  const original = source.on.bind(source);
  vi.spyOn(source, 'on').mockImplementation((name, listener) => {
    if (name === 'commandFailed') throw new Error('PRIVATE');
    return original(name, listener);
  });
  expect(() => observeDatabaseCommands(source, 'synthetic', new Telemetry(() => undefined))).not.toThrow();
  expect(source.listenerCount('commandStarted')).toBe(0);
  expect(source.listenerCount('commandSucceeded')).toBe(0);
});

it('reports interval union separately from the sum of overlapping commands', () => {
  const t = new Telemetry(() => undefined);
  let clock = 0;
  vi.spyOn(t, 'monotonic').mockImplementation(() => clock);
  const source = new EventEmitter();
  const stop = observeDatabaseCommands(source, 'synthetic', t);
  t.inDatabaseRequest(() => {
    for (let requestId=1; requestId<=3; requestId++) source.emit('commandStarted', {
      requestId, databaseName:'synthetic', commandName:'find', command:{ find:'messages' },
    });
    clock = 10;
    source.emit('commandSucceeded', { requestId:1, commandName:'find', duration:10 });
    expect(t.databaseCounts()).toMatchObject({ operationSumMs:30, busyMs:10, overlapMs:20, active:2 });
    for (let requestId=2; requestId<=3; requestId++) source.emit('commandSucceeded', {
      requestId, commandName:'find', duration:10,
    });
    expect(t.databaseCounts()).toMatchObject({ read:3, operationSumMs:30, busyMs:10, overlapMs:20 });
  });
  stop();
});

it('limits per-request command details while keeping total counts', () => {
  const t = new Telemetry(() => undefined);
  const source = new EventEmitter();
  const stop = observeDatabaseCommands(source, 'synthetic', t);
  t.inDatabaseRequest(() => {
    for (let id=0; id<130; id++) {
      source.emit('commandStarted', { requestId:id, databaseName:'synthetic', commandName:'find',
        command:{ find:'messages', filter:{ content:'PRIVATE' } } });
      source.emit('commandSucceeded', { requestId:id, duration:1, reply:{ secret:'PRIVATE' } });
    }
    const counts = t.databaseCounts();
    expect(counts.read).toBe(130);
    expect(counts.details).toHaveLength(128);
    expect(counts.droppedDetails).toBe(2);
    expect(JSON.stringify(counts)).not.toContain('PRIVATE');
  });
  stop();
});

it('classifies all stock read/write commands, ignores setup/control commands, and isolates unattributed completions inside another request', () => {
  const lines: string[] = [];
  const t = new Telemetry(line => lines.push(line));
  const source = new EventEmitter();
  const stop = observeDatabaseCommands(source, 'isolated-db', t);

  // Command 1 starts outside any request context (unattributed).
  source.emit('commandStarted', {
    requestId: 1, databaseName: 'isolated-db', commandName: 'find',
    command: { find: 'sessions', filter: { secret: 'PRIVATE_UNATTRIBUTED' } },
  });

  // Ignored setup/control commands and foreign database commands.
  source.emit('commandStarted', { requestId: 2, databaseName: 'isolated-db', commandName: 'hello', command: { hello: 1 } });
  source.emit('commandSucceeded', { requestId: 2, commandName: 'hello', duration: 5 });
  source.emit('commandStarted', { requestId: 3, databaseName: 'isolated-db', commandName: 'ping', command: { ping: 1 } });
  source.emit('commandSucceeded', { requestId: 3, commandName: 'ping', duration: 2 });
  source.emit('commandStarted', { requestId: 4, databaseName: 'isolated-db', commandName: 'createIndexes', command: { createIndexes: 'sessions' } });
  source.emit('commandSucceeded', { requestId: 4, commandName: 'createIndexes', duration: 4 });
  source.emit('commandStarted', { requestId: 5, databaseName: 'other-db', commandName: 'find', command: { find: 'sessions' } });
  source.emit('commandSucceeded', { requestId: 5, commandName: 'find', duration: 4 });
  source.emit('commandStarted', { requestId: -1, databaseName: 'isolated-db', commandName: 'find', command: { find: 'sessions' } });
  source.emit('commandSucceeded', { requestId: -1, commandName: 'find', duration: 4 });

  t.inRequest('11111111-1111-4111-8111-111111111111', () => {
    // Unattributed command 1 finishes while this request is active in ALS.
    source.emit('commandSucceeded', { requestId: 1, commandName: 'find', duration: 6 });

    const commands: Array<[number, string, Record<string, unknown>]> = [
      [10, 'find', { find: 'sessions', filter: { token: 'SECRET' } }],
      [11, 'getMore', { getMore: 99, collection: 'messages' }],
      [12, 'aggregate', { aggregate: 'metadata', pipeline: [{ $match: { secret: 'PRIVATE' } }] }],
      [13, 'count', { count: 'agent-memory' }],
      [14, 'distinct', { distinct: 'checkpoints' }],
      [15, 'insert', { insert: 'checkpoint_writes', documents: [{ secret: 'PRIVATE' }] }],
      [16, 'update', { update: 'integration_connections', updates: [{ secret: 'PRIVATE' }] }],
      [17, 'delete', { delete: 'metadata', deletes: [{ secret: 'PRIVATE' }] }],
      [18, 'findAndModify', { findAndModify: 'sessions', query: { secret: 'PRIVATE' } }],
      [19, 'bulkWrite', { bulkWrite: 'unknown-collection' }],
    ];
    for (const [requestId, commandName, command] of commands) {
      source.emit('commandStarted', { requestId, databaseName: 'isolated-db', commandName, command });
      source.emit('commandSucceeded', { requestId, commandName, duration: 3 });
    }
    const counts = t.databaseCounts();
    expect(counts.read).toBe(5);
    expect(counts.write).toBe(5);
    expect(counts.collections).toEqual({
      sessions: 2,
      messages: 1,
      'agent-memory': 1,
      metadata: 2,
      checkpoints: 1,
      checkpoint_writes: 1,
      integration_connections: 1,
      other: 1,
    });
    expect(counts.details.map(d => d.command)).toEqual([
      'find', 'getMore', 'aggregate', 'count', 'distinct',
      'insert', 'update', 'delete', 'findAndModify', 'bulkWrite',
    ]);
  });

  expect(t.snapshot().mongo_unattributed.count).toBe(1);
  expect(t.snapshot().mongo_read.count).toBe(6);
  expect(t.snapshot().mongo_write.count).toBe(5);
  expect(lines.join('')).not.toMatch(/PRIVATE|SECRET|isolated-db/);
  stop();
});

it('handles command failure after request return, invalid fields, throwing command getters, and sink failures safely', () => {
  const t = new Telemetry(() => { throw new Error('SINK_FAILURE'); });
  const source = new EventEmitter();
  const stop = observeDatabaseCommands(source, 'isolated-db', t);
  let requestCounts: () => ReturnType<Telemetry['databaseCounts']> = () => t.databaseCounts();

  t.inRequest('11111111-1111-4111-8111-111111111111', () => {
    const capture = t.captureDatabaseScope();
    requestCounts = () => {
      let c!: ReturnType<Telemetry['databaseCounts']>;
      capture(() => { c = t.databaseCounts(); });
      return c;
    };
    source.emit('commandStarted', {
      requestId: 77, databaseName: 'isolated-db', commandName: 'update',
      command: { update: 'sessions', updates: [{ q: { secret: 'PRIVATE' } }] },
    });
  });

  // Command 77 fails after inRequest has already returned.
  source.emit('commandFailed', { requestId: 77, commandName: 'update', duration: Number.NaN, failure: new Error('PRIVATE') });
  expect(requestCounts()).toMatchObject({ write: 1, failed: 1 });
  expect(t.snapshot().mongo_failed.count).toBe(1);

  // Invalid fields and throwing getters must never throw.
  expect(() => source.emit('commandStarted', null)).not.toThrow();
  expect(() => source.emit('commandStarted', {
    requestId: 88, databaseName: 'isolated-db', commandName: 'find',
    command: { get find() { throw new Error('SECRET_GETTER'); } },
  })).not.toThrow();
  expect(() => source.emit('commandSucceeded', null)).not.toThrow();
  expect(() => source.emit('connectionCheckedOut', { durationMS: Number.NaN })).not.toThrow();
  stop();
});
