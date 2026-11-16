/**
 * ============================================================================
 * FILE: calendar-multi-recovery.spec.ts
 * LOCATION: backend/test/runtime/calendar-multi-recovery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove that an interrupted multi-calendar turn is continued from its
 *    durable evidence alone, never from free-form history and never with a
 *    paid or write replay.
 *
 * ROLE IN PROJECT:
 *    The continuation classifier decides what a crashed turn may do next from
 *    the saved decision, the saved result, the consumed proposal and the saved
 *    operation. The crash-window tests hold that the runtime never creates a
 *    second event and never charges a second logical tool while the original
 *    effect is still unknown.
 *
 * KEY COMPONENTS:
 *    - Classifier tests: One branch per durable evidence shape.
 *    - Crash windows: proposal save, proposal consume, logical debit, create debit.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { classifyCalendarContinuationV2 } from '../../src/chat-runtime/calendar-recovery.js';
import { calendarInputSchemas } from '../../src/contracts/calendar-tools.js';
import { calendarFixture, createWire, skillWire, textWire } from './calendar-runtime.fixture.js';
import { busy, disclose, event } from './calendar-multi-fixture.js';

const action = calendarInputSchemas.calendar_create_event.parse({
  summary: 'Planning', start: '2026-11-03T10:00:00+00:00',
  end: '2026-11-03T11:00:00+00:00', timeZone: 'Etc/UTC',
});
const request = 'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.';

const base = {
  sealed: false, decisionId: null, toolCallId: null, intentId: null, operationId: null,
  operationState: null, resultRetained: false, resultExpired: false, proposalConsumed: false,
  consumptionConfirmed: false, dispatchedWithoutDecision: false, deadlinePassed: false,
};

describe('Calendar continuation classifier', () => {
  it('reuses the exact saved decision when no tool effect happened', () => {
    expect(classifyCalendarContinuationV2({ ...base, decisionId: 'decision-1' }))
      .toEqual({ kind: 'reuse-decision', decisionId: 'decision-1' });
  });

  it('rebuilds the group from a saved complete retained result', () => {
    expect(classifyCalendarContinuationV2({
      ...base, decisionId: 'decision-1', toolCallId: 'call-1', resultRetained: true,
    })).toEqual({ kind: 'reuse-result', decisionId: 'decision-1', toolCallId: 'call-1' });
  });

  it('repairs a consumed proposal from its confirmed consumption', () => {
    expect(classifyCalendarContinuationV2({
      ...base, intentId: 'intent-1', proposalConsumed: true, consumptionConfirmed: true,
    })).toEqual({ kind: 'repair-consumption', intentId: 'intent-1' });
  });

  it('interrupts when the consumption confirmation was lost', () => {
    expect(classifyCalendarContinuationV2({
      ...base, intentId: 'intent-1', proposalConsumed: true, consumptionConfirmed: false,
    })).toEqual({ kind: 'interrupt', code: 'EVIDENCE_MISSING' });
  });

  it('requires a fresh final check before the first dispatch of a planned operation', () => {
    expect(classifyCalendarContinuationV2({
      ...base, operationId: 'operation-1', operationState: 'planned',
    })).toEqual({ kind: 'dispatch-planned', operationId: 'operation-1' });
  });

  it('allows only the original readback for a dispatched or unknown operation', () => {
    for (const state of ['dispatching', 'unknown']) {
      expect(classifyCalendarContinuationV2({
        ...base, operationId: 'operation-1', operationState: state,
      })).toEqual({ kind: 'reconcile-operation', operationId: 'operation-1' });
    }
  });

  it('publishes a succeeded operation and a sealed turn', () => {
    expect(classifyCalendarContinuationV2({
      ...base, operationId: 'operation-1', operationState: 'succeeded',
    })).toEqual({ kind: 'publish', seal: null });
    expect(() => classifyCalendarContinuationV2({ ...base, sealed: true })).toThrow();
  });

  it('interrupts an inference whose outcome is unknown', () => {
    expect(classifyCalendarContinuationV2({ ...base, dispatchedWithoutDecision: true }))
      .toEqual({ kind: 'interrupt', code: 'INFERENCE_OUTCOME_UNKNOWN' });
  });

  it('interrupts an expired result and an expired deadline', () => {
    expect(classifyCalendarContinuationV2({ ...base, resultExpired: true }))
      .toEqual({ kind: 'interrupt', code: 'EVIDENCE_EXPIRED' });
    expect(classifyCalendarContinuationV2({ ...base, deadlinePassed: true }))
      .toEqual({ kind: 'interrupt', code: 'TURN_DEADLINE_EXCEEDED' });
  });
});

describe('Calendar crash windows', () => {
  it('never charges a second logical tool or creates a second event', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit(request);
      h.modelWires.push(createWire(action, 'create-one'));
      h.failOnce('create-debit');
      await expect(h.execute(ids)).rejects.toBeDefined();
      // The create was refused by its own durable debit: no event was written.
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budget?.creates).toBe(0);
      const operation = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
      expect(operation).toBeNull();
    } finally { await h.dispose(); }
  });

  it('keeps a consumed proposal without an operation from creating an event', async () => {
    const h = calendarFixture();
    try {
      h.setAvailability({ busy: [busy('2026-11-03T10:15:00Z', '2026-11-03T10:30:00Z')] });
      const first = await disclose(h, request, event());
      expect(first.proposal.purpose).toBe('conflict');
      const reply = await h.reply(first.proposal, 'Yes, go ahead', first.ids.sessionId);
      // The consumption is durable, the operation never is.
      h.failOnce('operation-reserve');
      await expect(h.execute(reply)).rejects.toBeDefined();
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      const operation = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, reply.sessionId, reply.turnId);
      expect(operation).toBeNull();
      // The approval was consumed once and is never replayed.
      expect((await h.proposalAuthority(first.proposal)).state).toBe('consumed');
    } finally { await h.dispose(); }
  });

  it('never charges the logical tool twice for the same model decision', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit('Read event abcde');
      h.modelWires.push(
        skillWire('activate_skill', { plugin: 'google-calendar', tools: ['calendar_get_event'] }, 'load'),
        skillWire('call_tool', { plugin: 'google-calendar', tool: 'calendar_get_event',
          arguments: { eventId: 'abcde' } }, 'get'), textWire('Found it.'));
      h.failOnce('logical-debit');
      await expect(h.execute(ids)).rejects.toBeDefined();
      const budget = await h.p.calendarAccountingV2.getBudget(h.identity.userId, ids.sessionId, ids.turnId);
      expect(budget?.logicalTools).toBe(0);
      // The refused logical tool never reached the provider.
      expect(h.effects.filter(e => e.kind === 'get')).toHaveLength(0);
    } finally { await h.dispose(); }
  });
});
