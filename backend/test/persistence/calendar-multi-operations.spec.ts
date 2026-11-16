/**
 * ============================================================================
 * FILE: calendar-multi-operations.spec.ts
 * LOCATION: backend/test/persistence/calendar-multi-operations.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Tests for Google Calendar Phase 2 cross-turn intent reservation and operations.
 *
 * ROLE IN PROJECT:
 *    Verifies immutable operation reservation by intent, cross-turn proposal
 *    authorization binding, state machine edges, and duplicate prevention.
 *
 * KEY COMPONENTS:
 *    - Keeps one intent operation and rejects cross-turn retargeting.
 *    - Cross-turn proposal reservation and idempotency.
 *    - Expired wrapper boundary enforcement.
 *    - Transition validation for v2 state machine edges.
 *    - v2 operation event append/list against the current intent operation.
 *    - v1 event append and read paths stay unchanged beside v2 events.
 *    - listUnresolvedBySession: bounded session-scoped unresolved operation read.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import {
  calendarReceiptV2Schema,
  operationEventSchema,
  operationEventV2Schema,
  operationRecordSchema,
  operationRecordV2Schema,
  type CalendarOperationEventV2,
  type CalendarOperationV2,
} from '../../src/contracts/calendar-operations.js';
import { MongoCalendarOperations, maxUnresolvedSessionOperations } from '../../src/persistence/calendar-operations.js';
import { MongoCalendarProposals } from '../../src/persistence/calendar-proposals.js';
import { directOperation, connectedCalendarMemory, pendingProposal, acceptedReply } from './calendar-multi-fixtures.js';
import { at, entry, hash, operationV1, sourceV2 } from '../contracts/calendar-multi-fixtures.js';

const v2Event = (
  operation: CalendarOperationV2,
  patch: Partial<CalendarOperationEventV2> = {},
): CalendarOperationEventV2 => operationEventV2Schema.parse({
  schemaVersion: 2,
  kind: 'calendar-operation-event-v2',
  userId: operation.userId,
  sessionId: operation.sessionId,
  turnId: operation.turnId,
  attemptId: operation.originatingAttemptId,
  operationId: operation.operationId,
  intentId: operation.intentId,
  eventId: `event-${operation.operationId}-${operation.sequence}`,
  sequence: operation.sequence,
  state: operation.state,
  revision: operation.revision,
  createdAt: operation.updatedAt,
  failure: null,
  ...patch,
});

const v2Operation = (turnId: string, intentId: string, operationId: string) =>
  operationRecordV2Schema.parse({
    ...directOperation(),
    turnId,
    intentId,
    operationId,
    authorization: { ...directOperation().authorization, acceptedTurnId: turnId },
  });

const v1Operation = (patch: Record<string, unknown> = {}) =>
  operationRecordSchema.parse({ ...operationV1, ...patch });

it('keeps one intent operation and rejects cross-turn retargeting', async () => {
  const f = await connectedCalendarMemory(); const a = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS);
  const op = directOperation();
  expect((await a.v2.reserveByIntent({ operation: op, consumption: null })).outcome).toBe('created');
  const b = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS);
  expect(await b.v2.getByIntent('u', 's', 'intent')).toEqual(op);
  expect((await b.v2.reserveByIntent({ operation: { ...op, originatingAttemptId: 'retry-attempt' },
    consumption: null })).outcome).toBe('existing');
  await expect(b.v2.reserveByIntent({ operation: { ...op, calendarId: 'other@group.calendar.google.com',
    calendarLabel: null, labelExpiresAt: null, actionSources: [], action: { ...op.action!, calendarId: 'other@group.calendar.google.com' } },
    consumption: null })).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  expect(await b.v2.getByIntent('u', 'other-session', 'intent')).toBeNull();
  const dispatched = { ...op, revision: 2, sequence: op.sequence + 1, state: 'dispatching' as const };
  expect((await b.v2.compareAndSwap({ expectedRevision: 1, next: dispatched })).outcome).toBe('confirmed');
  const unknown = { ...dispatched, revision: 3, sequence: dispatched.sequence + 1, state: 'unknown' as const };
  expect((await b.v2.compareAndSwap({ expectedRevision: 2, next: unknown })).outcome).toBe('confirmed');
  await expect(b.v2.compareAndSwap({ expectedRevision: 3,
    next: { ...unknown, revision: 4, sequence: unknown.sequence + 1, state: 'dispatching' } }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('reserves across turns from proposal consumption and enforces authority expiration boundary', async () => {
  const f = await connectedCalendarMemory();
  let now = Date.parse('2026-10-22T10:01:00.000Z');
  const clock = () => now;
  const proposals = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, clock);
  const operations = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, clock);

  await proposals.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
  const reply = acceptedReply();
  const consumeRes = await proposals.consume({ reply, operationId: 'proposal-op', intentId: 'intent' });
  expect(consumeRes.outcome).toBe('consumed');
  if (consumeRes.outcome !== 'consumed') throw new Error('not consumed');

  const propOp = {
    ...directOperation(),
    operationId: consumeRes.consumption.operationId,
    turnId: reply.acceptedTurnId,
    calendarId: consumeRes.consumption.calendarId,
    requestHash: consumeRes.consumption.canonicalActionHash,
    authorization: {
      acceptedUserMessageId: reply.acceptedMessageId,
      acceptedTurnId: reply.acceptedTurnId,
      canonicalActionHash: consumeRes.consumption.canonicalActionHash,
      approvedAt: reply.receivedAt,
      basis: 'conflict-acceptance' as const,
      proposalId: reply.proposalId,
      conditionFingerprint: reply.conditionFingerprint,
    },
  };

  // Missing or forged consumption rejects
  await expect(operations.v2.reserveByIntent({ operation: propOp, consumption: null }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(operations.v2.reserveByIntent({ operation: propOp, consumption: { ...consumeRes.consumption, operationId: 'forged' } }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // Valid reservation from proposal consumption succeeds
  const reserved = await operations.v2.reserveByIntent({ operation: propOp, consumption: consumeRes.consumption });
  expect(reserved.outcome).toBe('created');

  // Retry from another accepted turn returns stored operation
  const retryTurn = await operations.v2.reserveByIntent({
    operation: { ...propOp, turnId: 'later-turn', originatingAttemptId: 'later-attempt', authorization: { ...propOp.authorization, acceptedTurnId: 'later-turn' } },
    consumption: consumeRes.consumption,
  });
  expect(retryTurn.outcome).toBe('existing');
  if (retryTurn.outcome === 'existing') {
    expect(retryTurn.operation.operationId).toBe(propOp.operationId);
  }

  // Same turn with a second intent conflicts
  const secondIntentOp = {
    ...directOperation(),
    intentId: 'second-intent',
    operationId: 'second-op',
    turnId: propOp.turnId, // same turn
    authorization: { ...directOperation().authorization, acceptedTurnId: propOp.turnId },
  };
  await expect(operations.v2.reserveByIntent({ operation: secondIntentOp, consumption: null }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // Boundary test: consumed wrapper expiry reached, no operation yet -> INVALID_REQUEST
  await proposals.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: { ...pendingProposal(), proposalId: 'p-exp', intentId: 'intent-exp' } });
  const consumeExp = await proposals.consume({ reply: { ...reply, proposalId: 'p-exp' }, operationId: 'exp-op', intentId: 'intent-exp' });
  expect(consumeExp.outcome).toBe('consumed');
  if (consumeExp.outcome !== 'consumed') throw new Error('not consumed');

  now = Date.parse('2026-10-22T10:10:00.001Z'); // past expiry
  const expiredOp = {
    ...propOp,
    intentId: 'intent-exp',
    operationId: 'exp-op',
    authorization: { ...propOp.authorization, proposalId: 'p-exp' },
  };
  await expect(operations.v2.reserveByIntent({ operation: expiredOp, consumption: consumeExp.consumption }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('records and reads v2 operation events against the current intent operation', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  const op = directOperation();
  expect((await store.v2.reserveByIntent({ operation: op, consumption: null })).outcome).toBe('created');

  const planned = v2Event(op);
  expect((await store.v2.appendEventV2(planned)).outcome).toBe('confirmed');

  const dispatching = { ...op, revision: op.revision + 1, sequence: op.sequence + 1,
    state: 'dispatching' as const, updatedAt: '2026-10-22T10:02:00.000Z' };
  expect((await store.v2.compareAndSwap({ expectedRevision: op.revision, next: dispatching })).outcome)
    .toBe('confirmed');
  expect((await store.v2.appendEventV2(v2Event(dispatching))).outcome).toBe('confirmed');

  const events = await store.v2.listEventsV2({ userId: 'u', sessionId: 's', operationId: op.operationId });
  expect(events.map((event) => event.sequence)).toEqual([0, 1]);
  expect(events.map((event) => event.state)).toEqual(['planned', 'dispatching']);
  expect(events[0]?.eventId).toBe(planned.eventId);
  expect(events[0]?.intentId).toBe(op.intentId);
  expect(events[1]?.revision).toBe(dispatching.revision);
  expect(events.every((event) => event.operationId === op.operationId)).toBe(true);
});

it('is idempotent per v2 event id and rejects a different payload under the same id', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  const op = directOperation();
  await store.v2.reserveByIntent({ operation: op, consumption: null });

  const event = v2Event(op);
  expect((await store.v2.appendEventV2(event)).outcome).toBe('confirmed');
  expect((await store.v2.appendEventV2({ ...event })).outcome).toBe('confirmed');
  expect(await store.v2.listEventsV2({ userId: 'u', sessionId: 's', operationId: op.operationId }))
    .toHaveLength(1);

  await expect(store.v2.appendEventV2({ ...event, state: 'failed' as const,
    failure: { category: 'provider', code: 'PROVIDER_ERROR', retry: 'none' } }))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  expect(await store.v2.listEventsV2({ userId: 'u', sessionId: 's', operationId: op.operationId }))
    .toHaveLength(1);
});

it('rejects v2 events that do not match the current intent operation', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  const op = directOperation();
  await store.v2.reserveByIntent({ operation: op, consumption: null });

  await expect(store.v2.appendEventV2(v2Event({ ...op, operationId: 'other-op' })))
    .rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await expect(store.v2.appendEventV2(v2Event({ ...op, sessionId: 'other-session' })))
    .rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await expect(store.v2.appendEventV2(v2Event({ ...op, intentId: 'other-intent' })))
    .rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await expect(store.v2.appendEventV2(v2Event({ ...op, revision: op.revision + 1 })))
    .rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await expect(store.v2.appendEventV2(v2Event({ ...op, sequence: op.sequence + 1 })))
    .rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await expect(store.v2.appendEventV2(v2Event({ ...op, state: 'cancelled' as const })))
    .rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });

  expect(await store.v2.listEventsV2({ userId: 'u', sessionId: 's', operationId: op.operationId }))
    .toHaveLength(0);
});

it('records v2 terminal states that the legacy v1 writer could not confirm', async () => {
  for (const state of ['definitely-failed', 'failed', 'cancelled'] as const) {
    const f = await connectedCalendarMemory();
    const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
    const op = directOperation();
    expect((await store.v2.reserveByIntent({ operation: op, consumption: null })).outcome).toBe('created');

    const terminal = { ...op, revision: op.revision + 1, sequence: op.sequence + 1, state,
      updatedAt: '2026-10-22T10:02:00.000Z' };
    expect((await store.v2.compareAndSwap({ expectedRevision: op.revision, next: terminal })).outcome)
      .toBe('confirmed');
    expect((await store.v2.appendEventV2(v2Event(terminal))).outcome).toBe('confirmed');

    const events = await store.v2.listEventsV2({ userId: 'u', sessionId: 's', operationId: op.operationId });
    expect(events).toHaveLength(1);
    expect(events[0]?.state).toBe(state);
    expect(events[0]?.revision).toBe(terminal.revision);
  }
});

it('keeps v1 event appends and reads unchanged beside v2 events', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  const v1Operation = operationRecordSchema.parse(operationV1);
  expect((await store.reserve(v1Operation)).outcome).toBe('created');
  const v1Event = operationEventSchema.parse({ schemaVersion: 1, kind: 'calendar-operation-event',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', operationId: 'op',
    eventId: 'v1-event', sequence: v1Operation.sequence, state: 'planned', createdAt: at, failure: null });
  await store.appendEvent(v1Event);

  const listed = await store.listEvents({ userId: 'u', operationId: 'op', cursor: null, limit: 10 });
  expect(listed.items).toHaveLength(1);
  expect(listed.items[0]?.eventId).toBe('v1-event');

  // A v2 event for the same user and operation id must stay invisible to v1 reads.
  const v2Operation = { ...directOperation(), sessionId: 's2', turnId: 't2', intentId: 'intent2',
    authorization: { ...directOperation().authorization, acceptedTurnId: 't2' } };
  expect((await store.v2.reserveByIntent({ operation: v2Operation, consumption: null })).outcome)
    .toBe('created');
  expect((await store.v2.appendEventV2(v2Event(v2Operation))).outcome).toBe('confirmed');

  const after = await store.listEvents({ userId: 'u', operationId: 'op', cursor: null, limit: 10 });
  expect(after.items).toHaveLength(1);
  expect(after.items[0]?.schemaVersion).toBe(1);
  expect(await store.v2.listEventsV2({ userId: 'u', sessionId: 's2', operationId: 'op' })).toHaveLength(1);
});

it('lists only the unresolved operations of one session and hides terminal ones', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));

  const planned = v2Operation('turn-planned', 'intent-planned', 'op-planned');
  expect((await store.v2.reserveByIntent({ operation: planned, consumption: null })).outcome).toBe('created');

  const dispatching = v2Operation('turn-dispatching', 'intent-dispatching', 'op-dispatching');
  expect((await store.v2.reserveByIntent({ operation: dispatching, consumption: null })).outcome).toBe('created');
  const dispatched = { ...dispatching, revision: 2, sequence: dispatching.sequence + 1, state: 'dispatching' as const };
  expect((await store.v2.compareAndSwap({ expectedRevision: 1, next: dispatched })).outcome).toBe('confirmed');

  const unknown = v2Operation('turn-unknown', 'intent-unknown', 'op-unknown');
  expect((await store.v2.reserveByIntent({ operation: unknown, consumption: null })).outcome).toBe('created');
  const unknownDispatched = { ...unknown, revision: 2, sequence: unknown.sequence + 1, state: 'dispatching' as const };
  expect((await store.v2.compareAndSwap({ expectedRevision: 1, next: unknownDispatched })).outcome).toBe('confirmed');
  const unknownState = { ...unknownDispatched, revision: 3, sequence: unknownDispatched.sequence + 1, state: 'unknown' as const };
  expect((await store.v2.compareAndSwap({ expectedRevision: 2, next: unknownState })).outcome).toBe('confirmed');

  const failed = v2Operation('turn-failed', 'intent-failed', 'op-failed');
  expect((await store.v2.reserveByIntent({ operation: failed, consumption: null })).outcome).toBe('created');
  expect((await store.v2.compareAndSwap({ expectedRevision: 1,
    next: { ...failed, revision: 2, sequence: failed.sequence + 1, state: 'failed' as const } })).outcome).toBe('confirmed');

  const cancelled = v2Operation('turn-cancelled', 'intent-cancelled', 'op-cancelled');
  expect((await store.v2.reserveByIntent({ operation: cancelled, consumption: null })).outcome).toBe('created');
  expect((await store.v2.compareAndSwap({ expectedRevision: 1,
    next: { ...cancelled, revision: 2, sequence: cancelled.sequence + 1, state: 'cancelled' as const } })).outcome).toBe('confirmed');

  const succeeded = v2Operation('turn-succeeded', 'intent-succeeded', 'op-succeeded');
  expect((await store.v2.reserveByIntent({ operation: succeeded, consumption: null })).outcome).toBe('created');
  const succeededDispatched = { ...succeeded, revision: 2, sequence: succeeded.sequence + 1, state: 'dispatching' as const };
  expect((await store.v2.compareAndSwap({ expectedRevision: 1, next: succeededDispatched })).outcome).toBe('confirmed');
  const receipt = calendarReceiptV2Schema.parse({
    schemaVersion: 2,
    operationId: succeeded.operationId,
    googleEventId: succeeded.googleEventId,
    connectionId: succeeded.connectionId,
    connectionRevision: succeeded.connectionRevision,
    targetRevision: succeeded.targetRevision,
    calendarId: succeeded.calendarId,
    calendarLabel: succeeded.calendarLabel,
    labelExpiresAt: succeeded.labelExpiresAt,
    requestHash: succeeded.requestHash,
    verifiedAt: at,
    source: { ...sourceV2, operationIds: [succeeded.operationId] },
    htmlLink: null,
  });
  expect((await store.v2.compareAndSwap({ expectedRevision: 2, next: {
    ...succeededDispatched, revision: 3, sequence: succeededDispatched.sequence + 1, state: 'succeeded' as const, receipt,
  } })).outcome).toBe('confirmed');

  const v1Failed = v1Operation({ turnId: 'turn-v1-failed', operationId: 'op-v1-failed' });
  expect((await store.reserve(v1Failed)).outcome).toBe('created');
  expect((await store.compareAndSwap(1, {
    ...v1Failed, revision: 2, sequence: v1Failed.sequence + 1, state: 'definitely-failed' as const,
  })).outcome).toBe('confirmed');

  const v1Expired = v1Operation({ turnId: 'turn-v1-expired', operationId: 'op-v1-expired' });
  expect((await store.reserve(v1Expired)).outcome).toBe('created');
  expect((await store.compareAndSwap(1, {
    ...v1Expired, revision: 2, sequence: v1Expired.sequence + 1, state: 'evidence-expired' as const, action: null,
  })).outcome).toBe('confirmed');

  // Another user's and another session's unresolved operations stay invisible.
  expect((await store.reserve(v1Operation({
    userId: 'other-user', turnId: 'turn-other-user', operationId: 'op-other-user',
  }))).outcome).toBe('created');
  expect((await store.reserve(v1Operation({
    sessionId: 'other-session', turnId: 'turn-other-session', operationId: 'op-other-session',
  }))).outcome).toBe('created');

  // The legacy v1 quarantine is an unresolved operation of the same collection.
  const v1Unknown = v1Operation({ turnId: 'turn-v1-unknown', operationId: 'op-v1-unknown' });
  expect((await store.reserve(v1Unknown)).outcome).toBe('created');
  expect((await store.compareAndSwap(1, {
    ...v1Unknown, revision: 2, sequence: v1Unknown.sequence + 1, state: 'dispatching' as const,
  })).outcome).toBe('confirmed');
  expect((await store.compareAndSwap(2, {
    ...v1Unknown, revision: 3, sequence: v1Unknown.sequence + 2, state: 'unknown' as const,
  })).outcome).toBe('confirmed');

  const listed = await store.v2.listUnresolvedBySession({ userId: 'u', sessionId: 's', limit: 10 });
  expect(listed.overflow).toBe(false);
  expect(listed.operations.map((operation) => operation.operationId)).toEqual([
    'op-unknown', 'op-v1-unknown', 'op-dispatching', 'op-planned',
  ]);
  expect(listed.operations.map((operation) => operation.schemaVersion)).toEqual([2, 1, 2, 2]);
  expect(listed.operations.map((operation) => operation.state)).toEqual([
    'unknown', 'unknown', 'dispatching', 'planned',
  ]);
  expect(listed.operations.every((operation) => operation.userId === 'u' && operation.sessionId === 's')).toBe(true);
});

it('bounds the session-scoped unresolved read and reports overflow', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));

  const planned = v2Operation('turn-a', 'intent-a', 'op-a');
  expect((await store.v2.reserveByIntent({ operation: planned, consumption: null })).outcome).toBe('created');
  const dispatching = v2Operation('turn-b', 'intent-b', 'op-b');
  expect((await store.v2.reserveByIntent({ operation: dispatching, consumption: null })).outcome).toBe('created');
  const dispatched = { ...dispatching, revision: 2, sequence: dispatching.sequence + 1, state: 'dispatching' as const };
  expect((await store.v2.compareAndSwap({ expectedRevision: 1, next: dispatched })).outcome).toBe('confirmed');
  const unknown = v2Operation('turn-c', 'intent-c', 'op-c');
  expect((await store.v2.reserveByIntent({ operation: unknown, consumption: null })).outcome).toBe('created');
  const unknownDispatched = { ...unknown, revision: 2, sequence: unknown.sequence + 1, state: 'dispatching' as const };
  expect((await store.v2.compareAndSwap({ expectedRevision: 1, next: unknownDispatched })).outcome).toBe('confirmed');
  const unknownState = { ...unknownDispatched, revision: 3, sequence: unknownDispatched.sequence + 1, state: 'unknown' as const };
  expect((await store.v2.compareAndSwap({ expectedRevision: 2, next: unknownState })).outcome).toBe('confirmed');

  const bounded = await store.v2.listUnresolvedBySession({ userId: 'u', sessionId: 's', limit: 2 });
  expect(bounded.overflow).toBe(true);
  expect(bounded.operations.map((operation) => operation.operationId)).toEqual(['op-c', 'op-b']);

  const whole = await store.v2.listUnresolvedBySession({ userId: 'u', sessionId: 's', limit: 3 });
  expect(whole.overflow).toBe(false);
  expect(whole.operations.map((operation) => operation.operationId)).toEqual(['op-c', 'op-b', 'op-a']);
});

it('refuses an invalid unresolved-operation limit or scope', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));

  for (const limit of [0, -1, 1.5, Number.NaN, maxUnresolvedSessionOperations + 1]) {
    await expect(store.v2.listUnresolvedBySession({ userId: 'u', sessionId: 's', limit }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  }
  await expect(store.v2.listUnresolvedBySession({ userId: 'u', sessionId: '', limit: 5 }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(store.v2.listUnresolvedBySession({
    userId: 'u', sessionId: 's', limit: maxUnresolvedSessionOperations,
  })).resolves.toMatchObject({ operations: [], overflow: false });
});

it('finds a succeeded create by canonical action hash in the same session', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  const succeeded = v2Operation('turn-succeeded', 'intent-succeeded', 'op-succeeded');
  expect((await store.v2.reserveByIntent({ operation: succeeded, consumption: null })).outcome).toBe('created');
  expect(await store.v2.findSucceededByRequestHash('u', 's', succeeded.requestHash)).toBeNull();
  const dispatched = { ...succeeded, revision: 2, sequence: succeeded.sequence + 1, state: 'dispatching' as const };
  expect((await store.v2.compareAndSwap({ expectedRevision: 1, next: dispatched })).outcome).toBe('confirmed');
  const receipt = calendarReceiptV2Schema.parse({
    schemaVersion: 2,
    operationId: succeeded.operationId,
    googleEventId: succeeded.googleEventId,
    connectionId: succeeded.connectionId,
    connectionRevision: succeeded.connectionRevision,
    targetRevision: succeeded.targetRevision,
    calendarId: succeeded.calendarId,
    calendarLabel: succeeded.calendarLabel,
    labelExpiresAt: succeeded.labelExpiresAt,
    requestHash: succeeded.requestHash,
    verifiedAt: at,
    source: { ...sourceV2, operationIds: [succeeded.operationId] },
    htmlLink: null,
  });
  expect((await store.v2.compareAndSwap({ expectedRevision: 2, next: {
    ...dispatched, revision: 3, sequence: dispatched.sequence + 1, state: 'succeeded' as const, receipt,
  } })).outcome).toBe('confirmed');
  const found = await store.v2.findSucceededByRequestHash('u', 's', succeeded.requestHash);
  expect(found).toMatchObject({ operationId: 'op-succeeded', state: 'succeeded' });
  expect(await store.v2.findSucceededByRequestHash('u', 'other-session', succeeded.requestHash)).toBeNull();
  await expect(store.v2.findSucceededByRequestHash('u', 's', 'not-a-hash'))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('finds a succeeded create by calendar slot instants in the same session', async () => {
  const f = await connectedCalendarMemory();
  const store = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(at));
  const succeeded = v2Operation('turn-slot', 'intent-slot', 'op-slot');
  expect((await store.v2.reserveByIntent({ operation: succeeded, consumption: null })).outcome).toBe('created');
  const dispatched = { ...succeeded, revision: 2, sequence: succeeded.sequence + 1, state: 'dispatching' as const };
  expect((await store.v2.compareAndSwap({ expectedRevision: 1, next: dispatched })).outcome).toBe('confirmed');
  const receipt = calendarReceiptV2Schema.parse({
    schemaVersion: 2,
    operationId: succeeded.operationId,
    googleEventId: succeeded.googleEventId,
    connectionId: succeeded.connectionId,
    connectionRevision: succeeded.connectionRevision,
    targetRevision: succeeded.targetRevision,
    calendarId: succeeded.calendarId,
    calendarLabel: succeeded.calendarLabel,
    labelExpiresAt: succeeded.labelExpiresAt,
    requestHash: succeeded.requestHash,
    verifiedAt: at,
    source: { ...sourceV2, operationIds: [succeeded.operationId] },
    htmlLink: null,
  });
  expect((await store.v2.compareAndSwap({ expectedRevision: 2, next: {
    ...dispatched, revision: 3, sequence: dispatched.sequence + 1, state: 'succeeded' as const, receipt,
  } })).outcome).toBe('confirmed');
  const found = await store.v2.findOwnCreateBySlot('u', 's', {
    calendarId: succeeded.calendarId,
    start: '2026-10-22T10:00:00Z',
    end: '2026-10-22T11:00:00Z',
  });
  expect(found).toMatchObject({ operationId: 'op-slot', state: 'succeeded' });
  expect(await store.v2.findOwnCreateBySlot('u', 's', {
    calendarId: succeeded.calendarId,
    start: '2026-10-22T11:00:00Z',
    end: '2026-10-22T12:00:00Z',
  })).toBeNull();
  expect(await store.v2.findOwnCreateBySlot('u', 'other-session', {
    calendarId: succeeded.calendarId,
    start: '2026-10-22T10:00:00Z',
    end: '2026-10-22T11:00:00Z',
  })).toBeNull();
});
