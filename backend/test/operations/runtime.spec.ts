/**
 * ============================================================================
 * FILE: runtime.spec.ts
 * LOCATION: backend/test/operations/runtime.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove runtime observation delegates envelopes and never fakes completion.
 *
 * ROLE IN PROJECT:
 *    Locks stream timing, provider-outage metrics, and recovery failures to the
 *    existing P5 port without stopping acceptance or inventing events.
 *
 * KEY COMPONENTS:
 *    - Envelope pass-through: Six fixture events, honest finalization timing.
 *    - Calendar observation: One telemetry record per protocol-2/3 frame.
 *    - Null runtime: Command rejection with visible reconciliation failures.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { observedRuntime } from '../../src/operations/observed-runtime.js';
import { Readiness } from '../../src/operations/readiness.js';
import { Telemetry } from '../../src/operations/telemetry.js';
import { options } from './fixtures.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
it('passes envelopes unchanged, observes honest finalization and never creates a completed event', async () => {
  const { o } = options(); let clock=0; const t = new Telemetry(() => undefined,() => clock++);
  const r = observedRuntime(o.runtime,t,new Readiness(o)); const events:unknown[] = [];
  await r.executeTurn({ userId:'server-user',sessionId:'s1',turnId:'t1',attemptId:'a1',
    signal:new AbortController().signal,emit:async e => { events.push(e); } });
  expect(events).toHaveLength(6); expect(t.snapshot().first_output.count).toBe(1);
  expect(t.snapshot().finalization.count).toBe(1); expect(t.snapshot().total_run.count).toBe(1);
});
it('propagates failure and records outage without stopping runtime', async () => {
  const { o,runtime } = options(); const ready = new Readiness(o);
  vi.spyOn(runtime,'executeTurn').mockRejectedValue(new AppError('PROVIDER_ERROR','private provider body'));
  const r = observedRuntime(o.runtime,new Telemetry(() => undefined),ready);
  await expect(r.executeTurn({ userId:'server-user',sessionId:'s1',turnId:'t1',attemptId:'a1',
    signal:new AbortController().signal,emit:async () => undefined })).rejects.toMatchObject({ code:'PROVIDER_ERROR' });
  expect(await ready.read()).toMatchObject({ provider:'degraded' });
  expect(runtime.stopAccepting).not.toHaveBeenCalled();
});
it('null-runtime diagnostics reject commands, and reconciliation failures stay visible', async () => {
  const { o,runtime }=options(); const t=new Telemetry(() => undefined);
  const ready=new Readiness(o); const r=observedRuntime(o.runtime,t,ready);
  vi.spyOn(runtime,'reconcileSession').mockRejectedValue(new AppError('PERSISTENCE_ERROR','secret'));
  await expect(r.reconcileSession('u','s')).rejects.toMatchObject({ code:'PERSISTENCE_ERROR' });
  expect(t.snapshot().reconciliation_failure.count).toBe(1);
  const missing=observedRuntime(() => null,t,ready);
  expect(() => missing.submitTurn({ identity:{ userId:'u',source:'authenticated-session',openRouterUser:'u' },
    sessionId:null,content:'Hello',idempotencyKey:'key' })).toThrow(expect.objectContaining({ code:'NOT_READY' }));
});
it('records the same Calendar telemetry for a protocol-2 and a protocol-3 frame and forwards both unchanged', async () => {
  const { o,runtime } = options(); const lines:string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  const r = observedRuntime(o.runtime,t,new Readiness(o));
  const scope = { sessionId:'s1',turnId:'t1',attemptId:'a1' };
  const frames = [
    { protocolVersion:2 as const, ...scope, sequence:0,
      event:{ type:'calendar-progress' as const, phase:'repairing' as const } },
    { protocolVersion:2 as const, ...scope, sequence:1,
      event:{ type:'calendar-operation' as const, operation:{ operationId:'op-v1',state:'succeeded' as const,
        narration:'pending' as const,retryAction:'none' as const,
        receipt:{ durable:true as const,eventId:'evt12',htmlLink:null,expiresAt:null } } } },
    { protocolVersion:3 as const, ...scope, sequence:2,
      event:{ type:'calendar-progress' as const, phase:'executing' as const } },
    { protocolVersion:3 as const, ...scope, sequence:3,
      event:{ type:'calendar-operation' as const, operation:{ schemaVersion:2 as const,operationId:'op-v2',
        state:'succeeded' as const,narration:'pending' as const,retryAction:'none' as const,
        receipt:{ durable:true as const,eventId:'evt13',htmlLink:null,expiresAt:null,calendarLabel:null } } } },
  ];
  vi.spyOn(runtime,'executeTurn').mockImplementation(async c => {
    for (const frame of frames) await c.emitCalendar!(frame);
  });
  const forwarded:unknown[] = [];
  await r.executeTurn({ userId:'server-user',sessionId:'s1',turnId:'t1',attemptId:'a1',
    signal:new AbortController().signal,emit:async e => { forwarded.push(e); },
    emitCalendar:async e => { forwarded.push(e); } });
  expect(forwarded).toEqual(frames);
  const hashed = (value:string) => 'h:'+createHash('sha256').update(value).digest('hex').slice(0,24);
  const calendar = lines.map(line => JSON.parse(line) as Record<string,unknown>)
    .filter(record => record.kind === 'calendar');
  expect(calendar).toHaveLength(4);
  expect(calendar.filter(record => record.phase !== undefined).map(record => record.phase))
    .toEqual(['repairing','executing']);
  expect(calendar.filter(record => record.operationId !== undefined).map(record => record.operationId))
    .toEqual([hashed('op-v1'),hashed('op-v2')]);
});
it('forwards stream reservation and quiescence from the raw runtime', async () => {
  const { o } = options();
  const slot = { userId: 'u', sessionId: 's', signal: new AbortController().signal,
    run: vi.fn(), release: vi.fn() };
  const raw = {
    reserveStream: vi.fn(() => slot),
    quiesceStreams: vi.fn(async () => ({ drained: true, active: 0, unresolvedWrites: 0, fenced: true as const })),
    releaseStreamFence: vi.fn(),
  };
  const observed = observedRuntime(() => raw as never, new Telemetry(() => undefined), new Readiness(o));
  const signal = new AbortController().signal;
  expect(observed.reserveStream?.('u', 's', signal)).toBe(slot);
  expect(raw.reserveStream).toHaveBeenCalledWith('u', 's', signal);
  await expect(observed.quiesceStreams?.(5_000)).resolves.toMatchObject({ drained: true, fenced: true });
  observed.releaseStreamFence?.();
  expect(raw.releaseStreamFence).toHaveBeenCalledTimes(1);
  const bare = observedRuntime(() => null, new Telemetry(() => undefined), new Readiness(o));
  expect(bare.reserveStream).toBeUndefined();
  expect(bare.quiesceStreams).toBeUndefined();
  expect(bare.releaseStreamFence).toBeUndefined();
});
it('traces ordinary chat without printing private errors or making diagnostics a dependency', async () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  const h = textConfigFixture(textSnapshot(1), d => ({ ...d, diagnostics: {
    emit: fields => t.event('process', fields), run: (scope, work) => t.inDiagnosticScope(scope, work),
  } }));
  const rawPrint = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const ids = await h.submit('PRIVATE_USER_MESSAGE');
    await h.execute(ids);
    const records = lines.map(line => JSON.parse(line));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'admission', state: 'ok' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'context', state: 'ok' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'finalization', state: 'ok' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'task-outcome', task: 'not-applicable' }));
    expect(lines.join('\n')).not.toContain('PRIVATE_USER_MESSAGE');
    expect(rawPrint).not.toHaveBeenCalled();
  } finally { rawPrint.mockRestore(); await h.dispose(); }
});

it.each([2, 3] as const)('measures first output and finalization for Calendar protocol %i', async protocolVersion => {
  const { o, runtime } = options(); const t = new Telemetry(() => undefined);
  const r = observedRuntime(o.runtime, t, new Readiness(o));
  const scope = { sessionId: 's1', turnId: 't1', attemptId: 'a1' };
  vi.spyOn(runtime, 'executeTurn').mockImplementation(async c => {
    const events = [{ type: 'delta' as const, text: 'Hi' },
      { type: 'status' as const, status: 'finalizing' as const, truncated: false },
      { type: 'status' as const, status: 'completed' as const, truncated: false },
      { type: 'completed' as const, assistantMessageId: 'm2', outcome: 'completed' as const }];
    for (const [sequence, event] of events.entries()) await c.emitCalendar!({ protocolVersion, ...scope, sequence, event });
  });
  await r.executeTurn({ userId: 'server-user', ...scope, signal: new AbortController().signal,
    emit: async () => {}, emitCalendar: async () => {} });
  expect(t.snapshot().first_output.count).toBe(1);
  expect(t.snapshot().finalization.count).toBe(1);
});

it('redacts a private ordinary-chat provider exception in the runtime catch', async () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  const h = textConfigFixture(textSnapshot(1), d => ({ ...d, diagnostics: {
    emit: fields => t.event('process', fields), run: (scope, work) => t.inDiagnosticScope(scope, work),
  } }));
  const rawPrint = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const ids = await h.submit('PRIVATE_USER_MESSAGE');
    h.fetcher.mockRejectedValue(new Error('PRIVATE_EXCEPTION'));
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'INTERRUPTED' });
    expect(await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))
      .toMatchObject({ status: 'interrupted', errorCode: 'INTERRUPTED' });
    const records = lines.map(line => JSON.parse(line) as Record<string, unknown>);
    expect(records).toContainEqual(expect.objectContaining({ stage: 'model-dispatch', state: 'error',
      reason: 'provider-error', code: 'INTERRUPTED', delivery: 'attempted' }));
    expect(records).toContainEqual(expect.objectContaining({ stage: 'runtime-error', state: 'error', code: 'INTERRUPTED' }));
    expect(rawPrint).not.toHaveBeenCalled();
    for (const value of ['PRIVATE_USER_MESSAGE', 'PRIVATE_EXCEPTION', 'Error: PRIVATE_EXCEPTION']) {
      expect(lines.join('\n')).not.toContain(value);
    }
  } finally { rawPrint.mockRestore(); await h.dispose(); }
});

it('counts admission database work across nested turn scopes in its returned summary', async () => {
  const { o, runtime } = options();
  const lines:string[] = [];
  const t = new Telemetry(line => lines.push(line));
  vi.spyOn(runtime, 'submitTurn').mockImplementation(async () => {
    t.inTurn({ sessionId:'s', turnId:'t', attemptId:'a' }, () => {
      t.recordMongoCommand('read', 2, false);
      expect(t.databaseCounts().phases.admission).toBe(1);
    });
    return { sessionId:'s', turnId:'t', attemptId:'a', status:'accepted' } as never;
  });
  const r = observedRuntime(o.runtime, t, new Readiness(o));
  await r.submitTurn({ identity:{ userId:'u',source:'authenticated-session',openRouterUser:'u' },
    sessionId:null,content:'hello',idempotencyKey:'key' });
  const summaries = lines.map(line => JSON.parse(line)).filter(record => record.stage === 'admission' && record.state === 'ok');
  expect(summaries).toHaveLength(1);
  expect(summaries[0].mongoReads).toBe(1);
});

it('emits one execution timing summary even when terminal status and completed both arrive', async () => {
  const { o } = options();
  const lines:string[] = [];
  const t = new Telemetry(line => lines.push(line));
  const r = observedRuntime(o.runtime, t, new Readiness(o));
  await r.executeTurn({ userId:'u', sessionId:'s', turnId:'t', attemptId:'a',
    signal:new AbortController().signal, emit:async () => undefined });
  const terminals = lines.map(line => JSON.parse(line)).filter(record => record.stage === 'terminal');
  expect(terminals).toHaveLength(1);
});

it('enters deterministic turn diagnostics before the first acceptance lookup', async () => {
  const context = new AsyncLocalStorage<Record<string, string>>();
  let first:Record<string, string> | undefined;
  const h = textConfigFixture(textSnapshot(1), d => {
    const get = d.persistence.sessions.get.bind(d.persistence.sessions);
    d.persistence.sessions.get = async (...args) => {
      first ??= context.getStore();
      return get(...args);
    };
    return { ...d, diagnostics: { emit: () => undefined,
      run: (scope, work) => context.run(scope as Record<string,string>, work) } };
  });
  try {
    const ids = await h.submit('Synthetic');
    expect(first).toMatchObject({ sessionId:ids.sessionId, turnId:ids.turnId, attemptId:ids.attemptId });
  } finally { await h.dispose(); }
});

it('preserves originating phase and separates ownership vs repository origins across queued ownership operations', async () => {
  const t = new Telemetry(() => undefined);
  const { calendarMemory } = await import('../persistence/calendar-multi-memory.js');
  const { MongoOwnership } = await import('../../src/persistence/ownership.js');
  const { MongoSessions } = await import('../../src/persistence/sessions.js');
  const { MongoMessages } = await import('../../src/persistence/messages.js');
  const { DEFAULT_BUDGETS } = await import('../../src/contracts/budgets.js');
  const { observePersistence } = await import('../../src/operations/observe-persistence.js');
  const { EventEmitter } = await import('node:events');
  const mem = calendarMemory();
  const source = new EventEmitter();
  let reqId = 0;
  const origCollection = mem.store.db.collection.bind(mem.store.db);
  vi.spyOn(mem.store.db, 'collection').mockImplementation((name: string) => {
    const col = origCollection(name);
    return new Proxy(col, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);
        if (typeof val !== 'function') return val;
        const commandName = prop === 'findOne' ? 'find' : prop === 'findOneAndUpdate' ? 'findAndModify' : 'update';
        return async (...args: unknown[]) => {
          const id = ++reqId;
          source.emit('commandStarted', { requestId: id, databaseName: 'q-test', commandName, command: { [commandName]: name } });
          const res = await Reflect.apply(val, target, args);
          source.emit('commandSucceeded', { requestId: id, commandName, duration: 2 });
          return res;
        };
      },
    });
  });
  const owner = new MongoOwnership(mem.store, 'exec-1');
  await owner.claimExecutor();
  const sessions = new MongoSessions(mem.store, DEFAULT_BUDGETS);
  const messages = new MongoMessages(mem.store, DEFAULT_BUDGETS);
  const { observeDatabaseCommands } = await import('../../src/persistence/database-observation.js');
  const observed = observePersistence({
    owner, sessions, messages, memory: {} as never, metadata: {} as never, checkpoints: { create: async () => ({ setup: async () => {}, bind: () => ({}) as never }) } as never,
    observeDatabase: (tel: Telemetry) => observeDatabaseCommands(source, 'q-test', tel),
  } as never, t);
  const { graphThreadId } = await import('../../src/persistence/records.js');
  try {
    await observed.sessions.createIfAbsent({
      schemaVersion: 1, userId: 'u1', sessionId: 's-queue', title: 'Queue',
      createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
      lastActivityAt: '2026-10-28T00:00:00.000Z', lifecycle: 'active',
      graphThreadId: graphThreadId('u1', 's-queue'), latestTurnId: null,
      execution: { ownerId: null, leaseExpiresAt: null, activeAttemptId: null, generation: 0 },
    });
    const acquired = await observed.owner.acquire({
      userId: 'u1', sessionId: 's-queue', ownerId: observed.owner.executorId, leaseMs: 60_000,
    });
    if (!acquired.ok) throw new Error('expected lease');

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(r => { releaseFirst = r; });

    const firstOp = t.inDatabaseRequest(() => t.inDatabasePhase('admission', 'other', () =>
      observed.owner.run(acquired.lease, async () => {
        await firstGate;
      })));

    let secondCounts: ReturnType<Telemetry['databaseCounts']> | undefined;
    const secondOp = t.inDatabaseRequest(() => t.inDatabasePhase('publication', 'other', async () => {
      await observed.owner.run(acquired.lease, async () => {
        await observed.messages.get('u1', 's-queue', 'm-none');
      });
      secondCounts = t.databaseCounts();
    }));

    releaseFirst();
    await Promise.all([firstOp, secondOp]);
    expect(secondCounts?.phases.publication).toBe(3);
    expect(secondCounts?.phases.admission).toBe(0);
    expect(secondCounts?.origins.ownership).toBe(2);
    expect(secondCounts?.origins.repository).toBe(1);
  } finally {
    vi.restoreAllMocks();
  }
});

it('distinguishes acceptance-durable, admission-returned, attempt-terminal-durable, slot-released, and terminal-delivered milestones', async () => {
  const lines: string[] = [];
  const t = new Telemetry(line => { lines.push(line); });
  const h = textConfigFixture(textSnapshot(1), d => ({
    ...d,
    diagnostics: {
      emit: fields => t.event('process', fields),
      run: (scope, work) => t.inDiagnosticScope(scope, work),
    },
  }));
  const ready = new Readiness(options().o);
  const r = observedRuntime(() => h.runtime, t, ready);
  try {
    const ids = await r.submitTurn({
      identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'req-milestone-1',
    });
    await r.executeTurn({
      userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => undefined,
    });
    const stages = lines.map(line => (JSON.parse(line) as { stage?: string }).stage);
    const idx = (s: string) => stages.indexOf(s);
    expect(idx('acceptance-durable')).toBeGreaterThanOrEqual(0);
    expect(idx('admission-returned')).toBeGreaterThan(idx('acceptance-durable'));
    expect(idx('attempt-terminal-durable')).toBeGreaterThan(idx('admission-returned'));
    expect(idx('slot-released')).toBeGreaterThan(idx('attempt-terminal-durable'));
    expect(idx('terminal-delivered')).toBeGreaterThan(idx('slot-released'));
  } finally {
    await h.dispose();
  }
});

it('records retry admission database counts in its returned summary', async () => {
  const { o, runtime } = options();
  const lines: string[] = [];
  const t = new Telemetry(line => lines.push(line));
  vi.spyOn(runtime, 'retryTurn').mockImplementation(async () => {
    t.inTurn({ sessionId: 's', turnId: 't', attemptId: 'a2' }, () => {
      t.recordMongoCommand('read', 3, false);
      t.recordMongoCommand('read', 4, false);
      t.recordMongoCommand('write', 2, false);
    });
    return { sessionId: 's', turnId: 't', attemptId: 'a2', status: 'accepted' } as never;
  });
  const r = observedRuntime(o.runtime, t, new Readiness(o));
  await r.retryTurn({
    identity: { userId: 'u', source: 'authenticated-session', openRouterUser: 'u' },
    sessionId: 's', turnId: 't', idempotencyKey: 'retry-key',
  });
  const summaries = lines.map(line => JSON.parse(line)).filter(record => record.stage === 'admission-returned');
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatchObject({ mongoReads: 2, mongoWrites: 1, mongoFailures: 0 });
});
