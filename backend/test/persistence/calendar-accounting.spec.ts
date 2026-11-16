import { Decimal128 } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { unavailableMoney } from '../../src/contracts/usage-evidence.js';
import { encodeAccountingMoney, decodeAccountingMoney } from '../../src/persistence/accounting-codec.js';
import { MongoCalendarAccounting } from '../../src/persistence/calendar-accounting.js';
import { type StoredDocument } from '../../src/persistence/calendar-records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { budget, dispatch, later, turnWindowNow } from './calendar-fixtures.js';

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => doc[key] === value);
}

function scripted(clock = () => Date.parse(turnWindowNow)) {
  const docs = new Map<string, StoredDocument>();
  const db = {
    collection() {
      return {
        async findOne(filter: Record<string, unknown>) {
          return [...docs.values()].find((doc) => matches(doc, filter)) ?? null;
        },
        async updateOne(filter: Record<string, unknown>, update: { $setOnInsert?: StoredDocument }) {
          if (!docs.has(filter._id as string) && update.$setOnInsert) {
            docs.set(filter._id as string, { ...update.$setOnInsert });
          }
          return { acknowledged: true };
        },
        async replaceOne(filter: Record<string, unknown>, doc: StoredDocument) {
          const old = docs.get(filter._id as string);
          if (!old || !matches(old, filter)) return { acknowledged: true, matchedCount: 0 };
          docs.set(doc._id, doc);
          return { acknowledged: true, matchedCount: 1 };
        },
        find(filter: Record<string, unknown>) {
          let rows = [...docs.values()].filter((doc) => matches(doc, filter));
          const cursor = {
            sort(spec: Record<string, number>) {
              const keys = Object.entries(spec);
              rows = [...rows].sort((a, b) => {
                for (const [key, dir] of keys) {
                  if (a[key] === b[key]) continue;
                  return (a[key] > b[key] ? 1 : -1) * dir;
                }
                return 0;
              });
              return cursor;
            },
            limit(count: number) {
              rows = rows.slice(0, count);
              return cursor;
            },
            async toArray() { return rows; },
          };
          return cursor;
        },
      };
    },
  };
  return {
    accounting: new MongoCalendarAccounting(new RecordStore(db as never, 1000), DEFAULT_BUDGETS, undefined, clock),
    docs,
  };
}

it('the shared turn window stays live against the real clock', () => {
  const value = budget();
  expect(Date.parse(value.createdAt)).toBeLessThan(Date.now());
  expect(Date.parse(value.deadlineAt)).toBeGreaterThan(Date.now());
  expect(Date.parse(value.deadlineAt)).toBeGreaterThan(Date.parse(value.createdAt));
});

it('Calendar money round trips as Decimal128', () => {
  const encoded = encodeAccountingMoney({ ...dispatch(), _id: 'd', _revision: 0 });
  expect(encoded.reservationUsd).toBeInstanceOf(Decimal128);
  expect(encoded.pricing.promptUsdPerToken).toBeInstanceOf(Decimal128);
  expect(decodeAccountingMoney(encoded)).toEqual({ ...dispatch(), _id: 'd', _revision: 0 });
});

it('same dispatch reserves once across restart', async () => {
  const f = scripted();
  await f.accounting.createBudget(budget());
  await f.accounting.putDispatch(dispatch());
  await f.accounting.putDispatch(dispatch());
  expect(await f.accounting.getBudget('u1', 's1', 't1')).toMatchObject({
    modelDispatches: 1, repairs: 0, reservedUsd: '0.25', settledUsd: '0', deadlineAt: budget().deadlineAt,
  });
  await f.accounting.putDispatch({ ...dispatch(), status: 'dispatched' });
  await f.accounting.putDispatch({
    ...dispatch(), status: 'terminal', endedAt: later, money: unavailableMoney(false),
  });
  expect((await f.accounting.getBudget('u1', 's1', 't1'))?.reservedUsd).toBe('0.25');
});

