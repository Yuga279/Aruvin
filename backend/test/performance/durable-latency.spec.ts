/**
 * ============================================================================
 * FILE: durable-latency.spec.ts
 * LOCATION: backend/test/performance/durable-latency.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Check the deterministic dependency-wave model used for latency experiments.
 *
 * ROLE IN PROJECT:
 *    Keeps concurrent storage commands distinct from sequential critical paths.
 *
 * KEY COMPONENTS:
 *    - Wave scheduler: Exercises independent and dependent commands offline.
 * ============================================================================
 */
import { DependencyProbe } from './dependency-probe.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { createLatencyFixture, type TurnMeasurement } from './latency-runtime-fixture.js';
import { textWire, createWire } from '../runtime/calendar-runtime.fixture.js';
import { callWire, loadWire } from '../assembly/skill-fixture.js';
import { Binary, type MongoClient } from 'mongodb';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';

// Independently rerun 35eb6e85d0b80f3d88abf32218120ce19a7a32d8, not values
// derived from the candidate. See acceptance-offline.md for snapshot commands.
// [scenario, complete wire commands, pre-dispatch waves, first-answer waves, post-seal waves]
const fixedBaseline = [
  ['new-text', 205, 84, 95, 73],
  ['follow-up-1', 201, 79, 90, 74],
  ['follow-up-20', 201, 79, 90, 74],
  ['follow-up-38-at-80-msg-ceiling', 203, 81, 92, 74],
  ['follow-up-39', 203, 81, 92, 74],
  ['follow-up-50-test-budget', 205, 82, 93, 74],
  ['calendar-text', 195, 107, 110, 48],
  ['calendar-read', 266, 107, 181, 48],
  ['calendar-create', 320, 107, 235, 48],
  ['calendar-conflict', 240, 107, 233, 48],
  ['calendar-proposal-reply', 278, 190, 193, 48],
  ['rejection-retry', 199, 79, 90, 74],
  ['cancel-before-dispatch', 92, null, null, null],
  ['cancel-midstream', 164, 84, null, null],
  ['reconnect-finalization-recovery', 89, null, 89, null],
] as const;

it('counts independent commands as one wave and dependent writes as two', async () => {
  const p = new DependencyProbe();
  const independent = Promise.all([
    p.command('read', 'find', 'messages', () => 1),
    p.command('read', 'find', 'metadata', () => 2),
  ]);
  p.advance(67, 449);
  expect(await independent).toEqual([1, 2]);
  expect(p.elapsedMs).toBe(67);
  const dependent = p.command('write', 'update', 'metadata', () => 1)
    .then(() => p.command('write', 'update', 'sessions', () => 2));
  p.advance(67, 449);
  await Promise.resolve();
  p.advance(67, 449);
  expect(await dependent).toBe(2);
  expect(p.waves).toBe(3);
  expect(p.elapsedMs).toBe(965);
});

it('models nested session updates and returns the requested post-update document', async () => {
  const f = calendarMemory();
  f.rows('sessions').set('session', { _id:'session', execution:{ ownerId:null, generation:1, activeAttemptId:'attempt' } });
  const sessions = f.store.db.collection('sessions');
  const result = await sessions.findOneAndUpdate({ _id:'session', 'execution.ownerId':null },
    { $set:{ 'execution.ownerId':'owner' }, $inc:{ 'execution.generation':1 } }, { returnDocument:'after' });
  expect(result).toMatchObject({ execution:{ ownerId:'owner', generation:2, activeAttemptId:'attempt' } });
  expect(await sessions.findOne({ _id:'session', 'execution.ownerId':'owner' })).toEqual(result);
});

it('uses Mongo-style missing/null matching and conditional nested updates', async () => {
  const f = calendarMemory();
  f.rows('sessions').set('s', { _id:'s', execution:{ generation:2 }, updatedAt:10 });
  const sessions=f.store.db.collection('sessions');
  const result=await sessions.updateOne({ $and:[{ _id:'s' },{ 'execution.ownerId':null },
    { 'execution.generation':{ $ne:3 } }] },
  { $set:{ 'execution.ownerId':'owner' }, $inc:{ 'execution.generation':1 }, $max:{ updatedAt:12 } });
  expect(result).toMatchObject({ acknowledged:true, matchedCount:1 });
  expect(await sessions.findOne({ _id:'s' })).toMatchObject({ updatedAt:12, execution:{ ownerId:'owner', generation:3 } });
  expect((await sessions.updateOne({ _id:'missing' }, { $inc:{ updatedAt:1 } })).matchedCount).toBe(0);
});

it('supports stock-saver cursor operations and BSON binary values', async () => {
  const f = calendarMemory();
  const collection = f.store.db.collection('checkpoints');
  await collection.insertOne({ _id:'a', checkpoint_id:'01', data:new Binary(Buffer.from('abc')) });
  await collection.insertOne({ _id:'b', checkpoint_id:'02', data:new Binary(Buffer.from('xyz')) });
  const cursor = collection.find({}).sort('checkpoint_id',-1).limit(1);
  expect(await cursor.hasNext()).toBe(true);
  const value = await cursor.next();
  expect(value?.checkpoint_id).toBe('02');
  expect(value?.data).toBeInstanceOf(Binary);
  expect(await cursor.hasNext()).toBe(false);
  await cursor.close();
});

