/**
 * ============================================================================
 * FILE: calendar-critical-path.spec.ts
 * LOCATION: backend/test/performance/calendar-critical-path.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Prove Calendar reuses durable receipts and bounded storage ownership phases.
 * ROLE IN PROJECT:
 *    Exercises real runtime, stock saver and repositories on the offline BSON fake.
 * KEY COMPONENTS:
 *    - Receipt linkage: Completion supersedes the acknowledged assistant append.
 *    - Storage phases: Reservation/publication avoid repeated guard round trips.
 * ============================================================================
 */
import { setImmediate as flushImmediate } from 'node:timers/promises';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoOwnership } from '../../src/persistence/ownership.js';
import { MongoCalendarAccounting } from '../../src/persistence/calendar-accounting.js';
import { DependencyProbe } from './dependency-probe.js';
import { createLatencyFixture } from './latency-runtime-fixture.js';
import { createWire, textWire } from '../runtime/calendar-runtime.fixture.js';
import { event } from '../runtime/calendar-multi-fixture.js';
import { callWire, loadWire } from '../assembly/skill-fixture.js';

it.each([0, 8])('measures Confirm with an explicit proposal reference after %s earlier turns', async earlierTurns => {
  const measurements = [];
  for (const referenced of [false, true]) {
    const probe = new DependencyProbe();
    const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
    try {
      let sessionId: string | null = null;
      for (let turn = 0; turn < earlierTurns; turn++) {
        fx.calendar!.modelWires.push(textWire('Noted.'));
        const ids = await fx.run(() => fx.submit(`Note ${turn}`, sessionId));
        sessionId = ids.sessionId;
        await fx.run(() => fx.execute(ids));
      }
      fx.calendar!.modelWires.push(loadWire(['calendar_create_event'], 'confirm-load'),
        createWire(event()));
      const first = await fx.run(() => fx.submit('create the event', sessionId));
      await fx.run(() => fx.execute(first));
      const proposal = await fx.run(() => fx.calendar!.currentProposal(first.sessionId));
      expect(proposal).not.toBeNull();
      const references = vi.spyOn(fx.persistence.calendarProposals, 'getReplyReference');
      let firstReceiptMs: number | null = null;
      const push = fx.frames.push.bind(fx.frames);
      const frames = vi.spyOn(fx.frames, 'push').mockImplementation((...items) => {
        for (const item of items) {
          const frame = item as { event?: { type: string; operation?: { state: string } } };
          if (firstReceiptMs === null && frame.event?.type === 'calendar-operation'
            && frame.event.operation?.state === 'succeeded') firstReceiptMs = probe.elapsedMs;
        }
        return push(...items);
      });
      const result = await fx.measure(async () => {
        const ids = await fx.submit('yes', first.sessionId, referenced ? {
          calendarReplyTo: { proposalId: proposal!.proposalId, revision: proposal!.revision },
        } : undefined);
        await fx.execute(ids);
        return ids;
      });
      if (referenced) expect(references.mock.calls.every(call => call[2] === result.result.attemptId)).toBe(true);
      references.mockRestore();
      frames.mockRestore();
      expect(fx.googleEffects.filter(effect => effect.kind === 'create')).toHaveLength(1);
      expect(fx.modelCalls).toHaveLength(earlierTurns + 2);
      measurements.push({ referenced, reads: result.metrics.wireReads, writes: result.metrics.wireWrites,
        waves: result.metrics.waves, modelledMs: result.metrics.elapsedMs, firstReceiptMs });
    } finally { await fx.close(); }
  }
  console.log('CONFIRM_REFERENCE_MEASUREMENT', JSON.stringify({ earlierTurns, measurements }));
  expect(measurements[1].reads).toBeLessThan(measurements[0].reads);
  expect(measurements[1].writes).toBe(measurements[0].writes);
  expect(measurements[1].modelledMs).toBeLessThan(measurements[0].modelledMs);
});

it('completes live Calendar narration from its acknowledged append receipt', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  const append = vi.spyOn(MongoMessages.prototype, 'appendConfirmed');
  const completion = vi.spyOn(MongoMessages.prototype, 'updateCompletionConfirmed');
  try {
    fx.calendar!.modelWires.push(textWire('Hello.'));
    const ids = await probe.drive(() => fx.submit('Hello Aurvin'), 67, 449);
    await probe.drive(() => fx.execute(ids), 67, 449);
    const index = append.mock.calls.findIndex(([record]) => record.role === 'assistant');
    expect(index).toBeGreaterThanOrEqual(0);
    const receipt = await append.mock.results[index].value;
    expect(completion.mock.calls.at(-1)?.[0]).toBe(receipt);
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally {
    append.mockRestore(); completion.mockRestore();
    await fx.close();
  }
});

it('uses bounded storage phases for Calendar reservation and publication, not transport', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  const phase = vi.spyOn(MongoOwnership.prototype, 'runPhase');
  try {
    fx.calendar!.modelWires.push(textWire('Hello.'));
    const ids = await probe.drive(() => fx.submit('Hello Aurvin'), 67, 449);
    phase.mockClear();
    await probe.drive(() => fx.execute(ids), 67, 449);
    expect(phase.mock.calls.map(([, options]) => [options.name, options.maxOperations])).toEqual([
      ['model-observation', 4], ['publication-stage', 4], ['publication-commit', 2],
    ]);
    for (const [lease, options] of phase.mock.calls) {
      expect(options.deadlineAt).toBeLessThanOrEqual(Date.parse(lease.leaseExpiresAt) - 1000);
    }
    expect(fx.modelCalls).toHaveLength(1);
  } finally {
    phase.mockRestore();
    await fx.close();
  }
});

