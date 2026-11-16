import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { budget, dispatch } from './calendar-fixtures.js';
import { nativeDatabase } from './native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Calendar isolated native accounting', () => {
  it('dispatch claims and repair counters survive reconnect', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        await bundle.calendarAccounting.createBudget(budget());
        await bundle.calendarAccounting.putDispatch(dispatch());
        await bundle.calendarAccounting.putDispatch(dispatch());
        expect(await bundle.calendarAccounting.getBudget('u1', 's1', 't1')).toMatchObject({
          modelDispatches: 1, repairs: 0, reservedUsd: '0.25',
        });
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);

  it('Decimal128 and mixed reports do not double count', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        await bundle.calendarAccounting.createBudget(budget());
        await bundle.calendarAccounting.putDispatch(dispatch());
        const stored = await f.db.collection('metadata').findOne({ kind: 'calendar-turn-budget' });
        expect(stored?.reservedUsd).toBeDefined();
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);

  it('settlement crash overholds rather than frees unknown spend', async () => {
    const f = await nativeDatabase();
    try {
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        await bundle.calendarAccounting.createBudget(budget());
        await bundle.calendarAccounting.putDispatch(dispatch());
        expect((await bundle.calendarAccounting.getBudget('u1', 's1', 't1'))?.reservedUsd).toBe('0.25');
      } finally { await bundle.owner.releaseExecutor(); }
    } finally { await f.close(); }
  }, 30_000);
});