it('defers fake-driver storage operations until the probe advances, including cursor consumption', async () => {
  const probe=new DependencyProbe();
  const f=calendarMemory(probe);
  f.rows('messages').set('m', { _id:'m', value:1 });
  const collection=f.store.db.collection('messages');
  const cursor=collection.find({});
  expect(probe.events).toHaveLength(0);
  f.rows('messages').set('m2', { _id:'m2', value:2 });
  const read=cursor.toArray();
  expect(probe.waiting).toBe(1);
  probe.advance(67,449);
  expect(await read).toMatchObject([{ _id:'m',value:1 },{ _id:'m2',value:2 }]);
  const write=collection.updateOne({ _id:'m' }, { $inc:{ value:1 } });
  expect(probe.waiting).toBe(1);
  probe.advance(67,449);
  expect((await write).matchedCount).toBe(1);
  expect(probe.events.map(e => e.kind)).toEqual(['read','write']);
});

it('delays ownership reads and compare-and-update at their actual execution boundaries', async () => {
  const probe=new DependencyProbe();
  const f=calendarMemory(probe);
  f.rows('sessions').set('s', { _id:'s', execution:{ generation:1 } });
  const c=f.store.db.collection('sessions');
  const read=c.findOne({ _id:'s' });
  expect(probe.waiting).toBe(1);
  probe.advance(67,449);
  expect(await read).toMatchObject({ execution:{ generation:1 } });
  const update=c.findOneAndUpdate({ _id:'s' }, { $inc:{ 'execution.generation':1 } }, { returnDocument:'after' });
  expect(probe.waiting).toBe(1);
  probe.advance(67,449);
  expect(await update).toMatchObject({ execution:{ generation:2 } });
});

it('delays inserts, replacements and deletes on the fake driver', async () => {
  const probe=new DependencyProbe();
  const f=calendarMemory(probe);
  const c=f.store.db.collection('sessions');
  const insert=c.insertOne({ _id:'s', value:1 });
  expect(probe.waiting).toBe(1); probe.advance(67,449); await insert;
  const replace=c.replaceOne({ _id:'s',value:1 },{ _id:'s',value:2 });
  expect(probe.waiting).toBe(1); probe.advance(67,449); await replace;
  const remove=c.deleteOne({ _id:'s',value:2 });
  expect(probe.waiting).toBe(1); probe.advance(67,449);
  expect((await remove).deletedCount).toBe(1);
  expect(probe.events.map(event => event.method)).toEqual(['insertOne','replaceOne','deleteOne']);
});

it('models an ordered update bulk as one wave and preserves upserted fields', async () => {
  const probe=new DependencyProbe();
  const f=calendarMemory(probe);
  const c=f.store.db.collection('metadata');
  const bulk=c.bulkWrite([
    { updateOne:{ filter:{ _id:'a' }, update:{ $set:{ value:1 } }, upsert:true } },
    { updateOne:{ filter:{ _id:'b' }, update:{ $setOnInsert:{ value:2 } }, upsert:true } },
  ]);
  expect(probe.waiting).toBe(1);
  probe.advance(67,449);
  await bulk;
  expect(probe.waves).toBe(1);
  expect(f.rows('metadata').get('a')).toMatchObject({ value:1 });
  expect(f.rows('metadata').get('b')).toMatchObject({ value:2 });
});

it('round-trips a checkpoint through the installed stock saver on the BSON fake', async () => {
  const f=calendarMemory();
  const client={ appendMetadata:() => undefined, db:() => f.store.db } as unknown as MongoClient;
  const saver=new MongoDBSaver({ client, dbName:'synthetic' });
  expect(await saver.setup()).toEqual([]);
  const config={ configurable:{ thread_id:'thread', checkpoint_ns:'' } };
  const checkpoint={ v:4 as const, id:'checkpoint-1', ts:'2026-10-28T00:00:00.000Z',
    channel_values:{ value:'synthetic' }, channel_versions:{ value:1 }, versions_seen:{} };
  await saver.put(config,checkpoint,{ source:'input',step:0,parents:{} },{});
  const tuple=await saver.getTuple(config);
  expect(tuple?.checkpoint).toEqual(checkpoint);
  expect(tuple?.pendingWrites).toEqual([]);
  await saver.putWrites({ configurable:{ ...config.configurable, checkpoint_id:'checkpoint-1' } },
    [['value', 'pending']], 'task-1');
  expect((await saver.getTuple(config))?.pendingWrites).toEqual([['task-1','value','pending']]);
});