it('does not complete or publish a terminal frame before the assistant append acknowledges', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  const append = MongoMessages.prototype.appendConfirmed.bind(fx.persistence.messages);
  const spy = vi.spyOn(MongoMessages.prototype, 'appendConfirmed');
  let release!: () => void;
  const acknowledgment = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  spy.mockImplementation(async function (record) {
    const receipt = await append(record);
    if (record.role === 'assistant') { held = true; await acknowledgment; }
    return receipt;
  });
  const completion = vi.spyOn(MongoMessages.prototype, 'updateCompletionConfirmed');
  try {
    fx.calendar!.modelWires.push(textWire('Hello.'));
    const ids = await probe.drive(() => fx.submit('Hello Aurvin'), 67, 449);
    const execution = fx.execute(ids);
    for (let step = 0; step < 500 && !held; step++) {
      await flushImmediate();
      if (probe.waiting) probe.advance(67, 449);
    }
    expect(held).toBe(true);
    expect(completion).not.toHaveBeenCalled();
    expect(fx.frames.some(frame => (frame as { event: { type: string } }).event.type === 'completed')).toBe(false);
    release();
    await probe.drive(() => execution, 67, 449);
    expect(completion).toHaveBeenCalledOnce();
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally {
    release(); spy.mockRestore(); completion.mockRestore();
    await fx.close();
  }
});

it.each([false, true])('recovers an assistant append failure (after commit: %s) without inference replay', async afterCommit => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  const append = MongoMessages.prototype.appendConfirmed.bind(fx.persistence.messages);
  const spy = vi.spyOn(MongoMessages.prototype, 'appendConfirmed');
  try {
    fx.calendar!.modelWires.push(textWire('Saved answer.'));
    const ids = await probe.drive(() => fx.submit('Hello Aurvin'), 67, 449);
    spy.mockImplementationOnce(async function (record) {
      if (afterCommit) await append(record);
      throw new Error('Injected missing append acknowledgment');
    });
    await expect(probe.drive(() => fx.execute(ids), 67, 449)).rejects.toBeDefined();
    expect(fx.frames.some(frame => (frame as { event: { type: string } }).event.type === 'completed')).toBe(false);
    spy.mockRestore();
    const beforeRecovery = await probe.drive(() => fx.persistence.messages.list(
      fx.identity.userId, ids.sessionId, { cursor: null, limit: 20 }), 67, 449);
    expect(beforeRecovery.items.filter(message => message.role === 'assistant')).toHaveLength(afterCommit ? 1 : 0);
    await probe.drive(() => fx.rawRuntime.reconcileSession(fx.identity.userId, ids.sessionId), 67, 449);
    const attempt = await probe.drive(() => fx.persistence.metadata.getAttempt(
      fx.identity.userId, ids.sessionId, ids.attemptId), 67, 449);
    expect(attempt?.status).toBe('completed');
    const history = await probe.drive(() => fx.persistence.messages.list(
      fx.identity.userId, ids.sessionId, { cursor: null, limit: 20 }), 67, 449);
    expect(history.items.filter(message => message.role === 'assistant')).toHaveLength(1);
    expect(fx.modelCalls).toHaveLength(1);
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally {
    spy.mockRestore();
    await fx.close();
  }
});

it('forwards acknowledged budget evidence through a real Calendar tool debit and the next request counter', async () => {
  const probe = new DependencyProbe();
  const fx = await createLatencyFixture({ path: 'calendar', probe, readMs: 67, writeMs: 449 });
  const debit = vi.spyOn(MongoCalendarAccounting.prototype, 'debit');
  const update = vi.spyOn(MongoCalendarAccounting.prototype, 'updateDispatchConfirmed');
  const counter = vi.spyOn(MongoCalendarAccounting.prototype, 'compareBudgetConfirmed');
  try {
    const read = callWire('calendar_get_event', {
      calendarId: 'personal@example.test', eventId: 'evt_100' }, 'call_read');
    fx.calendar!.modelWires.push(loadWire(['calendar_get_event'], 'debit-load'), read,
      textWire('The event is scheduled.'));
    const ids = await probe.drive(() => fx.submit('Show event evt_100 on my Personal calendar.'), 67, 449);
    await probe.drive(() => fx.execute(ids), 67, 449);
    expect(debit).toHaveBeenCalledOnce();
    const expected = debit.mock.calls[0][0].expectedBudget;
    expect(expected).toBeDefined();
    const updates = await Promise.all(update.mock.results.map(result => result.value));
    expect(updates.some(result => result.budget === expected)).toBe(true);
    // These deterministic wires report no money; they must keep their hold.
    // Money-settlement scans therefore are not on this measured tool path.
    expect(updates.every(result => result.dispatch.record.reservationStatus === 'held')).toBe(true);
    const result = await debit.mock.results[0].value;
    if (result.outcome === 'conflict') throw new Error('Expected confirmed tool debit');
    expect(result.budgetReceipt).toBeDefined();
    expect(counter.mock.calls.some(([receipt]) => receipt === result.budgetReceipt)).toBe(true);
    expect(fx.googleEffects.filter(effect => effect.kind === 'get')).toHaveLength(1);
    expect(fx.rawRuntime.snapshot().active).toBe(0);
  } finally {
    debit.mockRestore(); update.mockRestore(); counter.mockRestore();
    await fx.close();
  }
});
