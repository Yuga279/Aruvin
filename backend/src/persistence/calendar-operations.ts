/**
 * ============================================================================
 * FILE: calendar-operations.ts
 * LOCATION: backend/src/persistence/calendar-operations.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Persistence adapter for Google Calendar operations, events, and reconciliations.
 *
 * ROLE IN PROJECT:
 *    Manages metadata collection operations for v1 turn-based operations and
 *    v2 cross-turn intent-based operations with immutable authority reservations.
 *
 * KEY COMPONENTS:
 *    - MongoCalendarOperations: Concrete store implementing CalendarOperationStore.
 *    - v2: Facade typed CalendarOperationStoreV2 for intent reservation and CAS.
 *    - reserveByIntent: Single immutable operation reservation per accepted intent.
 *    - compareAndSwapV2: Validates strict state machine transitions and audit bounds.
 *    - appendEventV2 / listEventsV2: Scoped v2 operation event append and read.
 *    - listUnresolvedBySession: Bounded session-scoped unresolved operation read.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { BudgetConfig } from '../contracts/budgets.js';
import {
  calendarOperationTransitionV2Schema,
  operationEventSchema,
  operationEventV2Schema,
  operationRecordSchema,
  operationRecordV2Schema,
  type CalendarOperation,
  type CalendarOperationEvent,
  type CalendarOperationEventV2,
  type CalendarOperationStore,
  type CalendarOperationStoreV2,
  type CalendarOperationV2,
  type OperationCas,
} from '../contracts/calendar-operations.js';
import {
  compatibleCalendarConnectionSchema,
  compatibleCalendarOperationSchema,
  calendarLegacyDispositionSchema,
  type CalendarLegacyDisposition,
} from '../contracts/calendar-compatibility.js';
import type { CalendarProposalConsumption } from '../contracts/calendar-authority.js';
import { calendarGrantStatus } from '../contracts/calendar-policy.js';
import { calendarAccountBindingSchema, calendarCanonicalIdSchema, type CalendarAccountBinding } from '../contracts/calendar-discovery.js';
import { sha256Schema } from '../contracts/calendar-connections.js';
import { idSchema, isoDateSchema } from '../contracts/identifiers.js';
import { AppError } from '../platform/errors/app-error.js';
import {
  calendarIntentReservationSchema,
  confirmCalendarRecord,
  connectionKey,
  decodeCalendar,
  decodeOperationEventCursor,
  encodeCalendar,
  encodeOperationEventCursor,
  intentOperationKey,
  intentReservationKey,
  legacyDispositionKey,
  operationEventKey,
  operationKey,
  proposalConsumptionKey,
  proposalConsumptionRecordSchema,
  reconciliationKey,
  reconciliationSchema,
  readCurrentCalendarAccountBinding,
  redactCalendarOperation,
  redactCalendarOperationForAccount,
  sameCalendarAccountBinding,
  type StoredDocument,
} from './calendar-records.js';
import { RecordStore } from './store.js';
import { key } from './records.js';

export const operationEventKeyV2 = (
  userId: string, sessionId: string, operationId: string, sequence: number,
): string => key('calendar-operation-event-v2', userId, sessionId, operationId, sequence);

/**
 * Operation states that still need reconciliation before another create in the
 * same session. v1 has no `failed`/`cancelled`; both are terminal in v2, so the
 * unresolved set is the union of the two schemas minus their terminal states.
 */
const unresolvedOperationStates = ['planned', 'dispatching', 'unknown'] as const;

/**
 * Hard ceiling for one session-scoped unresolved-operation lookup. The query
 * reads at most `limit + 1` documents, so a read never becomes a scan.
 */
export const maxUnresolvedSessionOperations = 50;

const nextStates = {
  planned: ['dispatching', 'definitely-failed', 'evidence-expired'],
  dispatching: ['succeeded', 'definitely-failed', 'unknown'],
  unknown: ['dispatching', 'succeeded', 'definitely-failed'],
  succeeded: ['evidence-expired'],
  'definitely-failed': ['evidence-expired'],
  'evidence-expired': [],
} as const;

const v2AllowedEdges: Record<CalendarOperationV2['state'], readonly CalendarOperationV2['state'][]> = {
  planned: ['dispatching', 'definitely-failed', 'failed', 'cancelled', 'evidence-expired'],
  dispatching: ['succeeded', 'definitely-failed', 'unknown'],
  unknown: ['succeeded', 'definitely-failed'],
  succeeded: ['evidence-expired'],
  'definitely-failed': ['evidence-expired'],
  failed: ['evidence-expired'],
  cancelled: ['evidence-expired'],
  'evidence-expired': [],
};

type Reconciliation = {
  schemaVersion: 1;
  kind: 'calendar-operation-reconciliation';
  userId: string;
  sessionId: string;
  turnId: string;
  operationId: string;
  eventId: string;
  operationRevision: number;
  outcome: 'absent' | 'mismatch' | 'unknown';
  connectionRevision: number;
  targetRevision: number;
  checkedAt: string;
  consumedAt: string | null;
};