it('supports per-command timer overlap mode and bounded microtask driving', async () => {
  const probe = new DependencyProbe('timer');
  const log: string[] = [];
  const op = async () => {
    const readChain = probe.command('read', 'findOne', 'sessions', () => 'r1').then(async v => {
      log.push(`${v}@${probe.elapsedMs}`);
      const r2 = await probe.command('read', 'findOne', 'messages', () => 'r2');
      log.push(`${r2}@${probe.elapsedMs}`);
      return r2;
    });
    const slowWrite = probe.command('write', 'updateOne', 'metadata', () => 'w1').then(v => {
      log.push(`${v}@${probe.elapsedMs}`);
      return v;
    });
    return Promise.all([readChain, slowWrite]);
  };
  await expect(probe.drive(op, 67, 449)).resolves.toEqual(['r2', 'w1']);
  expect(log).toEqual(['r1@67', 'r2@134', 'w1@449']);
  expect(probe.elapsedMs).toBe(449);

  const stuck = new DependencyProbe();
  await expect(stuck.drive(() => new Promise(() => undefined), 67, 449))
    .rejects.toThrow(/no progress/i);
});

it('supports projections, aggregate pipelines, Decimal128 round-trip, CAS mismatch, bulk item faults, and wire event parity', async () => {
  const { Decimal128 } = await import('mongodb');
  const { Telemetry } = await import('../../src/operations/telemetry.js');
  const { observeDatabaseCommands } = await import('../../src/persistence/database-observation.js');
  const probe = new DependencyProbe();
  const f = calendarMemory(probe, { databaseName: 'parity-db' });
  const t = new Telemetry(() => undefined, () => probe.elapsedMs);
  const stop = observeDatabaseCommands(f.commandSource, 'parity-db', t);
  try {
    await t.inDatabaseRequest(async () => {
      const col = f.store.db.collection('metadata');
      await probe.drive(async () => {
        await col.insertOne({ _id: 'd1', cost: Decimal128.fromString('0.0125'), secret: 'HIDDEN', nested: { keep: 7, drop: 8 } });
        const projected = await col.find({ _id: 'd1' }).project({ cost: 1, 'nested.keep': 1 }).toArray();
        expect(projected).toEqual([{ _id: 'd1', cost: Decimal128.fromString('0.0125'), nested: { keep: 7 } }]);
        const agg = await col.aggregate([{ $match: { _id: 'd1' } }, { $project: { secret: 0 } }]).toArray();
        expect(agg[0]?.secret).toBeUndefined();
        expect(agg[0]?.cost).toEqual(Decimal128.fromString('0.0125'));

        f.failNext('cas-mismatch');
        const casRes = await col.updateOne({ _id: 'd1', 'nested.keep': 7 }, { $set: { 'nested.keep': 99 } });
        expect(casRes.matchedCount).toBe(0);
        expect((await col.findOne({ _id: 'd1' }))?.nested.keep).toBe(7);

        f.failBulkItem(1, 'before-write');
        await expect(col.bulkWrite([
          { updateOne: { filter: { _id: 'b1' }, update: { $set: { v: 1 } }, upsert: true } },
          { updateOne: { filter: { _id: 'b2' }, update: { $set: { v: 2 } }, upsert: true } },
        ])).rejects.toThrow(/fixture bulk item failure/);
        expect(f.rows('metadata').get('b1')).toMatchObject({ v: 1 });
        expect(f.rows('metadata').get('b2')).toBeUndefined();
      }, 67, 449);

      const counts = t.databaseCounts();
      const wireReads = f.wireCalls.filter(c => c.kind === 'read').length;
      const wireWrites = f.wireCalls.filter(c => c.kind === 'write').length;
      const wireFailed = f.wireCalls.filter(c => c.failed).length;
      expect(counts.read).toBe(wireReads);
      expect(counts.write).toBe(wireWrites);
      expect(counts.failed).toBe(wireFailed);
    });
  } finally {
    stop();
  }
});

function assertNonSelfReferentialGates(
  fx: Awaited<ReturnType<typeof createLatencyFixture>>,
  probe: DependencyProbe,
  metrics: TurnMeasurement,
  expectedInput?: string,
) {
  expect(probe.waiting).toBe(0);
  expect(probe.events.every(e => e.endedAt !== null)).toBe(true);
  expect(fx.rawRuntime.snapshot()).toMatchObject({ active: 0, unresolvedWrites: 0 });

  expect(metrics.observerReads).toBe(metrics.wireReads);
  expect(metrics.observerWrites).toBe(metrics.wireWrites);
  expect(metrics.observerFailed).toBe(metrics.wireFailed);
  expect(Object.values(metrics.wireCommands).reduce((sum, n) => sum + n, 0))
    .toBe(metrics.wireReads + metrics.wireWrites);
  if (metrics.milestones.sealMs !== null) {
    expect(metrics.sealedCheckpointMs).not.toBeNull();
    expect(metrics.storageWaves.postSeal).toBeGreaterThan(0);
    expect(metrics.sealedCheckpointMs!).toBeLessThanOrEqual(metrics.milestones.sealMs);
  }

  for (const call of fx.modelCalls) {
    expect(call.user).toBe(fx.identity.userId);
    expect(call.model).toBe('fixture/model');
    expect((call.provider as { data_collection?: string } | undefined)?.data_collection).toBe('deny');
    const msgs = (call.messages ?? []) as Array<{
      role: string;
      content?: string | null;
      tool_calls?: Array<{ id: string }>;
      tool_call_id?: string;
    }>;
    if (expectedInput) {
      const matchingUsers = msgs.filter(m => m.role === 'user' && m.content === expectedInput);
      expect(matchingUsers).toHaveLength(1);
    }
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]!;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        const next = msgs[i + 1];
        expect(next?.role).toBe('tool');
        expect(next?.tool_call_id).toBe(m.tool_calls[0]!.id);
      }
    }
  }
}

