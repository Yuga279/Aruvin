/**
 * ============================================================================
 * FILE: native-recovery.native.e2e-spec.ts
 * LOCATION: backend/test/integration/plugins/multi-calendar/native-recovery.native.e2e-spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify pinned multi-calendar recovery and budgets on an isolated native store.
 * ROLE IN PROJECT:
 *    Uses operator-supplied generated-database prerequisites and scripted providers.
 *    Never borrows an application database or treats native storage as live Google.
 * KEY COMPONENTS:
 *    - Prerequisite guard: Exact test prefix and explicitly enabled native run.
 *    - Recovery: One event identity and persistent counters after stopped restart.
 * ============================================================================
 */
import { describe, expect, it } from 'vitest';
import { disclose, event, nativeCalendarFixture } from '../../../runtime/calendar-multi-fixture.js';
import { createWire, textWire } from '../../../runtime/calendar-runtime.fixture.js';

const configured = process.env.AURVIN_P9_NATIVE_AUTHORIZED === 'true'
  && Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';
const request = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';

describe.skipIf(!configured)('P9 isolated native multi-calendar', () => {
  it('retains the original effect and budget after a stopped executor and default switch', async () => {
    const h = await nativeCalendarFixture();
    try {
      h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
      const first = await disclose(h, request, event());
      const reply = await h.reply(first.proposal, 'Go ahead');
      h.failOnce('receipt-save');
      await expect(h.execute(reply)).rejects.toBeDefined();
      const original = await h.operationFor(reply);
      const before = await h.budgetFor(reply);
      expect(original?.calendarId).toBe('team@example.test');
      expect(before?.creates).toBe(1);
      await h.setDefault('personal@example.test');
      await h.restartStoppedExecutor();
      await h.runtime.reconcileSession(h.identity.userId, reply.sessionId);
      expect(await h.operationFor(reply)).toMatchObject({ state: 'succeeded',
        operationId: original!.operationId, calendarId: original!.calendarId,
        googleEventId: original!.googleEventId });
      const after = await h.budgetFor(reply);
      expect(after?.creates).toBe(before?.creates);
      expect(after?.logicalTools).toBe(before?.logicalTools);
      expect(after?.modelDispatches).toBe(before?.modelDispatches);
      expect(after?.deadlineAt).toBe(before?.deadlineAt);
      expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
      expect(h.effects.filter(effect => effect.kind === 'readback')).toEqual([
        { kind: 'readback', calendarId: original!.calendarId, eventId: original!.googleEventId },
      ]);
      const newTurn = await h.submit('Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.');
      h.setAvailability({ busy: [] });
      h.modelWires.push(createWire(event()), textWire('Created on the new default.'));
      await h.execute(newTurn);
      expect(await h.operationFor(newTurn)).toMatchObject({ state: 'succeeded', calendarId: 'personal@example.test' });
    } finally { await h.dispose(); }
  }, 60000);
});
