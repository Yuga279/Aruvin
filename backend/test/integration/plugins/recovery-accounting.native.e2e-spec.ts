import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../../src/persistence/persistence.js';
import { budget, connection, dispatch, operation, operationEvent } from '../../persistence/calendar-fixtures.js';
import { nativeDatabase } from '../../persistence/native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

const EXECUTOR = 'p9-executor';

describe.skipIf(!configured)('P9 isolated Calendar recovery and accounting', () => {
  it('reconnects the same event id and does not double-count a dispatch', async () => {
    const isolated = await nativeDatabase();
    try {
      expect(isolated.name.startsWith('aurvin_p2_test_')).toBe(true);
      expect(isolated.name.includes('aurvin') && isolated.name.length > 'aurvin_p2_test_'.length).toBe(true);
      const hello = await isolated.client.db('admin').command({ hello: 1 });
      expect(hello.isWritablePrimary).toBe(true);
      const topology = typeof hello.setName === 'string' ? 'replica-set' : 'standalone';
      expect(['replica-set', 'standalone']).toContain(topology);
      const bundle = await createPersistenceBundle(isolated.client, isolated.name, DEFAULT_BUDGETS, EXECUTOR);
      try {
        expect((await bundle.calendarConnections.create(connection())).outcome).toBe('confirmed');
        const reserved = await bundle.calendarOperations.reserve(operation());
        expect(reserved.outcome).toBe('created');
        await bundle.calendarOperations.appendEvent(operationEvent());
        // A model dispatch can only be reserved inside an open turn budget, so
        // the shared fixture deadline is moved past the current time here.
        await bundle.calendarAccounting.createBudget({
          ...budget(), deadlineAt: new Date(Date.now() + 3_600_000).toISOString(),
        });
        await bundle.calendarAccounting.putDispatch(dispatch());
        await bundle.calendarAccounting.putDispatch(dispatch());
        expect(await bundle.calendarAccounting.getBudget('u1', 's1', 't1')).toMatchObject({
          modelDispatches: 1,
          reservedUsd: '0.25',
        });
      } finally {
        await bundle.owner.releaseExecutor();
      }
      const nextClient = await isolated.reconnect();
      try {
        const reopened = await createPersistenceBundle(nextClient, isolated.name, DEFAULT_BUDGETS, EXECUTOR);
        try {
          const again = await reopened.calendarOperations.reserve({ ...operation(), originatingAttemptId: 'a2' });
          expect(again.outcome).toBe('existing');
          const saved = await reopened.calendarOperations.getByTurn('u1', 's1', 't1');
          expect(saved?.googleEventId).toBe(operation().googleEventId);
          expect(await reopened.calendarAccounting.getBudget('u1', 's1', 't1')).toMatchObject({
            modelDispatches: 1,
            reservedUsd: '0.25',
          });
          const rows = await isolated.db.collection('metadata').find({ kind: 'calendar-model-dispatch' }).toArray();
          expect(rows).toHaveLength(1);
          expect(JSON.stringify(rows)).not.toMatch(/mongodb:\/\//i);
        } finally {
          await reopened.owner.releaseExecutor();
        }
      } finally {
        await nextClient.close();
      }
    } finally {
      await isolated.close();
    }
  }, 60_000);
});
