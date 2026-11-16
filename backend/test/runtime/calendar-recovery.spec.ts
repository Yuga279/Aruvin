/**
 * ============================================================================
 * FILE: calendar-recovery.spec.ts
 * LOCATION: backend/test/runtime/calendar-recovery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove that a crash in the durable write windows never replays the model or
 *    the provider, and that the original event is read back afterwards.
 *
 * ROLE IN PROJECT:
 *    These are the crash-window tests of the multi-calendar create path. The
 *    acceptance, the operation reservation, the provider write and the receipt
 *    are separate durable steps; a failure between them must leave the turn
 *    interrupted with exactly one provider effect.
 *
 * KEY COMPONENTS:
 *    - crash windows: decision, result and receipt saves.
 *    - readback: The original event is read back after a local receipt failure.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarInputSchemas } from '../../src/contracts/calendar-tools.js';
import { calendarFixture, createWire, loadWire, processDiagnosticCapture } from './calendar-runtime.fixture.js';
import { isCalendarV2 } from '../../src/chat-runtime/calendar-ports.js';

const action = calendarInputSchemas.calendar_create_event.parse({
  summary: 'Planning', start: '2026-10-22T10:00:00+00:00',
  end: '2026-10-22T11:00:00+00:00', timeZone: 'Etc/UTC',
});
const request = 'Schedule Planning on 2026-10-22 from 10:00 to 11:00 Etc/UTC.';

it.each([
  ['decision-save', 2, 0],
  ['result-save-v2', 2, 1],
  ['receipt-save', 2, 1],
] as const)('crash at %s does not replay model or create', async (point, models, creates) => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(request);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(action, 'create-one'));
    h.failOnce(point, false, point === 'decision-save' ? 1 : 0);
    await expect(h.execute(ids)).rejects.toBeDefined();
    await h.restart();
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.filter(item => item.role === 'user')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(models);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(creates);
    const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget?.deadlineAt).toBeDefined();
  } finally { await h.dispose(); }
});

it('readbacks the original event after Google success and local receipt failure', async () => {
  const trace = processDiagnosticCapture();
  const h = calendarFixture(trace.diagnostics);
  try {
    const ids = await h.submit(request);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(action, 'create-one'));
    h.failOnce('receipt-save');
    await expect(h.execute(ids)).rejects.toBeDefined();
    const old = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(['dispatching', 'unknown']).toContain(old?.state);
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    const next = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(next).toMatchObject({ state: 'succeeded', googleEventId: old!.googleEventId });
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    expect(h.effects.filter(e => e.kind === 'readback').map(e => e.eventId))
      .toEqual([old!.googleEventId]);
    expect(h.modelBodies).toHaveLength(2);
    const attempt = trace.records().filter(record => record.attemptId === trace.hash(ids.attemptId));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'task-outcome',
      task: 'unknown', writeCertainty: 'unknown' }));
    expect(attempt).toContainEqual(expect.objectContaining({ stage: 'terminal', chat: 'failed' }));
  } finally { await h.dispose(); }
});

it('does not send recovery HTTP when the capability request debit cannot be confirmed', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(request);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(action, 'create-one'));
    h.failOnce('receipt-save');
    await expect(h.execute(ids)).rejects.toBeDefined();
    await h.restart();
    const cal = h.runtime.d.calendar;
    if (!cal || !isCalendarV2(cal)) throw new Error('expected v2 Calendar');
    const resolve = cal.capabilities.resolve.bind(cal.capabilities);
    cal.capabilities.resolve = async input => {
      await input.consumeRequest('capability-recheck');
      return resolve(input);
    };
    h.p.calendarAccountingV2.compareAndSwapBudget = async () => 'conflict';
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    expect(h.effects.filter(e => e.kind === 'readback')).toHaveLength(0);
    expect(await h.operationFor(ids)).toMatchObject({ state: 'unknown' });
  } finally { await h.dispose(); }
});
