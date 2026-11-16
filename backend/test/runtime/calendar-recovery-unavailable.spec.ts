/**
 * ============================================================================
 * FILE: calendar-recovery-unavailable.spec.ts
 * LOCATION: backend/test/runtime/calendar-recovery-unavailable.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove that an unavailable Calendar leaves a pending operation unknown and
 *    never aborts the ordinary text recovery.
 *
 * ROLE IN PROJECT:
 *    The reconciliation of a dispatched create must fail closed. A missing,
 *    revoked, replaced or unconfigured Calendar leaves the operation unknown
 *    with no receipt, so the user is never told a false success and the
 *    provider is never asked to write again.
 *
 * KEY COMPONENTS:
 *    - connection gone: The pending operation stays unknown.
 *    - policy unavailable: The pending operation stays unknown.
 *    - replaced connection: A different account cannot prove the linkage.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarInputSchemas } from '../../src/contracts/calendar-tools.js';
import { calendarFixture, createWire, loadWire, textWire } from './calendar-runtime.fixture.js';

const action = calendarInputSchemas.calendar_create_event.parse({
  summary: 'Planning', start: '2026-10-22T10:00:00+00:00',
  end: '2026-10-22T11:00:00+00:00', timeZone: 'Etc/UTC',
});
const request = 'Schedule Planning on 2026-10-22 from 10:00 to 11:00 Etc/UTC.';

// The Calendar composition is always present in an assembled deployment. A
// deployment where the plugin is default-off, unconfigured or never connected
// must still recover ordinary text chat, and a pending Calendar operation must
// stay visible and unknown instead of disappearing with the connection.
it('recovers an ordinary text turn while the Calendar plugin is not connected', async () => {
  const h = calendarFixture();
  try {
    h.setBinding(null);
    h.modelWires.push(textWire('Hello from Aurvin'));
    h.failOnce('archive-save'); // crash after inference, before the assistant archive write
    const ids = await h.submit('Hello');
    await expect(h.execute(ids)).rejects.toBeDefined();
    await expect(h.runtime.reconcileSession(h.identity.userId, ids.sessionId)).resolves.toBeUndefined();
    const attempt = await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId);
    expect(attempt?.status).toBe('completed');
    const messages = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(messages.items.filter(item => item.role === 'assistant')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('keeps a pending Calendar operation unknown when the connection is gone', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(request);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(action, 'create-one'));
    h.failOnce('receipt-save'); // Google created the event, the receipt was not saved
    await expect(h.execute(ids)).rejects.toBeDefined();
    const pending = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(pending?.state).toBe('dispatching');
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);

    h.setBinding(null);
    await expect(h.runtime.reconcileSession(h.identity.userId, ids.sessionId)).resolves.toBeUndefined();

    const after = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(after?.state).toBe('unknown');
    expect(after?.receipt).toBeNull();
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    const state = await h.runtime.getCalendarTurnState(h.identity.userId, ids.sessionId, ids.turnId);
    expect(state).toMatchObject({ state: 'unknown', retryAction: 'resume-reconciliation' });

    // The unknown operation still denies another mutating dispatch: the gate
    // refuses the turn before any model request or Calendar write.
    const retry = await h.runtime.retryTurn({ identity: h.identity, sessionId: ids.sessionId,
      turnId: ids.turnId, idempotencyKey: 'retry-without-connection' });
    h.modelWires.push(loadWire('calendar_create_event'), createWire(action, 'create-two'));
    await expect(h.execute(retry)).rejects.toBeDefined();
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
    expect(h.modelBodies).toHaveLength(2);
  } finally { await h.dispose(); }
});

it('keeps a pending Calendar operation unknown when the Calendar policy is unavailable', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(request);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(action, 'create-one'));
    h.failOnce('receipt-save');
    await expect(h.execute(ids)).rejects.toBeDefined();

    h.setPolicyAvailable(false);
    await expect(h.runtime.reconcileSession(h.identity.userId, ids.sessionId)).resolves.toBeUndefined();

    const after = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(after?.state).toBe('unknown');
    expect(after?.receipt).toBeNull();
    expect(h.effects.filter(effect => effect.kind === 'create')).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('does not accept a pending operation through a replaced connection', async () => {
  const h = calendarFixture();
  try {
    const ids = await h.submit(request);
    h.modelWires.push(loadWire('calendar_create_event'), createWire(action, 'create-one'));
    h.failOnce('receipt-save');
    await expect(h.execute(ids)).rejects.toBeDefined();

    // A different account cannot prove the linkage of an event written by the
    // previous connection, so the operation stays unknown.
    await h.replaceAccount();
    await expect(h.runtime.reconcileSession(h.identity.userId, ids.sessionId)).resolves.toBeUndefined();

    const after = await h.p.calendarOperationsV2.getByTurn(h.identity.userId, ids.sessionId, ids.turnId);
    expect(after?.state).toBe('unknown');
    expect(after?.receipt).toBeNull();
    expect(after?.connectionRevision).toBe(1);
  } finally { await h.dispose(); }
});
