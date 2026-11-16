/**
 * ============================================================================
 * FILE: shared-admission-critical-path.spec.ts
 * LOCATION: backend/test/performance/shared-admission-critical-path.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify bounded admission staging and acknowledged acquisition evidence.
 * ROLE IN PROJECT:
 *    Runs generic ownership/admission against injected BSON storage, never a DB.
 * KEY COMPONENTS:
 *    - Stage scope: Reservation and archive writes share one finite phase.
 *    - Acquisition evidence: Actual CAS results retain conflict/recovery behavior.
 * ============================================================================
 */
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { key } from '../../src/persistence/records.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { session } from '../persistence/fixtures.js';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';
import { textConfigFixture } from '../runtime/text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';

it('starts the independent stock-saver boundary read while archive selection is still pending', async () => {
  const h = textConfigFixture(textSnapshot(1));
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const archive = h.p.messages.listForContext.bind(h.p.messages);
  h.p.messages.listForContext = async (...args) => {
    entered();
    await gate;
    return archive(...args);
  };
  const saver = vi.spyOn(h.saver, 'getTuple');
  const submission = h.submit('Overlapping independent reads');
  try {
    await waiting;
    await vi.waitFor(() => expect(saver).toHaveBeenCalled(), { timeout: 200 });
  } finally {
    release();
    await submission;
    saver.mockRestore();
    await h.dispose();
  }
});

it('initializes the empty manifest and graph boundary in one bounded storage-only phase', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 0, writeMs: 0 });
  const phase = vi.spyOn(fx.persistence.owner, 'runPhase');
  const manifestScopes: boolean[] = [], checkpointScopes: boolean[] = [];
  const put = fx.persistence.memory.put.bind(fx.persistence.memory);
  vi.spyOn(fx.persistence.memory, 'put').mockImplementation(async (...args) => {
    manifestScopes.push(fx.persistence.owner.currentPhaseSession() !== null);
    return put(...args);
  });
  const create = fx.persistence.checkpoints.create.bind(fx.persistence.checkpoints);
  vi.spyOn(fx.persistence.checkpoints, 'create').mockImplementation(async () => {
    const setup = await create();
    const bind = setup.bind.bind(setup);
    setup.bind = lease => {
      const saver = bind(lease), save = saver.put.bind(saver);
      saver.put = async (...args) => {
        checkpointScopes.push(fx.persistence.owner.currentPhaseSession() !== null);
        return save(...args);
      };
      return saver;
    };
    return setup;
  });
  try {
    await probe.drive(() => fx.submit('First turn bootstrap'), 0, 0);
    expect(manifestScopes).toEqual([true]);
    expect(checkpointScopes.length).toBeGreaterThan(0);
    expect(checkpointScopes.every(Boolean)).toBe(true);
    const phases = phase.mock.calls.filter(call => call[1].name === 'boundary-bootstrap');
    expect(phases).toHaveLength(1);
    expect(phases[0][1].maxOperations).toBe(4);
    expect(fx.fetcher).not.toHaveBeenCalled();
  } finally { await fx.close(); }
});

it('shares a bounded ownership phase across the generation identity and accounting barrier, never model dispatch', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 0, writeMs: 0 });
  const phase = vi.spyOn(fx.persistence.owner, 'runPhase');
  const fetch = fx.fetcher.getMockImplementation()!;
  const dispatchScopes: boolean[] = [];
  fx.fetcher.mockImplementation(async (...args) => {
    dispatchScopes.push(fx.persistence.owner.currentPhaseSession() !== null);
    return fetch(...args);
  });
  try {
    const ids = await probe.drive(() => fx.submit('Identity barrier'), 0, 0);
    await probe.drive(() => fx.execute(ids), 0, 0);
    expect(dispatchScopes).toEqual([false]);
    const phases = phase.mock.calls.filter(call => call[1].name === 'model-observation');
    expect(phases).toHaveLength(1);
    expect(phases[0][1].maxOperations).toBe(2);
    expect(fx.frames.some(frame => frame.event.type === 'delta')).toBe(true);
  } finally { await fx.close(); }
});

