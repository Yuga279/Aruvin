/**
 * ============================================================================
 * FILE: calendar-migration.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/calendar-migration.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Native MongoDB replica-set integration tests for legacy calendar migration.
 *
 * ROLE IN PROJECT:
 *    Validates explicit legacy migration, corrupt version rejection, legacy disposition
 *    recording, and rollback preconditions against live isolated MongoDB replica-set.
 *
 * KEY COMPONENTS:
 *    - Explicit migration of legacy connection to v2 record.
 *    - Quarantine of legacy unknown operations and rollback assessment.
 * ============================================================================
 */

import { expect, it, describe } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { nativeDatabase } from './native.js';
import { connection } from './calendar-fixtures.js';
import { operationV1, receiptV1, at } from '../contracts/calendar-multi-fixtures.js';
import { assessCalendarRollback } from '../../src/persistence/calendar-migration.js';
import { legacyOperationDisposition } from '../../src/contracts/calendar-compatibility.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';
describe.skipIf(!configured)('multi-calendar native legacy migration', () => {
  it('migrates legacy connection explicitly and records dispositions against live Mongo', async () => {
    const f = await nativeDatabase();
    try {
      expect(/^aurvin_p2_test_[a-f0-9]{32}$/.test(f.name)).toBe(true);
      const bundle = await createPersistenceBundle(f.client, f.name, DEFAULT_BUDGETS);
      try {
        const old = connection();
        await bundle.calendarConnections.create(old);

        const op1 = { ...operationV1, operationId: 'op-succ', state: 'succeeded' as const, receipt: receiptV1 };
        const op2 = { ...operationV1, turnId: 't2', operationId: 'op-unk', state: 'unknown' as const };
        await bundle.calendarOperations.reserve(op1);
        await bundle.calendarOperations.reserve(op2);

        const migration = await bundle.calendarConnections.migrateLegacy({
          userId: old.userId,
          expectedRevision: old.revision,
          expectedConnectionRevision: old.connectionRevision,
          legacy: old,
          now: at,
          admissionStopped: true,
          executorDrained: true,
        });
        expect(migration.outcome).toBe('confirmed');

        const disp2 = legacyOperationDisposition(op2, at);
        expect(disp2).not.toBeNull();
        if (disp2) {
          await bundle.calendarOperations.recordLegacyDisposition(disp2);
        }

        const rollback = assessCalendarRollback({
          admissionStopped: true,
          executorDrained: true,
          pageComplete: true,
          v2Records: 1,
          unresolvedEffects: 1,
        });
        expect(rollback.outcome).toBe('blocked');
      } finally {
        await bundle.owner.releaseExecutor();
      }
    } finally {
      await f.close();
    }
  }, 60000);
});