it('repair counters and deadline never reset across attempts', async () => {
  const f = scripted();
  await f.accounting.createBudget(budget());
  expect(await f.accounting.createBudget({ ...budget(), modelDispatches: 0 })).toMatchObject({
    deadlineAt: budget().deadlineAt, modelDispatches: 0, repairs: 0,
  });
  const repair = {
    ...dispatch(), dispatchId: 'd2', decisionId: 'dec2', dispatchIndex: 2,
    reason: 'schema-repair' as const, repairedDecisionId: 'dec1',
  };
  await f.accounting.putDispatch(dispatch());
  await f.accounting.putDispatch(repair);
  expect(await f.accounting.getBudget('u1', 's1', 't1')).toMatchObject({
    modelDispatches: 2, repairs: 1, deadlineAt: budget().deadlineAt,
  });
  expect(await f.accounting.createBudget(budget())).toMatchObject({
    modelDispatches: 2, repairs: 1, deadlineAt: budget().deadlineAt,
  });
});

it('unknown dispatched cost keeps its hold', async () => {
  const f = scripted();
  await f.accounting.createBudget(budget());
  await f.accounting.putDispatch(dispatch());
  await f.accounting.putDispatch({ ...dispatch(), status: 'dispatched' });
  await f.accounting.putDispatch({
    ...dispatch(), status: 'terminal', endedAt: later, money: unavailableMoney(false),
  });
  expect(await f.accounting.getBudget('u1', 's1', 't1')).toMatchObject({
    reservedUsd: '0.25', settledUsd: '0', modelDispatches: 1,
  });
});

it('only proven non-dispatch releases a reservation', async () => {
  const f = scripted();
  await f.accounting.createBudget(budget());
  await f.accounting.putDispatch(dispatch());
  await expect(f.accounting.putDispatch({
    ...dispatch(), status: 'not-dispatched', reservationStatus: 'released-not-dispatched',
  })).resolves.toBeUndefined();
  expect((await f.accounting.getBudget('u1', 's1', 't1'))?.reservedUsd).toBe('0');
  await f.accounting.putDispatch({ ...dispatch(), status: 'dispatched' }).catch(() => undefined);
  const held = scripted();
  await held.accounting.createBudget(budget());
  await held.accounting.putDispatch(dispatch());
  await held.accounting.putDispatch({ ...dispatch(), status: 'dispatched' });
  await expect(held.accounting.putDispatch({
    ...dispatch(), status: 'not-dispatched', reservationStatus: 'released-not-dispatched',
  })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect((await held.accounting.getBudget('u1', 's1', 't1'))?.reservedUsd).toBe('0.25');
});

it('preserves private claims and Decimal128 encoding across confirmed budget and dispatch receipts', async () => {
  const f = scripted();
  const b0 = await f.accounting.v2.createBudgetConfirmed!(budget());
  expect(b0.record).toMatchObject({ revision: 1, modelDispatches: 0, reservedUsd: '0' });

  const d0 = {
    ...dispatch(),
    schemaVersion: 2 as const,
    schemaRevision: 'google-calendar.v2' as const,
  };
  const reserved = await f.accounting.v2.reserveDispatchConfirmed!(d0, b0);
  expect(reserved.budget.record).toMatchObject({
    revision: 2,
    modelDispatches: 1,
    reservedUsd: '0.25',
  });

  // Subsequent compareBudgetConfirmed preserves private _calendarClaims
  const bumped = await f.accounting.v2.compareBudgetConfirmed!(reserved.budget, {
    ...reserved.budget.record,
    revision: 3,
    calendarRequests: 1,
  });
  expect(bumped.outcome).toBe('confirmed');
  if (bumped.outcome !== 'confirmed') throw new Error('expected confirmed');
  const rawBudget = [...f.docs.values()].find(doc => doc.kind === 'calendar-turn-budget')!;
  expect(rawBudget._calendarClaims).toHaveLength(1);
  expect(rawBudget.reservedUsd).toBeInstanceOf(Decimal128);
});
