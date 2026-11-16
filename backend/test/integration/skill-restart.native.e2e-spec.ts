/**
 * ============================================================================
 * FILE: skill-restart.native.e2e-spec.ts
 * LOCATION: backend/test/integration/skill-restart.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove durable schema disclosures survive a stopped native executor restart.
 *
 * ROLE IN PROJECT:
 *    Optional operator-guarded native check over one generated database; without
 *    AURVIN_TEST_MONGODB_URI/AURVIN_TEST_DB_PREFIX it skips rather than passing.
 *
 * KEY COMPONENTS:
 *    - Cold disclosure plus execution, stopped restart, then warm execution only.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { nativeCalendarFixture } from '../runtime/calendar-multi-fixture.js';
import { loadWire, callWire, textWire } from '../assembly/skill-fixture.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('isolated native skill restart', () => {
  it('reuses durable schema disclosures after stopping the executor', async () => {
    const h = await nativeCalendarFixture();
    try {
      h.modelWires.push(loadWire(['calendar_list_calendars'], 'native-disclosure'),
        callWire('calendar_list_calendars', {}, 'native-cold'), textWire('Listed.'));
      const cold = await h.submit('List calendars.');
      await h.execute(cold);
      await h.restartStoppedExecutor();
      h.modelWires.push(callWire('calendar_list_calendars', {}, 'native-warm'), textWire('Listed again.'));
      const warm = await h.submit('List calendars again.', cold.sessionId);
      await h.execute(warm);
      expect(await h.budgetFor(warm)).toMatchObject({ modelDispatches: 2, repairs: 0, logicalTools: 1 });
      expect(h.modelWires).toHaveLength(0);
      expect(h.effects).toHaveLength(0);
      expect(await h.runtime.getTurnStatus(h.identity.userId, warm.sessionId, warm.turnId))
        .toMatchObject({ status: 'completed' });
    } finally { await h.dispose(); }
  }, 60000);
});