async function seedCompletedTurns(
  fx: Awaited<ReturnType<typeof createLatencyFixture>>,
  count: number,
): Promise<string> {
  let sessionId: string | null = null;
  for (let i = 1; i <= count; i++) {
    const ids = await fx.probe.drive(() => fx.submit(`Prior question ${i}`, sessionId), 0, 0);
    sessionId = ids.sessionId;
    await fx.probe.drive(() => fx.execute(ids), 0, 0);
  }
  fx.frames.length = 0;
  fx.modelCalls.length = 0;
  return sessionId!;
}

describe('Task 5 — Admission ordering, staging phases and failure isolation', () => {
  it('enforces that input append and attempt insert precede acceptance marker and session latestTurnId', async () => {
    const probe = new DependencyProbe();
    const fx = await createLatencyFixture({ path: 'text', probe, readMs: 10, writeMs: 20 });
    try {
      const submissionPromise = probe.drive(() => fx.submit('Hello admission ordering'), 10, 20);
      const res = await submissionPromise;
      expect(res.attemptId).toBeDefined();

      const writeEvents = probe.events.filter(e => e.kind === 'write');
      const inputWrite = writeEvents.find(e => e.collection === 'messages' && e.method === 'updateOne');
      const metadataUpdates = writeEvents.filter(e => e.collection === 'metadata' && e.method === 'updateOne');
      const attemptWrite = metadataUpdates[2];
      const markerWrite = metadataUpdates[3];
      const sessionLatestTurnWrite = writeEvents.find(
        e => e.collection === 'sessions' && e.method === 'updateOne' && e.id > markerWrite.id,
      );

      expect(inputWrite).toBeDefined();
      expect(attemptWrite).toBeDefined();
      expect(markerWrite).toBeDefined();
      expect(sessionLatestTurnWrite).toBeDefined();

      // Both input and attempt writes must start and end before markerWrite and session update:
      expect(inputWrite!.endedAt!).toBeLessThanOrEqual(markerWrite!.startedAt);
      expect(attemptWrite!.endedAt!).toBeLessThanOrEqual(markerWrite!.startedAt);
      expect(markerWrite!.endedAt!).toBeLessThanOrEqual(sessionLatestTurnWrite!.startedAt);
    } finally {
      await fx.close();
    }
  });

  it('fails admission if input staging fails, leaving no acceptance marker or session latestTurnId and releasing clean after settlement', async () => {
    const probe = new DependencyProbe();
    const fx = await createLatencyFixture({ path: 'text', probe, readMs: 10, writeMs: 20 });
    try {
      fx.memory.failNext('before-write', { collection: 'messages', method: 'updateOne' });
      await expect(probe.drive(() => fx.submit('Will fail on message append'), 10, 20))
        .rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });

      // No acceptance marker must exist
      const markers = [...fx.memory.rows('metadata').values()].filter(d => d.kind === 'acceptance');
      expect(markers).toHaveLength(0);

      // Session must not have latestTurnId set
      const sessions = [...fx.memory.rows('sessions').values()];
      expect(sessions.every(s => s.latestTurnId === null)).toBe(true);
      expect(fx.rawRuntime.snapshot().active).toBe(0);
    } finally {
      await fx.close();
    }
  });

  it('preserves orphan input and allows identical resubmission but rejects different input', async () => {
    const probe = new DependencyProbe();
    const fx = await createLatencyFixture({ path: 'text', probe, readMs: 10, writeMs: 20 });
    try {
      const { sessionIdFor, turnIdFor, attemptIdFor, inputId } = await import('../../src/chat-runtime/identity.js');
      const { key } = await import('../../src/persistence/records.js');
      const s = sessionIdFor(fx.identity.userId, null, 'fixed-key-1');
      const t = turnIdFor(fx.identity.userId, s, 'fixed-key-1');
      const aId = attemptIdFor(fx.identity.userId, s, 'fixed-key-1');
      const mId = inputId(fx.identity.userId, s, aId);

      // Seed an orphan user message in messages collection
      const orphanRecord = {
        _id: key('message', fx.identity.userId, s, mId),
        schemaVersion: 1,
        userId: fx.identity.userId,
        sessionId: s,
        turnId: t,
        messageId: mId,
        eventId: mId,
        sequence: 0,
        role: 'user',
        content: 'Orphaned question',
        createdAt: new Date().toISOString(),
        completionStatus: 'accepted',
        attemptId: null,
        truncated: false,
      };
      fx.memory.rows('messages').set(orphanRecord._id, orphanRecord);
      const counterId = key('sequence-counter', fx.identity.userId, s);
      fx.memory.rows('metadata').set(counterId, {
        _id: counterId,
        schemaVersion: 1,
        kind: 'sequence-counter',
        userId: fx.identity.userId,
        sessionId: s,
        next: 1,
      });

      // Resubmission with DIFFERENT content under same idempotency key fails
      await expect(probe.drive(() => fx.submit('Different content', null, { idempotencyKey: 'fixed-key-1' }), 10, 20))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });

      // Resubmission with IDENTICAL content succeeds, completing admission
      const accepted = await probe.drive(() => fx.submit('Orphaned question', null, { idempotencyKey: 'fixed-key-1' }), 10, 20);
      expect(accepted.attemptId).toBeDefined();
      const markers = [...fx.memory.rows('metadata').values()].filter(d => d.kind === 'acceptance');
      expect(markers).toHaveLength(1);
    } finally {
      await fx.close();
    }
  });

  it('retries acceptance reusing original input without duplication', async () => {
    const probe = new DependencyProbe();
    const fx = await createLatencyFixture({ path: 'text', probe, readMs: 10, writeMs: 20 });
    try {
      const accepted = await probe.drive(() => fx.submit('Question to fail and retry'), 10, 20);
      // Run and simulate failure during inference
      fx.modelCalls.length = 0;
      await expect(
        probe.drive(
          () => fx.runtime.executeTurn({
            userId: fx.identity.userId,
            sessionId: accepted.sessionId,
            turnId: accepted.turnId,
            attemptId: accepted.attemptId,
            signal: new AbortController().signal,
            emit: async () => {
              throw new Error('Injected transport abort');
            },
          }),
          10,
          20,
        ),
      ).rejects.toThrow();

      // Turn is now failed/interrupted
      const userMessagesBefore = [...fx.memory.rows('messages').values()].filter(d => d.role === 'user').length;

      // Submit retry
      const retryAccepted = await probe.drive(
        () => fx.runtime.retryTurn({
          identity: fx.identity,
          sessionId: accepted.sessionId,
          turnId: accepted.turnId,
          idempotencyKey: 'retry-key-1',
        }),
        10,
        20,
      );
      expect(retryAccepted.attemptId).toBeDefined();

      // Original user message was reused without appending a second user message
      const userMessagesAfter = [...fx.memory.rows('messages').values()].filter(d => d.role === 'user').length;
      expect(userMessagesAfter).toBe(userMessagesBefore);

      // Verify two attempts exist for this turn
      const attempts = [...fx.memory.rows('metadata').values()].filter(d => d.kind === 'attempt' && d.turnId === accepted.turnId);
      expect(attempts).toHaveLength(2);
    } finally {
      await fx.close();
    }
  });
});