it('reuses fresh accepted voice evidence for the pre-execution status check and reloads after cancellation', async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 0, writeMs: 0 });
  try {
    const reservation = await probe.drive(() => fx.rawRuntime.reservations.acquire({
      identity: fx.identity, conversationId: 'voice-status-fixture',
      owner: { kind: 'live', voiceSessionId: 'voice-status' },
    }), 0, 0);
    const ids = await probe.drive(() => fx.rawRuntime.submitLiveTurn({
      identity: fx.identity, sessionId: 'voice-status-fixture', content: 'Hello Aurvin',
      idempotencyKey: 'voice-status-key', reservation, configSnapshot: textSnapshot(1),
    }), 0, 0);
    fx.resetMetrics();
    const status = await probe.drive(() => fx.rawRuntime.getLiveTurnStatus(
      fx.identity.userId, ids.sessionId, ids.turnId, reservation), 0, 0);
    expect(status.status).toBe('accepted');
    expect(fx.memory.calls.filter(call => call.method === 'find' || call.method === 'findOne')).toHaveLength(0);
    await expect(fx.rawRuntime.getLiveTurnStatus(fx.identity.userId, ids.sessionId, ids.turnId,
      { ...reservation, reservationId: 'another-owner' })).rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    clock.mockReturnValue(now + 61_000);
    fx.resetMetrics();
    expect((await probe.drive(() => fx.rawRuntime.getLiveTurnStatus(
      fx.identity.userId, ids.sessionId, ids.turnId, reservation), 0, 0)).status).toBe('accepted');
    expect(fx.memory.calls.some(call => call.method === 'find' || call.method === 'findOne')).toBe(true);
    await probe.drive(() => fx.rawRuntime.cancelLiveTurn({ identity: fx.identity, ...ids }, reservation), 0, 0);
    fx.resetMetrics();
    expect((await probe.drive(() => fx.rawRuntime.getLiveTurnStatus(
      fx.identity.userId, ids.sessionId, ids.turnId, reservation), 0, 0)).status).toBe('cancelled');
    expect(fx.memory.calls.some(call => call.method === 'find' || call.method === 'findOne')).toBe(true);
  } finally { try { await fx.close(); } finally { clock.mockRestore(); } }
});

it('reduces first-turn storage dependency waves without deleting any durable writes', async () => {
  const measure = async (grouped: boolean) => {
    const probe = new DependencyProbe();
    const fx = await createLatencyFixture({ path: 'text', probe, readMs: 67, writeMs: 449 });
    const phase = fx.persistence.owner.runPhase.bind(fx.persistence.owner);
    if (!grouped) vi.spyOn(fx.persistence.owner, 'runPhase').mockImplementation((lease, options, action) =>
      options.name === 'boundary-bootstrap' || options.name === 'model-observation'
        ? action() : phase(lease, options, action));
    try {
      return (await fx.measure(async () => {
        const ids = await fx.submit('Measure shared first-turn work');
        await fx.execute(ids);
      })).metrics;
    } finally { await fx.close(); }
  };
  const before = await measure(false), after = await measure(true);
  expect(after.wireWrites).toBe(before.wireWrites);
  expect(after.wireReads).toBeLessThan(before.wireReads);
  expect(after.storageWaves.preDispatch!).toBeLessThan(before.storageWaves.preDispatch!);
  expect(after.storageWaves.firstAnswer!).toBeLessThan(before.storageWaves.firstAnswer!);
  console.info('Synthetic first-turn ownership comparison (not live latency)', JSON.stringify({
    before: { reads: before.wireReads, writes: before.wireWrites, waves: before.storageWaves },
    after: { reads: after.wireReads, writes: after.wireWrites, waves: after.storageWaves },
  }));
});