export class MongoCalendarOperations implements CalendarOperationStore {
  readonly v2: CalendarOperationStoreV2 = {
    getByTurn: (userId, sessionId, turnId) => this.getCompatibleByTurn(userId, sessionId, turnId),
    getByIntent: (userId, sessionId, intentId) => this.getByIntent(userId, sessionId, intentId),
    reserveByIntent: (input) => this.reserveByIntent(input),
    compareAndSwap: (input) => this.compareAndSwapV2(input),
    appendEventV2: (event) => this.appendEventV2(event),
    listEventsV2: (input) => this.listEventsV2(input),
    listUnresolvedBySession: (input) => this.listUnresolvedBySession(input),
    findSucceededByRequestHash: (userId, sessionId, requestHash) =>
      this.findSucceededByRequestHash(userId, sessionId, requestHash),
    findOwnCreateBySlot: (userId, sessionId, slot) =>
      this.findOwnCreateBySlot(userId, sessionId, slot),
  };

  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
    readonly clock: () => number = Date.now,
  ) {}

  async getByTurn(userId: string, sessionId: string, turnId: string): Promise<CalendarOperation | null> {
    const raw = await this.store.raw('metadata', {
      _id: operationKey(userId, sessionId, turnId),
      userId, sessionId, turnId, kind: 'calendar-operation',
    });
    return decodeCalendar(operationRecordSchema, raw);
  }

  async getCompatibleByTurn(
    userId: string,
    sessionId: string,
    turnId: string,
  ): Promise<CalendarOperation | CalendarOperationV2 | null> {
    const docs = await this.store.collection('metadata').find({
      kind: 'calendar-operation',
      userId,
      sessionId,
      turnId,
    }).limit(2).toArray();

    if (docs.length > 1) {
      throw new AppError('PERSISTENCE_ERROR', 'Multiple operations found for turn.');
    }
    if (docs.length === 0) return null;
    return decodeCalendar(compatibleCalendarOperationSchema, docs[0]);
  }

  async getByIntent(
    userId: string,
    sessionId: string,
    intentId: string,
  ): Promise<CalendarOperationV2 | null> {
    const id = intentOperationKey(userId, sessionId, intentId);
    const raw = await this.store.raw('metadata', {
      _id: id,
      userId,
      sessionId,
      kind: 'calendar-operation',
    });
    return decodeCalendar(operationRecordV2Schema, raw);
  }

  /**
   * Lists the bounded unresolved operations of one session. The read is scoped
   * to one user and one session, hard-limited, and ordered newest-first, so it
   * can never become a cross-session scan. Both schema versions are returned
   * because a legacy v1 quarantine is an unresolved operation of the same
   * collection and must be visible to the same lookup.
   */
  async listUnresolvedBySession(input: {
    userId: string; sessionId: string; limit: number;
  }): Promise<{ operations: (CalendarOperation | CalendarOperationV2)[]; overflow: boolean }> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxUnresolvedSessionOperations) {
      throw new AppError('INVALID_REQUEST', 'Invalid page size.');
    }
    if (!idSchema.safeParse(input.userId).success || !idSchema.safeParse(input.sessionId).success) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence scope.');
    }
    const docs = await this.store.collection('metadata').find({
      kind: 'calendar-operation',
      userId: input.userId,
      sessionId: input.sessionId,
      state: { $in: unresolvedOperationStates },
    }, this.store.options())
      .sort({ sequence: -1, revision: -1, operationId: 1 })
      .limit(input.limit + 1)
      .toArray();
    return {
      operations: docs.slice(0, input.limit)
        .map((doc) => decodeCalendar(compatibleCalendarOperationSchema, doc)!),
      overflow: docs.length > input.limit,
    };
  }

  /**
   * One succeeded v2 create with this canonical action in the session. The read
   * is scoped to one user and one session and hard-limited, so it cannot become
   * a cross-session scan. A later intent that repeats the same event reuses this
   * row instead of treating the written busy interval as a new conflict.
   */
  async findSucceededByRequestHash(
    userId: string, sessionId: string, requestHash: string,
  ): Promise<CalendarOperationV2 | null> {
    if (!idSchema.safeParse(userId).success || !idSchema.safeParse(sessionId).success
      || !sha256Schema.safeParse(requestHash).success) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence scope.');
    }
    const docs = await this.store.collection('metadata').find({
      kind: 'calendar-operation',
      schemaVersion: 2,
      userId,
      sessionId,
      requestHash,
      state: 'succeeded',
    }, this.store.options())
      .sort({ sequence: -1, revision: -1, operationId: 1 })
      .limit(2)
      .toArray();
    if (docs.length === 0) return null;
    return decodeCalendar(operationRecordV2Schema, docs[0]);
  }

  /**
   * One succeeded or dispatching v2 create on this calendar whose action occupies
   * the same instants. The read is session-scoped and hard-limited; instant
   * equality is applied in memory so `Z` vs `+00:00` still matches.
   */
  async findOwnCreateBySlot(
    userId: string, sessionId: string, slot: { calendarId: string; start: string; end: string },
  ): Promise<CalendarOperationV2 | null> {
    if (!idSchema.safeParse(userId).success || !idSchema.safeParse(sessionId).success
      || !calendarCanonicalIdSchema.safeParse(slot.calendarId).success) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence scope.');
    }
    const startMs = Date.parse(slot.start);
    const endMs = Date.parse(slot.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence scope.');
    }
    const docs = await this.store.collection('metadata').find({
      kind: 'calendar-operation',
      schemaVersion: 2,
      userId,
      sessionId,
      calendarId: slot.calendarId,
      state: { $in: ['succeeded', 'dispatching'] },
    }, this.store.options())
      .sort({ sequence: -1, revision: -1, operationId: 1 })
      .limit(20)
      .toArray();
    for (const doc of docs) {
      const operation = decodeCalendar(operationRecordV2Schema, doc);
      if (!operation?.action) continue;
      if (Date.parse(operation.action.start) === startMs && Date.parse(operation.action.end) === endMs) {
        return operation;
      }
    }
    return null;
  }

  async reserve(record: CalendarOperation): Promise<{ outcome: 'created' | 'existing'; record: CalendarOperation }> {
    const value = this.parseOperation(record);
    if (value.state !== 'planned' || value.revision !== 1 || value.sequence < 0 || value.deliveryRetries !== 0) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (value.authorization.canonicalActionHash !== value.requestHash) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const id = operationKey(value.userId, value.sessionId, value.turnId);
    const existing = await this.getByTurn(value.userId, value.sessionId, value.turnId);
    if (existing) {
      if (existing.state === 'evidence-expired') {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      if (!isDeepStrictEqual(this.authority(existing), this.authority(value))) {
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
      }
      return { outcome: 'existing', record: existing };
    }
    const { record: boundedRecord, doc } = encodeCalendar(
      operationRecordSchema, value, id, this.budgets.maxDocumentBytes,
    );
    try {
      await this.store.collection('metadata').updateOne(
        { _id: id, userId: value.userId, sessionId: value.sessionId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      /* confirm below */
    }
    const saved = await this.getByTurn(value.userId, value.sessionId, value.turnId);
    if (saved && isDeepStrictEqual(this.authority(saved), this.authority(boundedRecord))) {
      return {
        outcome: isDeepStrictEqual(saved, boundedRecord) ? 'created' : 'existing',
        record: saved,
      };
    }
    if (saved) {
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
    }
    throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.');
  }

  async reserveByIntent(input: {
    operation: CalendarOperationV2;
    consumption: CalendarProposalConsumption | null;
  }): Promise<{ outcome: 'created' | 'existing'; operation: CalendarOperationV2 } | { outcome: 'uncertain' }> {
    let value: CalendarOperationV2;
    try {
      value = operationRecordV2Schema.parse(input.operation);
    } catch {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (value.state !== 'planned' || value.revision !== 1 || value.sequence < 0 || value.deliveryRetries !== 0) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }

    const id = intentOperationKey(value.userId, value.sessionId, value.intentId);
    const existing = await this.getByIntent(value.userId, value.sessionId, value.intentId);
    if (existing) {
      if (existing.state === 'evidence-expired') {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      if (!this.matchesV2Authority(existing, value)) {
        throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
      }
      await this.confirmCurrentAccountBinding(existing);
      return { outcome: 'existing', operation: existing };
    }

    const turnOp = await this.getCompatibleByTurn(value.userId, value.sessionId, value.turnId);
    if (turnOp) {
      if (turnOp.schemaVersion === 1) {
        throw new AppError('INVALID_REQUEST', 'Turn already has a v1 operation.');
      }
      if (turnOp.intentId !== value.intentId) {
        throw new AppError('INVALID_REQUEST', 'Turn already has an operation with a different intent.');
      }
    }

    const unresolvedV1 = await this.store.collection('metadata').findOne({
      kind: 'calendar-operation',
      userId: value.userId,
      sessionId: value.sessionId,
      schemaVersion: 1,
      state: { $in: ['dispatching', 'unknown'] },
    });
    if (unresolvedV1) {
      throw new AppError('INVALID_REQUEST', 'Unresolved legacy v1 operation exists in session.');
    }

    const rawConn = await this.store.raw('integration_connections', {
      _id: connectionKey(value.userId),
      userId: value.userId,
      provider: 'google-calendar',
    });
    if (!rawConn) throw new AppError('INVALID_REQUEST', 'No connection found.');
    const conn = decodeCalendar(compatibleCalendarConnectionSchema, rawConn);
    if (!conn || conn.schemaVersion !== 2) throw new AppError('INVALID_REQUEST', 'Invalid connection schema.');
    if (
      !conn.enabled
      || conn.status !== 'connected'
      || conn.connectionId !== value.connectionId
      || conn.connectionRevision !== value.connectionRevision
      || conn.googleSubjectId !== value.googleSubjectId
      || calendarGrantStatus(conn.grantedScopes).state !== 'complete'
    ) {
      throw new AppError('INVALID_REQUEST', 'Connection authority mismatch or not ready.');
    }

    if (value.authorization.basis === 'explicit-request') {
      if (input.consumption !== null || value.authorization.proposalId !== null || value.authorization.conditionFingerprint !== null) {
        throw new AppError('INVALID_REQUEST', 'Explicit request cannot carry proposal authorization.');
      }
      const resId = intentReservationKey(value.userId, value.sessionId, value.intentId);
      const proposedRes = calendarIntentReservationSchema.parse({
        schemaVersion: 2,
        kind: 'calendar-intent-reservation',
        userId: value.userId,
        sessionId: value.sessionId,
        connectionId: value.connectionId,
        connectionRevision: value.connectionRevision,
        googleSubjectId: value.googleSubjectId,
        intentId: value.intentId,
        operationId: value.operationId,
        canonicalActionHash: value.authorization.canonicalActionHash,
        calendarId: value.calendarId,
      });
      const { doc: resDoc } = encodeCalendar(
        calendarIntentReservationSchema,
        proposedRes,
        resId,
        this.budgets.maxDocumentBytes,
      );
      try {
        await this.store.collection('metadata').updateOne(
          { _id: resId, userId: value.userId },
          { $setOnInsert: resDoc },
          { upsert: true, ...this.store.options() },
        );
      } catch {
        /* confirm below */
      }
      const savedRes = await this.store.raw('metadata', { _id: resId, userId: value.userId });
      if (!savedRes) return { outcome: 'uncertain' };
      const decodedRes = decodeCalendar(calendarIntentReservationSchema, savedRes);
      if (!decodedRes) return { outcome: 'uncertain' };
      if (
        decodedRes.userId !== value.userId
        || decodedRes.connectionId !== value.connectionId
        || decodedRes.googleSubjectId !== value.googleSubjectId
        || decodedRes.canonicalActionHash !== value.authorization.canonicalActionHash
        || decodedRes.calendarId !== value.calendarId
        || decodedRes.operationId !== value.operationId
      ) {
        throw new AppError('INVALID_REQUEST', 'Intent reservation claim mismatch.');
      }
    } else {
      if (input.consumption === null) {
        throw new AppError('INVALID_REQUEST', 'Proposal consumption required.');
      }
      const c = input.consumption;
      if (
        c.userId !== value.userId
        || c.sessionId !== value.sessionId
        || c.intentId !== value.intentId
        || c.operationId !== value.operationId
        || c.calendarId !== value.calendarId
        || c.canonicalActionHash !== value.requestHash
        || c.acceptedMessageId !== value.authorization.acceptedUserMessageId
        || value.authorization.proposalId !== c.proposalId
      ) {
        throw new AppError('INVALID_REQUEST', 'Consumption authority mismatch.');
      }

      const wrapperId = proposalConsumptionKey(value.userId, value.sessionId, c.proposalId);
      const rawWrapper = await this.store.raw('metadata', { _id: wrapperId, userId: value.userId });
      if (!rawWrapper) throw new AppError('INVALID_REQUEST', 'Consumption wrapper missing.');
      const wrapper = decodeCalendar(proposalConsumptionRecordSchema, rawWrapper);
      if (!wrapper) throw new AppError('INVALID_REQUEST', 'Invalid consumption wrapper.');
      if (
        wrapper.intentId !== value.intentId
        || wrapper.consumption.operationId !== value.operationId
        || wrapper.consumption.canonicalActionHash !== value.requestHash
        || wrapper.consumption.calendarId !== value.calendarId
      ) {
        throw new AppError('INVALID_REQUEST', 'Wrapper consumption mismatch.');
      }

      const nowMs = this.clock();
      if (nowMs >= Date.parse(wrapper.authorityExpiresAt)) {
        throw new AppError('INVALID_REQUEST', 'Authority has expired.');
      }

      const resId = intentReservationKey(value.userId, value.sessionId, value.intentId);
      const rawRes = await this.store.raw('metadata', { _id: resId, userId: value.userId });
      if (!rawRes) throw new AppError('INVALID_REQUEST', 'Intent reservation missing.');
      const decodedRes = decodeCalendar(calendarIntentReservationSchema, rawRes);
      if (!decodedRes || decodedRes.operationId !== value.operationId) {
        throw new AppError('INVALID_REQUEST', 'Intent reservation operation mismatch.');
      }
    }

    const { record: boundedRecord, doc } = encodeCalendar(
      operationRecordV2Schema,
      value,
      id,
      this.budgets.maxDocumentBytes,
    );
    try {
      await this.store.collection('metadata').updateOne(
        { _id: id, userId: value.userId, sessionId: value.sessionId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      /* confirm below */
    }
    const saved = await this.getByIntent(value.userId, value.sessionId, value.intentId);
    if (saved && this.matchesV2Authority(saved, boundedRecord)) {
      await this.confirmCurrentAccountBinding(saved);
      return {
        outcome: isDeepStrictEqual(saved, boundedRecord) ? 'created' : 'existing',
        operation: saved,
      };
    }
    if (saved) {
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
    }
    throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.');
  }

  private async confirmCurrentAccountBinding(operation: CalendarOperationV2): Promise<void> {
    const account = calendarAccountBindingSchema.parse({
      userId: operation.userId,
      connectionId: operation.connectionId,
      connectionRevision: operation.connectionRevision,
      googleSubjectId: operation.googleSubjectId,
    });
    const now = new Date(Math.max(this.clock(), Date.parse(operation.updatedAt))).toISOString();
    let current: Awaited<ReturnType<typeof readCurrentCalendarAccountBinding>>;
    try {
      current = await readCurrentCalendarAccountBinding(this.store, operation.userId);
    } catch {
      const outcome = await this.redactInvalidatedRevision({
        account, sessionId: operation.sessionId, turnId: operation.turnId, now,
      });
      if (outcome !== 'confirmed') {
        throw new AppError('PERSISTENCE_ERROR', 'Calendar operation redaction could not be confirmed.', false);
      }
      throw new AppError('PERSISTENCE_ERROR', 'Calendar account authority could not be confirmed.', false);
    }
    if (sameCalendarAccountBinding(current, account)) return;
    const outcome = await this.redactInvalidatedRevision({
      account, sessionId: operation.sessionId, turnId: operation.turnId, now,
    });
    if (outcome !== 'confirmed') {
      throw new AppError('PERSISTENCE_ERROR', 'Calendar operation redaction could not be confirmed.', false);
    }
    throw new AppError('INVALID_REQUEST', 'Calendar account revision is no longer current.', false);
  }

  async compareAndSwap(expectedRevision: number, next: CalendarOperation): Promise<OperationCas> {
    const value = this.parseOperation(next);
    const id = operationKey(value.userId, value.sessionId, value.turnId);
    const raw = await this.store.raw('metadata', {
      _id: id, userId: value.userId, sessionId: value.sessionId, turnId: value.turnId, kind: 'calendar-operation',
    });
    const current = decodeCalendar(operationRecordSchema, raw);
    if (current && isDeepStrictEqual(current, value)) return { outcome: 'confirmed', record: current };
    if (!current || !raw) return { outcome: 'uncertain' };
    if (current.revision !== expectedRevision) return { outcome: 'conflict' };
    await this.assertTransition(current, value, expectedRevision);
    const { record, doc } = encodeCalendar(operationRecordSchema, value, id, this.budgets.maxDocumentBytes);
    doc._revision = raw._revision + 1;
    try {
      const result = await this.store.collection('metadata').replaceOne(
        {
          _id: id, userId: value.userId, sessionId: value.sessionId, turnId: value.turnId,
          kind: 'calendar-operation', revision: expectedRevision, _revision: raw._revision,
        },
        doc,
        this.store.options(),
      );
      if (result.matchedCount === 1) return { outcome: 'confirmed', record };
    } catch {
      /* reread */
    }
    const confirmed = await confirmCalendarRecord(
      () => this.getByTurn(value.userId, value.sessionId, value.turnId),
      record,
      (row) => row.revision,
    );
    if (confirmed.outcome === 'conflict') return { outcome: 'conflict' };
    return confirmed;
  }

  async redactInvalidatedRevision(input: {
    account: CalendarAccountBinding;
    sessionId: string;
    turnId: string;
    now: string;
  }): Promise<'confirmed' | 'conflict' | 'uncertain'> {
    const account = calendarAccountBindingSchema.parse(input.account);
    const nowMs = Date.parse(isoDateSchema.parse(input.now));
    const current = await this.getCompatibleByTurn(account.userId, input.sessionId, input.turnId);
    if (!current || current.userId !== account.userId || current.connectionId !== account.connectionId
      || current.connectionRevision !== account.connectionRevision || current.googleSubjectId !== account.googleSubjectId) {
      return 'conflict';
    }
    const effectiveNowMs = Math.max(nowMs, Date.parse(current.updatedAt));
    const redacted = redactCalendarOperationForAccount(current, account, effectiveNowMs);
    if (isDeepStrictEqual(redacted, current)) return 'confirmed';
    const updatedAt = new Date(effectiveNowMs).toISOString();
    if (redacted.schemaVersion === 2) {
      const result = await this.compareAndSwapV2({
        expectedRevision: current.revision,
        next: {
          ...redacted,
          revision: current.revision + 1,
          sequence: current.sequence + 1,
          updatedAt,
        },
      });
      return result.outcome;
    }
    const result = await this.compareAndSwap(current.revision, {
      ...redacted,
      revision: current.revision + 1,
      sequence: current.sequence + 1,
      updatedAt,
    });
    return result.outcome;
  }

  async compareAndSwapV2(input: {
    expectedRevision: number;
    next: CalendarOperationV2;
  }): Promise<{ outcome: 'confirmed'; operation: CalendarOperationV2 } | { outcome: 'conflict' | 'uncertain' }> {
    let value: CalendarOperationV2;
    try {
      value = operationRecordV2Schema.parse(input.next);
    } catch {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }

    const id = intentOperationKey(value.userId, value.sessionId, value.intentId);
    let raw: StoredDocument | null;
    try {
      raw = await this.store.raw('metadata', {
        _id: id,
        userId: value.userId,
        sessionId: value.sessionId,
        kind: 'calendar-operation',
      });
    } catch {
      return { outcome: 'uncertain' };
    }
    if (!raw) return { outcome: 'uncertain' };
    const current = decodeCalendar(operationRecordV2Schema, raw);
    if (current && isDeepStrictEqual(current, value)) {
      return { outcome: 'confirmed', operation: current };
    }
    if (!current) return { outcome: 'uncertain' };
    if (current.revision !== input.expectedRevision) {
      return { outcome: 'conflict' };
    }

    try {
      calendarOperationTransitionV2Schema.parse({ previous: current, next: value });
    } catch {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    this.assertTransitionV2(current, value, input.expectedRevision);

    const { record, doc } = encodeCalendar(
      operationRecordV2Schema,
      value,
      id,
      this.budgets.maxDocumentBytes,
    );
    doc._revision = raw._revision + 1;
    try {
      const result = await this.store.collection('metadata').replaceOne(
        {
          _id: id,
          userId: value.userId,
          sessionId: value.sessionId,
          kind: 'calendar-operation',
          schemaVersion: 2,
          revision: input.expectedRevision,
          _revision: raw._revision,
        },
        doc,
        this.store.options(),
      );
      if (result.matchedCount === 1) return { outcome: 'confirmed', operation: record };
    } catch {
      /* reread below */
    }

    let confirmRaw: StoredDocument | null;
    try {
      confirmRaw = await this.store.raw('metadata', { _id: id, userId: value.userId });
    } catch {
      return { outcome: 'uncertain' };
    }
    if (!confirmRaw) return { outcome: 'uncertain' };
    const saved = decodeCalendar(operationRecordV2Schema, confirmRaw);
    if (saved && isDeepStrictEqual(saved, record)) {
      return { outcome: 'confirmed', operation: saved };
    }
    return { outcome: 'conflict' };
  }

  async appendEvent(event: CalendarOperationEvent): Promise<void> {
    const value = operationEventSchema.parse(event);
    const operation = await this.getCompatibleByTurn(value.userId, value.sessionId, value.turnId);
    if (!operation || operation.operationId !== value.operationId) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (value.sequence !== operation.sequence || value.state !== operation.state) {
      const id = operationEventKey(value.userId, value.operationId, value.sequence);
      const existing = await this.store.raw('metadata', { _id: id, userId: value.userId });
      if (existing) {
        await this.store.insert(
          'metadata', operationEventSchema, value, id, this.budgets.maxDocumentBytes,
        );
        return;
      }
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    await this.store.insert(
      'metadata',
      operationEventSchema,
      value,
      operationEventKey(value.userId, value.operationId, value.sequence),
      this.budgets.maxDocumentBytes,
    );
  }

  async listEvents(input: {
    userId: string; operationId: string; cursor: string | null; limit: number;
  }): Promise<{ items: CalendarOperationEvent[]; nextCursor: string | null }> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > this.budgets.maxPageSize) {
      throw new AppError('INVALID_REQUEST', 'Invalid page size.');
    }
    const after = input.cursor
      ? decodeOperationEventCursor(input.cursor, input.userId, input.operationId)
      : null;
    const docs = await this.store.collection('metadata').find({
      kind: 'calendar-operation-event', userId: input.userId, operationId: input.operationId,
      ...(after ? { $or: [
        { sequence: { $gt: after.sequence } },
        { sequence: after.sequence, eventId: { $gt: after.eventId } },
      ] } : {}),
    }, this.store.options()).sort({ sequence: 1, eventId: 1 }).limit(input.limit + 1).toArray();
    const filtered = docs;
    const page = filtered.slice(0, input.limit).map((doc) => decodeCalendar(operationEventSchema, doc)!);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor: filtered.length > input.limit && last
        ? encodeOperationEventCursor(input.userId, input.operationId, last.sequence, last.eventId)
        : null,
    };
  }

  /**
   * Records one v2 operation transition event. The event must describe the
   * current state of the referenced v2 intent operation; anything else is
   * rejected instead of being stored.
   */
  async appendEventV2(event: CalendarOperationEventV2): Promise<{ outcome: 'confirmed' | 'uncertain' }> {
    const parsed = operationEventV2Schema.safeParse(event);
    if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    const value = parsed.data;

    const recorded = await this.readEventsV2({
      userId: value.userId, sessionId: value.sessionId, operationId: value.operationId,
    });
    const sameEvent = recorded.find((entry) => entry.eventId === value.eventId);
    if (sameEvent) {
      if (isDeepStrictEqual(sameEvent, value)) return { outcome: 'confirmed' };
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
    }
    if (recorded.some((entry) => entry.sequence === value.sequence)) {
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
    }

    const operation = await this.getByIntent(value.userId, value.sessionId, value.intentId);
    if (!operation || operation.operationId !== value.operationId
      || operation.revision !== value.revision || operation.sequence !== value.sequence
      || operation.state !== value.state) {
      throw new AppError('PERSISTENCE_ERROR', 'Calendar operation event does not match the current operation.');
    }

    const id = operationEventKeyV2(value.userId, value.sessionId, value.operationId, value.sequence);
    const { doc } = encodeCalendar(operationEventV2Schema, value, id, this.budgets.maxDocumentBytes);
    try {
      await this.store.collection('metadata').updateOne(
        { _id: id, userId: value.userId, sessionId: value.sessionId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      /* confirm below */
    }
    let saved: StoredDocument | null = null;
    try {
      saved = await this.store.raw('metadata', { _id: id, userId: value.userId, sessionId: value.sessionId });
    } catch {
      return { outcome: 'uncertain' };
    }
    if (!saved) return { outcome: 'uncertain' };
    const decoded = decodeCalendar(operationEventV2Schema, saved);
    if (decoded && isDeepStrictEqual(decoded, value)) return { outcome: 'confirmed' };
    throw new AppError('PERSISTENCE_ERROR', 'Calendar operation event could not be confirmed.');
  }

  async listEventsV2(input: {
    userId: string; sessionId: string; operationId: string;
  }): Promise<CalendarOperationEventV2[]> {
    if (!idSchema.safeParse(input.userId).success || !idSchema.safeParse(input.sessionId).success
      || !idSchema.safeParse(input.operationId).success) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence scope.');
    }
    return this.readEventsV2(input);
  }

  private async readEventsV2(input: {
    userId: string; sessionId: string; operationId: string;
  }): Promise<CalendarOperationEventV2[]> {
    const docs = await this.store.collection('metadata').find({
      kind: 'calendar-operation-event-v2',
      userId: input.userId,
      sessionId: input.sessionId,
      operationId: input.operationId,
    }, this.store.options()).sort({ sequence: 1 }).limit(this.budgets.maxPageSize + 1).toArray();
    if (docs.length > this.budgets.maxPageSize) {
      throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Calendar operation event history exceeds the storage budget.');
    }
    return docs.map((doc) => decodeCalendar(operationEventV2Schema, doc)!);
  }

  async putReconciliation(record: Omit<Reconciliation, 'consumedAt'> & { consumedAt?: null }): Promise<void> {
    const value = reconciliationSchema.parse({ ...record, consumedAt: record.consumedAt ?? null });
    const id = reconciliationKey(value.userId, value.operationId, value.eventId);
    await this.store.insert('metadata', reconciliationSchema, value, id, this.budgets.maxDocumentBytes);
  }

  async recordLegacyDisposition(record: CalendarLegacyDisposition): Promise<void> {
    const value = calendarLegacyDispositionSchema.parse(record);
    const id = legacyDispositionKey(value.userId, value.legacyKind, value.legacyRecordId);
    const existingRaw = await this.store.raw('metadata', { _id: id, userId: value.userId });
    if (existingRaw) {
      const saved = decodeCalendar(calendarLegacyDispositionSchema, existingRaw);
      if (saved && isDeepStrictEqual(saved, value)) return;
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The legacy disposition already exists with different data.');
    }
    const { doc } = encodeCalendar(calendarLegacyDispositionSchema, value, id, this.budgets.maxDocumentBytes);
    await this.store.collection('metadata').updateOne(
      { _id: id, userId: value.userId },
      { $setOnInsert: doc },
      { upsert: true, ...this.store.options() },
    );
  }

  private parseOperation(record: CalendarOperation): CalendarOperation {
    const parsed = operationRecordSchema.safeParse(record);
    if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    return parsed.data;
  }

  private authority(record: CalendarOperation) {
    return {
      userId: record.userId,
      sessionId: record.sessionId,
      turnId: record.turnId,
      operationId: record.operationId,
      googleEventId: record.googleEventId,
      requestHash: record.requestHash,
      connectionId: record.connectionId,
      connectionRevision: record.connectionRevision,
      googleSubjectId: record.googleSubjectId,
      calendarId: record.calendarId,
      targetRevision: record.targetRevision,
      schemaRevision: record.schemaRevision,
      authorization: record.authorization,
      createdAt: record.createdAt,
    };
  }

  private matchesV2Authority(stored: CalendarOperationV2, proposed: CalendarOperationV2): boolean {
    return (
      stored.userId === proposed.userId
      && stored.sessionId === proposed.sessionId
      && stored.intentId === proposed.intentId
      && stored.operationId === proposed.operationId
      && stored.googleEventId === proposed.googleEventId
      && stored.requestHash === proposed.requestHash
      && stored.connectionId === proposed.connectionId
      && stored.connectionRevision === proposed.connectionRevision
      && stored.googleSubjectId === proposed.googleSubjectId
      && stored.calendarId === proposed.calendarId
      && stored.targetRevision === proposed.targetRevision
      && stored.schemaRevision === proposed.schemaRevision
      && stored.proofRevision === proposed.proofRevision
      && stored.createdAt === proposed.createdAt
      && isDeepStrictEqual(stored.action, proposed.action)
      && stored.authorization.canonicalActionHash === proposed.authorization.canonicalActionHash
    );
  }

  private async assertTransition(
    current: CalendarOperation,
    next: CalendarOperation,
    expectedRevision: number,
  ): Promise<void> {
    if (this.isInvalidationRedaction(current, next)) {
      if (next.revision !== expectedRevision + 1 || next.sequence !== current.sequence + 1
        || Date.parse(next.updatedAt) < Date.parse(current.updatedAt)
        || next.deliveryRetries < current.deliveryRetries) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      return;
    }
    if (!isDeepStrictEqual(this.authority(current), this.authority(next))
      || next.originatingAttemptId !== current.originatingAttemptId
      || next.auditExpiresAt !== current.auditExpiresAt) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (next.revision !== expectedRevision + 1 || next.sequence !== current.sequence + 1) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt) || next.deliveryRetries < current.deliveryRetries) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (current.receipt && !isDeepStrictEqual(current.receipt, next.receipt)) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const retrySameDispatch = current.state === 'dispatching' && next.state === 'dispatching'
      && next.deliveryRetries === current.deliveryRetries + 1 && next.deliveryRetries <= 2
      && isDeepStrictEqual(current.action, next.action) && next.receipt === null;
    if (retrySameDispatch) return;
    const allowed = nextStates[current.state] as readonly string[];
    if (!allowed.includes(next.state)) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (current.state === 'unknown' && next.state === 'dispatching') {
      await this.consumeAbsentReadback(current, next);
    }
  }

  private assertTransitionV2(
    current: CalendarOperationV2,
    next: CalendarOperationV2,
    expectedRevision: number,
  ): void {
    if (this.isInvalidationRedaction(current, next)) {
      if (next.revision !== expectedRevision + 1 || next.sequence !== current.sequence + 1
        || Date.parse(next.updatedAt) < Date.parse(current.updatedAt)
        || next.deliveryRetries < current.deliveryRetries) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      return;
    }
    const nowMs = Date.parse(next.updatedAt);
    const expectedRedacted = redactCalendarOperation(current, nowMs);
    const isRedaction = !isDeepStrictEqual(expectedRedacted, current)
      && isDeepStrictEqual(
        { ...expectedRedacted, revision: next.revision, sequence: next.sequence, updatedAt: next.updatedAt },
        next,
      );

    if (isRedaction) {
      if (next.revision !== expectedRevision + 1 || next.sequence !== current.sequence + 1) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt) || next.deliveryRetries < current.deliveryRetries) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      return;
    }

    if (
      !this.matchesV2Authority(current, next)
      || next.originatingAttemptId !== current.originatingAttemptId
      || next.auditExpiresAt !== current.auditExpiresAt
      || next.turnId !== current.turnId
    ) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (next.revision !== expectedRevision + 1 || next.sequence !== current.sequence + 1) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt) || next.deliveryRetries < current.deliveryRetries) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (current.receipt && !isDeepStrictEqual(current.receipt, next.receipt)) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const allowed = v2AllowedEdges[current.state] ?? [];
    if (!allowed.includes(next.state)) {
      throw new AppError('INVALID_REQUEST', 'Invalid state transition.');
    }
  }

  private isInvalidationRedaction(
    current: CalendarOperation | CalendarOperationV2,
    next: CalendarOperation | CalendarOperationV2,
  ): boolean {
    const account = calendarAccountBindingSchema.parse({
      userId: current.userId,
      connectionId: current.connectionId,
      connectionRevision: current.connectionRevision,
      googleSubjectId: current.googleSubjectId,
    });
    const expected = redactCalendarOperationForAccount(current, account, Date.parse(next.updatedAt));
    return !isDeepStrictEqual(expected, current)
      && isDeepStrictEqual({ ...expected, revision: next.revision, sequence: next.sequence, updatedAt: next.updatedAt }, next);
  }

  private async consumeAbsentReadback(current: CalendarOperation, next: CalendarOperation): Promise<void> {
    if (next.action === null) throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    const observation = await this.store.collection('metadata').findOneAndUpdate({
      _id: reconciliationKey(current.userId, current.operationId, current.googleEventId),
      kind: 'calendar-operation-reconciliation',
      userId: current.userId,
      operationId: current.operationId,
      operationRevision: current.revision,
      outcome: 'absent',
      connectionRevision: current.connectionRevision,
      targetRevision: current.targetRevision,
      consumedAt: null,
    }, {
      $set: { consumedAt: next.updatedAt },
      $inc: { _revision: 1 },
    }, { ...this.store.options(), returnDocument: 'before', includeResultMetadata: false });
    if (!observation) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
  }
}