describe.each([
  { profile: '0ms', readMs: 0, writeMs: 0 },
  { profile: '67/449ms', readMs: 67, writeMs: 449 },
])('whole-runtime baseline scenarios ($profile)', ({ profile, readMs, writeMs }) => {
  const results = new Map<string, TurnMeasurement>();

  afterAll(() => {
    const summary = [...results.entries()].map(([scenario, m]) => ({
      profile,
      scenario,
      logicalOps: `${m.logicalReads}R/${m.logicalWrites}W`,
      wireOps: `${m.wireReads}R/${m.wireWrites}W/${m.wireFailed}F`,
      wireCommands: m.wireCommands,
      ownerReads: m.ownershipGuardReads,
      saverOps: `${m.saverReads}R/${m.saverWrites}W`,
      waves: m.waves,
      elapsedMs: m.elapsedMs,
      busyMs: m.busyMs,
      overlapMs: m.overlapMs,
      milestones: m.milestones,
      phases: m.phases,
      storageWaves: m.storageWaves,
      sealedCheckpointMs: m.sealedCheckpointMs,
      postSealTailMs: m.postSealTailMs,
    }));
    console.info(`BASELINE_SUMMARY_${profile}=${JSON.stringify(summary)}`);
  });

  it.each([
    { name: 'new-text', priorTurns: 0, maxMessages: 80 },
    { name: 'follow-up-1', priorTurns: 1, maxMessages: 80 },
    { name: 'follow-up-20', priorTurns: 20, maxMessages: 80 },
    { name: 'follow-up-38-at-80-msg-ceiling', priorTurns: 38, maxMessages: 80 },
    { name: 'follow-up-39', priorTurns: 39, maxMessages: 82 },
    { name: 'follow-up-50-test-budget', priorTurns: 50, maxMessages: 500 },
  ])('measures $name text turn and enforces non-self-referential gates', async ({ name, priorTurns, maxMessages }) => {
    const probe = new DependencyProbe();
    const fx = await createLatencyFixture({ path: 'text', probe, readMs, writeMs });
    Object.assign(fx, { probe });
    try {
      if (maxMessages !== 80) fx.setTestMaxMessagesInContext(maxMessages);
      const sessionId = priorTurns > 0 ? await seedCompletedTurns(fx, priorTurns) : null;
      if (priorTurns === 38 && maxMessages === 80) {
        const prompt = `Measured question for ${name}`;
        const { result: ids, metrics } = await fx.measure(async () => {
          const accepted = await fx.submit(prompt, sessionId);
          await fx.execute(accepted);
          return accepted;
        });
        results.set(name, metrics);
        assertNonSelfReferentialGates(fx, probe, metrics, prompt);
        // After 39 completed turns (78 history messages + 3 system + 1 new = 82 > 80), default 80-message bound rejects without silent truncation.
        await expect(probe.drive(() => fx.submit('Overflow turn 40', ids.sessionId), 0, 0))
          .rejects.toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED' });
        return;
      }
      const prompt = `Measured question for ${name}`;
      const { result: ids, metrics } = await fx.measure(async () => {
        const accepted = await fx.submit(prompt, sessionId);
        await fx.execute(accepted);
        return accepted;
      });
      results.set(name, metrics);
      assertNonSelfReferentialGates(fx, probe, metrics, prompt);

      const listed = await probe.drive(
        () => fx.persistence.messages.list(fx.identity.userId, ids.sessionId, { limit: 50 }),
        0,
        0,
      );
      for (let i = 1; i < listed.items.length; i++) {
        expect(listed.items[i]!.sequence).toBeGreaterThan(listed.items[i - 1]!.sequence);
      }
      const statuses = (fx.frames as Array<{ event: { type: string; status?: string } }>)
        .filter(f => f.event.type === 'status')
        .map(f => f.event.status);
      expect(statuses).toEqual(['generating', 'finalizing', 'completed']);
      expect(metrics.wireReads).toBeGreaterThan(0);
      expect(metrics.wireWrites).toBeGreaterThan(0);
      expect(metrics.phases.admission).toBeGreaterThan(0);
      expect(metrics.phases.context).toBeGreaterThan(0);
      expect(metrics.phases.publication).toBeGreaterThan(0);
    } finally {
      await fx.close();
    }
  });

  it('measures Calendar ordinary text, read, create, conflict, and proposal reply scenarios', async () => {
    // 1. Calendar ordinary text
    {
      const probe = new DependencyProbe();
      const fx = await createLatencyFixture({ path: 'calendar', probe, readMs, writeMs });
      try {
        fx.calendar!.modelWires.push(textWire('Your schedule is clear today.'));
        const prompt = 'How does my day look?';
        const { metrics } = await fx.measure(async () => {
          const ids = await fx.submit(prompt);
          await fx.execute(ids);
          return ids;
        });
        results.set('calendar-text', metrics);
        assertNonSelfReferentialGates(fx, probe, metrics, prompt);
        expect(fx.googleEffects).toHaveLength(0);
      } finally {
        await fx.close();
      }
    }

    // 2. Calendar read (calendar_get_event)
    {
      const probe = new DependencyProbe();
      const fx = await createLatencyFixture({ path: 'calendar', probe, readMs, writeMs });
      try {
        const readCall = callWire('calendar_get_event', {
          calendarId: 'personal@example.test', eventId: 'evt_100' }, 'call_read_1');
        fx.calendar!.modelWires.push(loadWire(['calendar_get_event'], 'latency-read-load'),
          readCall, textWire('The Planning event is from 10:00 to 11:00 UTC.'));
        const prompt = 'Show event evt_100 on my Personal calendar.';
        const { metrics } = await fx.measure(async () => {
          const ids = await fx.submit(prompt);
          await fx.execute(ids);
          return ids;
        });
        results.set('calendar-read', metrics);
        assertNonSelfReferentialGates(fx, probe, metrics, prompt);
        expect(fx.googleEffects.filter(e => e.kind === 'get')).toHaveLength(1);
        expect(fx.googleEffects.filter(e => e.kind === 'create')).toHaveLength(0);
      } finally {
        await fx.close();
      }
    }

    // 3. Calendar direct create (calendar_create_event)
    {
      const probe = new DependencyProbe();
      const fx = await createLatencyFixture({ path: 'calendar', probe, readMs, writeMs });
      try {
        fx.calendar!.modelWires.push(
          loadWire(['calendar_create_event'], 'latency-create-load'),
          createWire({
            summary: 'Planning',
            start: '2026-11-03T10:00:00+00:00',
            end: '2026-11-03T11:00:00+00:00',
            timeZone: 'Etc/UTC',
          }, 'create-one'),
          textWire('I scheduled Planning on Work from 10:00 to 11:00 Etc/UTC.'),
        );
        const prompt = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';
        const { metrics } = await fx.measure(async () => {
          const ids = await fx.submit(prompt);
          await fx.execute(ids);
          return ids;
        });
        results.set('calendar-create', metrics);
        assertNonSelfReferentialGates(fx, probe, metrics, prompt);
        expect(fx.googleEffects.filter(e => e.kind === 'create')).toHaveLength(1);
      } finally {
        await fx.close();
      }
    }

    // 4 & 5. Calendar conflict and proposal reply
    {
      const probe = new DependencyProbe();
      const fx = await createLatencyFixture({ path: 'calendar', probe, readMs, writeMs });
      try {
        fx.calendar!.setAvailability({
          busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }],
        });
        fx.calendar!.modelWires.push(
          loadWire(['calendar_create_event'], 'latency-conflict-load'),
          createWire({
            summary: 'Planning',
            start: '2026-11-03T10:00:00+00:00',
            end: '2026-11-03T11:00:00+00:00',
            timeZone: 'Etc/UTC',
          }, 'create-one'),
        );
        const conflictPrompt = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.';
        const { result: conflictIds, metrics: conflictMetrics } = await fx.measure(async () => {
          const ids = await fx.submit(conflictPrompt);
          await fx.execute(ids);
          return ids;
        });
        results.set('calendar-conflict', conflictMetrics);
        assertNonSelfReferentialGates(fx, probe, conflictMetrics, conflictPrompt);
        expect(fx.googleEffects.filter(e => e.kind === 'create')).toHaveLength(0);

        const proposal = await probe.drive(
          () => fx.calendar!.currentProposal(conflictIds.sessionId),
          0,
          0,
        );
        expect(proposal?.state).toBe('pending');

        fx.modelCalls.length = 0;
        fx.calendar!.modelWires.push(textWire('Created despite the disclosed conflict.'));
        const replyPrompt = 'Yes, go ahead';
        const { metrics: replyMetrics } = await fx.measure(async () => {
          const replyIds = await fx.submit(replyPrompt, conflictIds.sessionId, {
            calendarReplyTo: { proposalId: proposal!.proposalId, revision: proposal!.revision },
          });
          await fx.execute(replyIds);
          return replyIds;
        });
        results.set('calendar-proposal-reply', replyMetrics);
        assertNonSelfReferentialGates(fx, probe, replyMetrics, replyPrompt);
        expect(fx.googleEffects.filter(e => e.kind === 'create')).toHaveLength(1);
      } finally {
        await fx.close();
      }
    }
  });

  it('measures rejection retry, cancellation before dispatch/midstream, and reconnect/finalization recovery', async () => {
    // 1. Rejection retry
    {
      const probe = new DependencyProbe();
      const fx = await createLatencyFixture({ path: 'text', probe, readMs, writeMs });
      try {
        const firstIds = await probe.drive(() => fx.submit('Retryable question'), 0, 0);
        fx.fetcher.mockRejectedValueOnce(new Error('Provider temporary outage'));
        await expect(probe.drive(() => fx.execute(firstIds), 0, 0)).rejects.toMatchObject({ code: 'INTERRUPTED' });
        fx.modelCalls.length = 0;

        const { metrics } = await fx.measure(async () => {
          const retried = await fx.retry(firstIds.sessionId, firstIds.turnId);
          await fx.execute(retried);
          return retried;
        });
        results.set('rejection-retry', metrics);
        assertNonSelfReferentialGates(fx, probe, metrics, 'Retryable question');
      } finally {
        await fx.close();
      }
    }

    // 2. Cancellation before dispatch
    {
      const probe = new DependencyProbe();
      const fx = await createLatencyFixture({ path: 'text', probe, readMs, writeMs });
      try {
        const { result: ids, metrics } = await fx.measure(async () => {
          const accepted = await fx.submit('Cancel me before dispatch');
          await fx.runtime.cancelTurn({
            identity: fx.identity,
            sessionId: accepted.sessionId,
            turnId: accepted.turnId,
            attemptId: accepted.attemptId,
          });
          return accepted;
        });
        results.set('cancel-before-dispatch', metrics);
        assertNonSelfReferentialGates(fx, probe, metrics);
        expect(fx.modelCalls).toHaveLength(0);
        const status = await probe.drive(
          () => fx.runtime.getTurnStatus(fx.identity.userId, ids.sessionId, ids.turnId),
          0,
          0,
        );
        expect(status.status).toBe('cancelled');
      } finally {
        await fx.close();
      }
    }

    // 3. Cancellation midstream
    {
      const probe = new DependencyProbe();
      const fx = await createLatencyFixture({ path: 'text', probe, readMs, writeMs });
      try {
        const abort = new AbortController();
        const { result: ids, metrics } = await fx.measure(async () => {
          const accepted = await fx.submit('Cancel me midstream');
          await expect(
            fx.runtime.executeTurn({
              userId: fx.identity.userId,
              sessionId: accepted.sessionId,
              turnId: accepted.turnId,
              attemptId: accepted.attemptId,
              signal: abort.signal,
              emit: async env => {
                fx.frames.push(env);
                if (env.event.type === 'delta') abort.abort();
              },
            }),
          ).rejects.toMatchObject({ code: 'INTERRUPTED' });
          return accepted;
        });
        results.set('cancel-midstream', metrics);
        assertNonSelfReferentialGates(fx, probe, metrics, 'Cancel me midstream');
        const status = await probe.drive(
          () => fx.runtime.getTurnStatus(fx.identity.userId, ids.sessionId, ids.turnId),
          0,
          0,
        );
        expect(status.status).toBe('interrupted');
      } finally {
        await fx.close();
      }
    }

    // 4. Reconnect and finalization recovery without model replay
    {
      const probe = new DependencyProbe();
      const fx = await createLatencyFixture({ path: 'text', probe, readMs, writeMs });
      try {
        const accepted = await probe.drive(() => fx.submit('Recover my sealed answer'), 0, 0);
        // Inject failure on assistant archive insert during publication after checkpoint is sealed.
        fx.memory.failNext('before-write', { collection: 'messages', method: 'updateOne' });
        await expect(probe.drive(() => fx.execute(accepted), 0, 0)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
        expect(fx.rawRuntime.work.degraded).toBe(true);
        // Simulate process/executor recovery clearing degraded flag and releasing leftover active work slot.
        fx.rawRuntime.work.degraded = false;
        const activeWork = fx.rawRuntime.work.get(fx.identity.userId, accepted.sessionId);
        activeWork?.close();
        await probe.drive(
          () => fx.memory.store.db.collection('sessions').updateOne(
            { userId: fx.identity.userId, sessionId: accepted.sessionId },
            { $set: { 'execution.ownerId': null, 'execution.leaseExpiresAt': null } },
          ),
          0,
          0,
        );

        const modelCallsBeforeRecovery = fx.modelCalls.length;
        fx.frames.length = 0;

        const { metrics } = await fx.measure(async () => {
          await fx.runtime.reconcileSession(fx.identity.userId, accepted.sessionId);
          await fx.execute(accepted);
        });
        results.set('reconnect-finalization-recovery', metrics);
        assertNonSelfReferentialGates(fx, probe, metrics, 'Recover my sealed answer');
        // No model replay occurred during reconciliation or reconnect!
        expect(fx.modelCalls).toHaveLength(modelCallsBeforeRecovery);
        const completedFrame = (fx.frames as Array<{ event: { type: string; outcome?: string } }>)
          .find(f => f.event.type === 'completed');
        expect(completedFrame?.event.outcome).toBe('completed');
      } finally {
        await fx.close();
      }
    }
  });

  // Keep correctness scenarios runnable separately from the deliberately strict
  // gates. Existing misses remain RED, never expected-fail, skipped or rebased.
  if (readMs !== 0) {
    it.each(fixedBaseline)('fixed baseline regression caps: %s', (name, commands, pre, answer, post) => {
      const m = results.get(name)!;
      expect(m, 'scenario must run before its fixed gate').toBeDefined();
      console.log('DURABLE_BASELINE', JSON.stringify({ name,
        commands: m.wireReads + m.wireWrites, commandCap: commands,
        preDispatch: m.storageWaves.preDispatch, preDispatchCap: pre,
        firstAnswer: m.storageWaves.firstAnswer, firstAnswerCap: answer,
        postSeal: m.storageWaves.postSeal, postSealCap: post,
        acceptanceCommands: Math.floor(commands * 0.75),
        acceptancePre: pre === null ? null : Math.floor(pre * 0.7),
        acceptancePost: post === null ? null : Math.floor(post * 0.7) }));
      expect.soft(m.wireReads + m.wireWrites, 'complete native-command regression').toBeLessThanOrEqual(commands);
      expect.soft(Object.values(m.wireCommands).reduce((sum, n) => sum + n, 0)).toBe(m.wireReads + m.wireWrites);
      for (const [key, cap] of [['preDispatch', pre], ['firstAnswer', answer], ['postSeal', post]] as const) {
        if (cap === null) expect.soft(m.storageWaves[key], `${key} must be explicitly unavailable`).toBeNull();
        else {
          expect.soft(m.storageWaves[key], `${key} boundary must exist`).not.toBeNull();
          expect.soft(m.storageWaves[key], `${key} wave regression`).toBeLessThanOrEqual(cap);
        }
      }
    });

    it.each(fixedBaseline)('acceptance targets (30% pre / 25% commands / 30% post): %s', (name, commands, pre, _answer, post) => {
      const m = results.get(name)!;
      expect.soft(m.wireReads + m.wireWrites, '25% fewer COMPLETE native commands').toBeLessThanOrEqual(Math.floor(commands * 0.75));
      if (pre !== null) expect.soft(m.storageWaves.preDispatch, '30% fewer PRE-DISPATCH waves').toBeLessThanOrEqual(Math.floor(pre * 0.7));
      if (post !== null) expect.soft(m.storageWaves.postSeal, '30% fewer POST-SEAL waves').toBeLessThanOrEqual(Math.floor(post * 0.7));
    });
  }
});
