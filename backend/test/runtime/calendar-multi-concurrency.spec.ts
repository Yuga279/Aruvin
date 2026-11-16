/**
 * ============================================================================
 * FILE: calendar-multi-concurrency.spec.ts
 * LOCATION: backend/test/runtime/calendar-multi-concurrency.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Proves the v2 Calendar runtime admits exactly one competing approval
 *    reply, creates exactly one Google event, and keeps one bounded budget.
 *
 * ROLE IN PROJECT:
 *    Runtime regression coverage for the single-process multi-calendar flow:
 *    two browser tabs answering the same disclosed proposal must not both be
 *    accepted, must not both create, and must not reset the charged budget.
 *
 * KEY COMPONENTS:
 *    - competing replies: one accepted reply, one rejected reply.
 *    - single create effect: one Google create for one accepted intent.
 *    - exact debit: one logical tool and one create in the accepted turn.
 *    - retry of an accepted turn: same budget, same deadline, no second create.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import type { SubmitTurnResponse } from '../../src/contracts/api.js';
import { calendarFixture, createWire, loadWire, textWire } from './calendar-runtime.fixture.js';
import { disclose, event } from './calendar-multi-fixture.js';

const workRequest =
  'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.';

it('admits one reply across tabs and does not reset its budget on retry', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
    const first = await disclose(h, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', event());
    const results = await Promise.allSettled([
      h.reply(first.proposal, 'Yes', first.ids.sessionId),
      h.reply(first.proposal, 'Go ahead', first.ids.sessionId),
    ]);
    const acceptedReplies = results.filter((result): result is PromiseFulfilledResult<SubmitTurnResponse> => result.status === 'fulfilled');
    expect(acceptedReplies).toHaveLength(1);
    h.modelWires.push(textWire('Created.'));
    await h.execute(acceptedReplies[0].value);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId,
      first.ids.sessionId, acceptedReplies[0].value.turnId);
    expect(budget).toMatchObject({ creates: 1, logicalTools: 1 });
  } finally { await h.dispose(); }
});

it('rejects a second same-session reply while the first is still accepted', async () => {
  const h = calendarFixture();
  try {
    h.setAvailability({ busy: [{ start: '2026-11-03T10:15:00Z', end: '2026-11-03T10:30:00Z' }] });
    const first = await disclose(h, 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.', event());
    const accepted = await h.reply(first.proposal, 'Yes', first.ids.sessionId);
    await expect(h.reply(first.proposal, 'Go ahead', first.ids.sessionId))
      .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
    h.modelWires.push(textWire('Created.'));
    await h.execute(accepted);
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('keeps the charged budget and the single create when an accepted turn is retried', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(workRequest);
    // The create succeeds and result persistence fails, so the accepted turn stays
    // retryable with its durable receipt intact.
    h.failOnce('result-save-v2');
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'));
    await expect(h.execute(ids)).rejects.toBeDefined();
    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    const charged = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);

    const retry = await h.runtime.retryTurn({
      identity: h.identity, sessionId: ids.sessionId, turnId: ids.turnId,
      idempotencyKey: 'calendar-retry-0001',
    });
    h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'), textWire('Created.'));
    await h.execute(retry);

    expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
    expect(budget).toMatchObject({ creates: 1, logicalTools: 1 });
    expect(budget?.deadlineAt).toBe(charged?.deadlineAt);
  } finally { await h.dispose(); }
});
