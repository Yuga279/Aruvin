import { expect, it } from 'vitest';
import { calendarFixture, createWire, loadWire, nativeWire, textWire } from '../../runtime/calendar-runtime.fixture.js';
import { APPROVED_CREATE, VISIT, malformedCreateWire } from './wires.js';

type Fixture = ReturnType<typeof calendarFixture>;

async function turnBudget(h: Fixture, ids: { sessionId: string; turnId: string }) {
  return h.p.calendarAccounting.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
}

it.each([
  ['decision-save', 2, 0],
  ['receipt-save', 2, 1],
] as const)('in-memory crash at %s does not repeat inference or allocate a second create',
  async (point, models, creates) => {
    const h = calendarFixture();
    try {
      const ids = await h.submit(APPROVED_CREATE);
      h.modelWires.push(loadWire('calendar_create_event'), createWire(VISIT, 'create-one'), textWire('Created.'));
      h.failOnce(point, false, point === 'decision-save' ? 1 : 0);
      await expect(h.execute(ids)).rejects.toBeDefined();
      await h.restart();
      expect(h.modelBodies).toHaveLength(models);
      expect(h.effects.filter((effect) => effect.kind === 'create')).toHaveLength(creates);
      expect(h.modelWires).toHaveLength(1);
      const budget = await turnBudget(h, ids);
      expect(budget?.repairs ?? 0).toBe(0);
      expect(budget?.creates ?? 0).toBeLessThanOrEqual(creates);
    } finally {
      await h.dispose();
    }
  });

it('in-memory crash at result-save does not repeat inference or repeat a read', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Read event abcde');
    h.modelWires.push(loadWire('calendar_get_event'), nativeWire('{"eventId":"abcde"}'), textWire('Found it.'));
    h.failOnce('result-save-v2');
    await expect(h.execute(ids)).rejects.toBeDefined();
    await h.restart();
    expect(h.modelBodies).toHaveLength(2);
    expect(h.effects.filter((effect) => effect.kind === 'get')).toHaveLength(1);
    expect(h.modelWires).toHaveLength(1);
  } finally {
    await h.dispose();
  }
});

it('readback keeps the original event id after a local receipt failure', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(VISIT, 'create-one'));
    h.failOnce('receipt-save');
    await expect(h.execute(ids)).rejects.toBeDefined();
    // The v2 operation record carries the event id before its receipt is saved.
    const saved = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(['dispatching', 'unknown']).toContain(saved?.state);
    expect(saved?.googleEventId).toBeTruthy();
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    const next = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(next).toMatchObject({ state: 'succeeded', googleEventId: saved!.googleEventId });
    expect(h.effects.filter((effect) => effect.kind === 'create')).toHaveLength(1);
    expect(h.effects.filter((effect) => effect.kind === 'readback').map((effect) => effect.eventId))
      .toEqual([saved!.googleEventId]);
    expect(h.modelBodies).toHaveLength(2);
  } finally {
    await h.dispose();
  }
});

it('reuses the same accepted turn for the same idempotency key', async () => {
  const h = calendarFixture();
  try {
    const first = await h.runtime.submitTurn({
      identity: h.identity,
      sessionId: null,
      content: APPROVED_CREATE,
      idempotencyKey: 'p9-same-key',
    });
    const second = await h.runtime.submitTurn({
      identity: h.identity,
      sessionId: first.sessionId,
      content: APPROVED_CREATE,
      idempotencyKey: 'p9-same-key',
    });
    expect(second.turnId).toBe(first.turnId);
    expect(second.sessionId).toBe(first.sessionId);
  } finally {
    await h.dispose();
  }
});

it('keeps the persisted dispatch, repair, tool and request counters after a restart', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(malformedCreateWire(), loadWire('calendar_create_event'),
      createWire(VISIT, 'create-one'), textWire('Created.'));
    await h.execute(ids);
    const before = await turnBudget(h, ids);
    // A create is charged once against `logicalTools`: the model-requested call
    // in the loop. The mutating operation has its own `creates` row.
    // The measured value is recorded so a P6 accounting change stays visible.
    expect(before).toMatchObject({ modelDispatches: 3, repairs: 1, logicalTools: 1, creates: 1 });
    // The v2 create charges two provider requests: the server-owned
    // availability preflight and the Google write itself.
    expect(before?.calendarRequests).toBe(2);
    expect(h.requestKinds).toEqual(['preflight', 'create']);
    await h.restart();
    const after = await turnBudget(h, ids);
    expect(after).toMatchObject({ modelDispatches: 3, repairs: 1, logicalTools: 1, creates: 1 });
    expect(after?.calendarRequests).toBe(2);
  } finally {
    await h.dispose();
  }
});

it('does not replenish the repair counter after a restart', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(APPROVED_CREATE);
    h.modelWires.push(malformedCreateWire(), malformedCreateWire(), malformedCreateWire());
    await h.execute(ids);
    const before = await turnBudget(h, ids);
    expect(before).toMatchObject({ modelDispatches: 3, repairs: 2, creates: 0 });
    await h.restart();
    const after = await turnBudget(h, ids);
    expect(after).toMatchObject({ modelDispatches: 3, repairs: 2, creates: 0 });
    expect(h.effects).toEqual([]);
  } finally {
    await h.dispose();
  }
});