it('keeps reservation and sequence allocation inside the same bounded acceptance stage as archive writes', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 67, writeMs: 449 });
  const owner = fx.persistence.owner;
  const reserve = owner.reserveAttempt.bind(owner);
  const allocate = owner.allocateSequences.bind(owner);
  const scopes: boolean[] = [];
  const phase = vi.spyOn(owner, 'runPhase');
  const reserveSpy = vi.spyOn(owner, 'reserveAttempt').mockImplementation(async (...args) => {
    scopes.push(owner.currentPhaseSession() !== null);
    return reserve(...args);
  });
  const allocateSpy = vi.spyOn(owner, 'allocateSequences').mockImplementation(async (...args) => {
    scopes.push(owner.currentPhaseSession() !== null);
    return allocate(...args);
  });
  try {
    await probe.drive(() => fx.submit('Bounded admission'), 67, 449);
    expect(scopes).toEqual([true, true]);
    const stages = phase.mock.calls.filter(call => call[1].name === 'acceptance-stage');
    expect(stages).toHaveLength(1);
    expect(stages[0][1].maxOperations).toBe(8);
    expect(stages[0][1].deadlineAt).toBeLessThanOrEqual(Date.parse(stages[0][0].leaseExpiresAt) - 1000);
  } finally {
    reserveSpy.mockRestore(); allocateSpy.mockRestore(); phase.mockRestore();
    await fx.close();
  }
});

it.each(['before-write', 'after-write'] as const)('keeps acceptance honest when the staged input has %s uncertainty', async fault => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'text', probe, readMs: 67, writeMs: 449 });
  try {
    fx.memory.failNext(fault, { collection: 'messages', method: 'updateOne' });
    const submit = () => fx.submit('Uncertain input', null, { idempotencyKey: 'uncertain-admission' });
    if (fault === 'before-write') {
      await expect(probe.drive(submit, 67, 449)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
      expect([...fx.memory.rows('metadata').values()].filter(row => row.kind === 'acceptance')).toHaveLength(0);
      expect(fx.fetcher).not.toHaveBeenCalled();
    } else {
      const ids = await probe.drive(submit, 67, 449);
      expect(await probe.drive(submit, 67, 449)).toEqual(ids);
      await probe.drive(() => fx.execute(ids), 67, 449);
      expect([...fx.memory.rows('messages').values()].filter(row => row.role === 'user')).toHaveLength(1);
      expect(fx.fetcher).toHaveBeenCalledTimes(1);
    }
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally {
    await fx.close();
  }
});

async function acquisition() {
  const mem = calendarMemory();
  const owner = new MongoOwnership(mem.store, 'admission-owner');
  await owner.claimExecutor();
  await new MongoSessions(mem.store, DEFAULT_BUDGETS).createIfAbsent(session('u1', 's1'));
  const input = { userId: 'u1', sessionId: 's1', ownerId: owner.executorId, leaseMs: 30000 };
  return { mem, owner, input };
}

it('carries the actual acquired session without a second session read and refuses stale generations/concurrent claims', async () => {
  const { mem, owner, input } = await acquisition();
  const results = await Promise.all([owner.acquire(input), owner.acquire(input)]);
  const won = results.find(result => result.ok);
  expect(won).toHaveProperty('session.execution.ownerId', owner.executorId);
  expect(results.filter(result => result.ok)).toHaveLength(1);
  if (!won?.ok) throw new Error('expected acquisition');
  expect(won).toHaveProperty('session.execution.generation', won.lease.generation);
  await owner.release(won.lease);
  expect(await owner.acquire({ ...input, expectedGeneration: 0 })).toEqual({ ok: false, code: 'CONFLICT_ACTIVE_TURN' });
  expect(mem.rows('sessions').get(key('session', 'u1', 's1'))?.execution).toHaveProperty('ownerId', null);
});

it.each(['before-write', 'after-write'] as const)('retains acquisition readback on %s ambiguity', async fault => {
  const { mem, owner, input } = await acquisition();
  mem.failNext(fault, { collection: 'sessions', method: 'findOneAndUpdate' });
  if (fault === 'before-write') {
    await expect(owner.acquire(input)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    const retry = await owner.acquire(input);
    expect(retry).toHaveProperty('session.execution.ownerId', owner.executorId);
  } else {
    const acquired = await owner.acquire(input);
    expect(acquired).toHaveProperty('session.execution.ownerId', owner.executorId);
    if (!acquired.ok) throw new Error('expected confirmed readback');
    expect(acquired).toHaveProperty('session.execution.generation', acquired.lease.generation);
  }
});
