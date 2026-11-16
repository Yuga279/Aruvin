/**
 * ============================================================================
 * FILE: calendar-recovery.native.e2e-spec.ts
 * LOCATION: backend/test/runtime/calendar-recovery.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove the v2 Calendar authority and recovery behaviour on an isolated
 *    native MongoDB database.
 *
 * ROLE IN PROJECT:
 *    This is the isolated-native evidence for the multi-calendar create path.
 *    A disclosed conflict is accepted, the provider write succeeds, the local
 *    receipt save fails, and the session is recovered after the executor was
 *    stopped. Recovery must reconcile only the original target and must never
 *    replay the provider.
 *
 * KEY COMPONENTS:
 *    - prerequisite guard: The suite skips unless the operator supplied the
 *      isolated native URI and the generated database prefix.
 *    - recovery behaviour: One consumed intent survives the restart with the
 *      original operation, calendar and event identity.
 *    - competing consume: Two tabs answering the same disclosure admit one
 *      reply, consume the proposal once, and create one event.
 *    - exact debit: A create debit whose acknowledgement is lost stays charged
 *      exactly once and an exact repeat moves no counter.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import { disclose, event, nativeCalendarFixture } from './calendar-multi-fixture.js';
import { createWire, textWire } from './calendar-runtime.fixture.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

const REQUEST = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';

describe.skipIf(!configured)('Calendar v2 isolated native authority and recovery', () => {
  it('persists one consumed intent across restart and reconciles only the original target', async () => {
    const h = await nativeCalendarFixture();
    try {
      h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
      const first = await disclose(h, REQUEST, event());
      const reply = await h.reply(first.proposal, 'Go ahead', first.ids.sessionId);
      h.modelWires.push(textWire('Created despite the disclosed conflict.'));
      h.failOnce('receipt-save');
      await expect(h.execute(reply)).rejects.toBeDefined();
      const original = await h.operationFor(reply);
      expect(original).not.toBeNull();
      expect(original!.calendarId).toBe('team@example.test');

      await h.setDefault('personal@example.test');
      await h.restartStoppedExecutor();
      await h.runtime.reconcileSession(h.identity.userId, reply.sessionId);

      const recovered = await h.operationFor(reply);
      expect(recovered).toMatchObject({
        operationId: original!.operationId,
        calendarId: 'team@example.test',
        googleEventId: original!.googleEventId,
        state: 'succeeded',
      });
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
      expect(h.effects.filter(e => e.kind === 'readback').map(e => e.eventId))
        .toEqual([original!.googleEventId]);
    } finally { await h.dispose(); }
  }, 30000);

  it('admits one competing reply and consumes the proposal once', async () => {
    const h = await nativeCalendarFixture();
    try {
      h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
      const first = await disclose(h, REQUEST, event());
      // Two tabs answer the same disclosure. One session admits one active
      // approval, so exactly one reply is accepted and one is refused.
      const results = await Promise.allSettled([
        h.reply(first.proposal, 'Yes', first.ids.sessionId),
        h.reply(first.proposal, 'Go ahead', first.ids.sessionId),
      ]);
      const accepted = results.filter(
        (result): result is PromiseFulfilledResult<SubmitTurnResponse> => result.status === 'fulfilled');
      expect(accepted).toHaveLength(1);

      h.modelWires.push(textWire('Created.'));
      await h.execute(accepted[0].value);

      // One accepted intent produces exactly one provider create.
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
      // The proposal was consumed once; the refused reply consumed nothing.
      const authority = await h.proposalAuthority(first.proposal);
      expect(authority.state).toBe('consumed');
      if (authority.state !== 'consumed') throw new Error('expected a consumed proposal authority');
      expect(authority.consumption.intentId).toBeTruthy();
      const budget = await h.budgetFor(accepted[0].value);
      expect(budget).toMatchObject({ creates: 1, logicalTools: 1 });
    } finally { await h.dispose(); }
  }, 30000);

  it('charges the create exactly once when the debit acknowledgement is lost', async () => {
    const h = await nativeCalendarFixture();
    try {
      const ids = await h.submit(REQUEST);
      h.modelWires.push(createWire(event(), 'create-one'));
      // The debit is committed and only its acknowledgement is lost.
      h.failOnce('create-debit', true);
      await expect(h.execute(ids)).rejects.toBeDefined();

      // The charge is durable: it is neither refunded nor repeated.
      const budget = await h.budgetFor(ids);
      expect(budget).toMatchObject({ creates: 1 });
      // The lost acknowledgement stopped the write before the provider call.
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);

      const createDebit = h.debits.find(debit => debit.kindOfDebit === 'create');
      expect(createDebit).toBeDefined();
      if (!createDebit) throw new Error('expected a create debit');
      // The exact same debit identity is a duplicate that moves no counter.
      const replay = await h.replayDebit(createDebit);
      expect(replay.outcome).toBe('duplicate');
      expect((await h.budgetFor(ids))?.creates).toBe(1);
    } finally { await h.dispose(); }
  }, 30000);
});
