/**
 * ============================================================================
 * FILE: calendar-proposals.ts
 * LOCATION: backend/src/persistence/calendar-proposals.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Persistence adapter for Google Calendar Phase 2 proposals and consumption authority.
 *
 * ROLE IN PROJECT:
 *    Implements CalendarProposalStore to manage bounded session proposals,
 *    atomic supersession, single-consumption CAS, and replay-safe tombstones.
 *
 * KEY COMPONENTS:
 *    - MongoCalendarProposals: Concrete implementation of CalendarProposalStore.
 *    - getCurrent: Query single pending proposal within session expired against clock.
 *    - getCurrentSlot: Query the session pending slot including expired proposals.
 *    - getAuthority: Scoped proposal authority lookup (pending/consumed/tombstone/absent).
 *    - putCurrent: Validates authority binding and replaces pending proposal.
 *    - consume: Single-consumption CAS locking intent reservation and reply wrapper.
 *    - bindReplyReference / getReplyReference: Durable untrusted reply-reference binding.
 *    - tombstone: Deterministic lifecycle state tombstone replacement.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { BudgetConfig } from '../contracts/budgets.js';
import {
  calendarProposalConsumptionSchema,
  calendarProposalReplySchema,
  calendarProposalSchema,
  calendarProposalTombstoneSchema,
  proposalMatchesReply,
  type CalendarProposalAuthorityLookup,
  type CalendarProposalConsumeResult,
  type CalendarProposalRecord,
  type CalendarProposalReply,
  type CalendarProposalStore,
  type CalendarProposalTombstone,
  type CalendarReplyReference,
} from '../contracts/calendar-authority.js';
import {
  compatibleCalendarConnectionSchema,
} from '../contracts/calendar-compatibility.js';
import { calendarGrantStatus } from '../contracts/calendar-policy.js';
import { AppError } from '../platform/errors/app-error.js';
import {
  calendarIntentReservationSchema,
  calendarReplyBindingKey,
  calendarReplyBindingSchema,
  connectionKey,
  decodeCalendar,
  encodeCalendar,
  intentReservationKey,
  proposalConsumptionKey,
  proposalConsumptionRecordSchema,
  proposalKey,
  readCurrentCalendarAccountBinding,
  sameCalendarAccountBinding,
  type CalendarReplyBinding,
  type StoredDocument,
} from './calendar-records.js';
import { RecordStore } from './store.js';

export class MongoCalendarProposals implements CalendarProposalStore {
  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
    readonly clock: () => number = Date.now,
  ) {}

  async getCurrent(userId: string, sessionId: string): Promise<CalendarProposalRecord | null> {
    const decoded = await this.getCurrentSlot(userId, sessionId);
    if (!decoded) return null;

    const nowMs = this.clock();
    if (nowMs >= Date.parse(decoded.expiresAt) || nowMs >= Date.parse(decoded.contentExpiresAt)) {
      return null;
    }
    return decoded;
  }

  async getCurrentSlot(userId: string, sessionId: string): Promise<CalendarProposalRecord | null> {
    const rows = await this.store.collection('metadata').find({
      kind: 'calendar-proposal',
      userId,
      sessionId,
      state: 'pending',
    }).limit(2).toArray();

    if (rows.length > 1) {
      throw new AppError('PERSISTENCE_ERROR', 'Multiple pending proposals detected in session.');
    }
    if (rows.length === 0) return null;
    const proposal = decodeCalendar(calendarProposalSchema, rows[0]);
    if (!proposal || !await this.accountIsCurrent(proposal)) return null;
    return proposal;
  }

  async getAuthority(
    userId: string,
    sessionId: string,
    proposalId: string,
  ): Promise<CalendarProposalAuthorityLookup> {
    const raw = await this.store.raw('metadata', {
      _id: proposalKey(userId, sessionId, proposalId),
      userId,
    });

    if (raw?.kind === 'calendar-proposal-tombstone') {
      const tombstone = decodeCalendar(calendarProposalTombstoneSchema, raw);
      return tombstone ? { state: 'tombstone', tombstone } : { state: 'absent' };
    }

    const proposal = raw ? decodeCalendar(calendarProposalSchema, raw) : null;
    if (proposal && !await this.accountIsCurrent(proposal)) return { state: 'absent' };
    if (proposal?.state === 'pending') {
      return { state: 'pending', proposal };
    }

    const wrapper = await this.readConsumptionWrapper(userId, sessionId, proposalId);
    if (wrapper && !await this.accountIsCurrent(wrapper.reply)) return { state: 'absent' };

    if (proposal?.state === 'consumed' && proposal.consumedBy) {
      const reply = wrapper?.reply ?? (raw?._calendarApproval as CalendarProposalReply | undefined);
      if (!reply) {
        throw new AppError('PERSISTENCE_ERROR', 'Proposal authority is unavailable.');
      }
      return {
        state: 'consumed',
        proposal,
        reply,
        consumption: proposal.consumedBy,
        authorityExpiresAt: proposal.expiresAt,
      };
    }

    if (wrapper) {
      return {
        state: 'consumed',
        proposal: null,
        reply: wrapper.reply,
        consumption: wrapper.consumption,
        authorityExpiresAt: wrapper.authorityExpiresAt,
      };
    }

    return { state: 'absent' };
  }

  private async accountIsCurrent(account: {
    userId: string; connectionId: string; connectionRevision: number; googleSubjectId: string;
  }): Promise<boolean> {
    return sameCalendarAccountBinding(
      await readCurrentCalendarAccountBinding(this.store, account.userId), account,
    );
  }

  private async readConsumptionWrapper(userId: string, sessionId: string, proposalId: string) {
    const raw = await this.store.raw('metadata', {
      _id: proposalConsumptionKey(userId, sessionId, proposalId),
      userId,
    });
    if (!raw) return null;
    return decodeCalendar(proposalConsumptionRecordSchema, raw);
  }

  async putCurrent(input: {
    expectedProposalId: string | null;
    expectedRevision: number | null;
    proposal: CalendarProposalRecord;
  }): Promise<{ outcome: 'confirmed'; proposal: CalendarProposalRecord } | { outcome: 'conflict' | 'uncertain' }> {
    if ((input.expectedProposalId === null) !== (input.expectedRevision === null)) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }

    let p: CalendarProposalRecord;
    try {
      p = calendarProposalSchema.parse(input.proposal);
    } catch {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (p.revision !== 1 || p.state !== 'pending' || p.consumedBy !== null) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const nowMs = this.clock();
    const createdAtMs = Date.parse(p.createdAt);
    const expiresAtMs = Date.parse(p.expiresAt);
    if (createdAtMs > nowMs || nowMs >= expiresAtMs) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }

    const rawConn = await this.store.raw('integration_connections', {
      _id: connectionKey(p.userId),
      userId: p.userId,
      provider: 'google-calendar',
    });
    if (!rawConn) throw new AppError('INVALID_REQUEST', 'No connection found.');
    const conn = decodeCalendar(compatibleCalendarConnectionSchema, rawConn);
    if (!conn || conn.schemaVersion !== 2) {
      throw new AppError('INVALID_REQUEST', 'Invalid connection schema.');
    }
    if (
      !conn.enabled
      || conn.status !== 'connected'
      || conn.connectionId !== p.connectionId
      || conn.connectionRevision !== p.connectionRevision
      || conn.googleSubjectId !== p.googleSubjectId
      || calendarGrantStatus(conn.grantedScopes).state !== 'complete'
    ) {
      throw new AppError('INVALID_REQUEST', 'Connection authority mismatch or not ready.');
    }
    if (
      !conn.discovery
      || conn.discovery.discoveryRevision !== p.discoveryRevision
      || Date.parse(p.contentExpiresAt) > Date.parse(conn.discovery.retentionExpiresAt)
    ) {
      throw new AppError('INVALID_REQUEST', 'Discovery revision mismatch or content expiration exceeds retention.');
    }

    const id = proposalKey(p.userId, p.sessionId, p.proposalId);
    const existingRaw = await this.store.raw('metadata', { _id: id, userId: p.userId });
    if (existingRaw) {
      if (existingRaw.kind === 'calendar-proposal-tombstone') {
        return { outcome: 'conflict' };
      }
      const existingProposal = decodeCalendar(calendarProposalSchema, existingRaw);
      if (!existingProposal) return { outcome: 'conflict' };
      if (existingProposal.state === 'pending' && isDeepStrictEqual(existingProposal, p)) {
        return { outcome: 'confirmed', proposal: existingProposal };
      }
      return { outcome: 'conflict' };
    }

    const current = await this.getCurrent(p.userId, p.sessionId);
    if (input.expectedProposalId === null) {
      if (current !== null) {
        return { outcome: 'conflict' };
      }
    } else {
      if (
        current === null
        || current.proposalId !== input.expectedProposalId
        || current.revision !== input.expectedRevision
      ) {
        return { outcome: 'conflict' };
      }

      const oldId = proposalKey(p.userId, p.sessionId, current.proposalId);
      const oldRaw = await this.store.raw('metadata', { _id: oldId, userId: p.userId });
      if (!oldRaw || oldRaw._revision === undefined) return { outcome: 'uncertain' };
      const supersededProposal = {
        ...current,
        revision: current.revision + 1,
        state: 'superseded' as const,
      };
      const { doc: supersededDoc } = encodeCalendar(
        calendarProposalSchema,
        supersededProposal,
        oldId,
        Math.min(this.budgets.maxDocumentBytes, 16384 + 1024),
      );
      supersededDoc._revision = oldRaw._revision + 1;
      try {
        const res = await this.store.collection('metadata').replaceOne(
          {
            _id: oldId,
            userId: p.userId,
            kind: 'calendar-proposal',
            state: 'pending',
            revision: current.revision,
            _revision: oldRaw._revision,
          },
          supersededDoc,
          this.store.options(),
        );
        if (res.matchedCount !== 1) {
          const checkRaw = await this.store.raw('metadata', { _id: oldId, userId: p.userId });
          if (checkRaw && checkRaw.state === 'consumed') {
            return { outcome: 'conflict' };
          }
          return { outcome: 'conflict' };
        }
      } catch {
        const checkRaw = await this.store.raw('metadata', { _id: oldId, userId: p.userId });
        if (!checkRaw) return { outcome: 'uncertain' };
        if (checkRaw.state !== 'superseded') {
          return { outcome: 'conflict' };
        }
      }
    }

    const { record, doc } = encodeCalendar(
      calendarProposalSchema,
      p,
      id,
      Math.min(this.budgets.maxDocumentBytes, 16384 + 1024),
    );
    try {
      await this.store.collection('metadata').updateOne(
        { _id: id, userId: p.userId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      const saved = await this.store.raw('metadata', { _id: id, userId: p.userId });
      return this.confirmWrittenProposal(record, saved);
    }

    const confirmed = await this.store.raw('metadata', { _id: id, userId: p.userId });
    return this.confirmWrittenProposal(record, confirmed);
  }

  private async confirmWrittenProposal(
    expected: CalendarProposalRecord,
    raw: StoredDocument | null,
  ): Promise<{ outcome: 'confirmed'; proposal: CalendarProposalRecord } | { outcome: 'conflict' | 'uncertain' }> {
    if (!raw) return { outcome: 'uncertain' };
    const proposal = decodeCalendar(calendarProposalSchema, raw);
    if (!proposal || !isDeepStrictEqual(proposal, expected)) return { outcome: 'conflict' };
    if (!await this.accountIsCurrent(proposal)) {
      const tombstoneOutcome = await this.tombstone({
        expectedRevision: proposal.revision,
        tombstone: {
          schemaVersion: 2, kind: 'calendar-proposal-tombstone', userId: proposal.userId,
          sessionId: proposal.sessionId, proposalId: proposal.proposalId,
          intentId: proposal.intentId, revision: proposal.revision + 1,
          reason: 'disconnected', operationId: null, canonicalActionHash: null,
          at: new Date(this.clock()).toISOString(), unresolvedOperation: false,
        },
      });
      if (tombstoneOutcome !== 'confirmed') {
        throw new AppError('PERSISTENCE_ERROR', 'Stale Calendar proposal could not be tombstoned.', false);
      }
      return { outcome: 'conflict' };
    }
    return { outcome: 'confirmed', proposal };
  }

  /**
   * Durably bind the causal reply reference that was accepted with one turn attempt.
   *
   * The reference is untrusted: it names the proposal revision the client believed it
   * was answering. It never approves anything and never authorises a Calendar action.
   * The binding is keyed by attempt, so a retry of the same turn gets its own binding.
   */
  async bindReplyReference(input: {
    userId: string;
    sessionId: string;
    turnId: string;
    attemptId: string;
    replyTo: CalendarReplyReference;
    boundAt?: string;
  }): Promise<'confirmed' | 'conflict' | 'uncertain'> {
    let record: CalendarReplyBinding;
    try {
      record = calendarReplyBindingSchema.parse({
        schemaVersion: 2,
        kind: 'calendar-reply-binding',
        userId: input.userId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        attemptId: input.attemptId,
        replyTo: input.replyTo,
        boundAt: input.boundAt ?? new Date(this.clock()).toISOString(),
      });
    } catch {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const id = calendarReplyBindingKey(record.userId, record.sessionId, record.attemptId);
    const { doc } = encodeCalendar(
      calendarReplyBindingSchema,
      record,
      id,
      Math.min(this.budgets.maxDocumentBytes, 16384 + 1024),
    );
    try {
      await this.store.collection('metadata').updateOne(
        { _id: id, userId: record.userId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      /* The write might already be durable; confirm by reread. */
    }
    const saved = await this.store.raw('metadata', { _id: id, userId: record.userId });
    if (!saved) return 'uncertain';
    const binding = decodeCalendar(calendarReplyBindingSchema, saved);
    if (!binding) return 'conflict';
    return isDeepStrictEqual(binding, record) ? 'confirmed' : 'conflict';
  }

  /** Read the reply reference that was durably bound to one accepted attempt. */
  async getReplyReference(
    userId: string,
    sessionId: string,
    attemptId: string,
  ): Promise<CalendarReplyReference | null> {
    const raw = await this.store.raw('metadata', {
      _id: calendarReplyBindingKey(userId, sessionId, attemptId),
      userId,
    });
    if (!raw) return null;
    const binding = decodeCalendar(calendarReplyBindingSchema, raw);
    return binding ? binding.replyTo : null;
  }

  async consume(input: {
    reply: CalendarProposalReply;
    operationId: string;
    intentId: string;
  }): Promise<CalendarProposalConsumeResult> {
    let r: CalendarProposalReply;
    try {
      r = calendarProposalReplySchema.parse(input.reply);
    } catch {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }

    const rawConn = await this.store.raw('integration_connections', {
      _id: connectionKey(r.userId),
      userId: r.userId,
      provider: 'google-calendar',
    });
    if (!rawConn) {
      return { outcome: 'rejected', reason: 'stale' };
    }
    const conn = decodeCalendar(compatibleCalendarConnectionSchema, rawConn);
    if (!conn || conn.schemaVersion !== 2) {
      return { outcome: 'rejected', reason: 'stale' };
    }
    if (
      !conn.enabled
      || conn.status !== 'connected'
      || conn.connectionId !== r.connectionId
      || conn.connectionRevision !== r.connectionRevision
      || conn.googleSubjectId !== r.googleSubjectId
      || calendarGrantStatus(conn.grantedScopes).state !== 'complete'
    ) {
      return { outcome: 'rejected', reason: 'stale' };
    }

    const propId = proposalKey(r.userId, r.sessionId, r.proposalId);
    const rawProp = await this.store.raw('metadata', {
      _id: propId,
      userId: r.userId,
    });
    if (!rawProp || rawProp.kind === 'calendar-proposal-tombstone') {
      if (rawProp && rawProp.kind === 'calendar-proposal-tombstone' && rawProp.reason === 'consumed') {
        const wrapperId = proposalConsumptionKey(r.userId, r.sessionId, r.proposalId);
        const rawWrapper = await this.store.raw('metadata', { _id: wrapperId, userId: r.userId });
        if (rawWrapper) {
          const wrapper = decodeCalendar(proposalConsumptionRecordSchema, rawWrapper);
          if (wrapper) {
            if (r.sessionId !== wrapper.sessionId) {
              return { outcome: 'rejected', reason: 'wrong-session' };
            }
            if (r.canonicalActionHash !== wrapper.consumption.canonicalActionHash) {
              return { outcome: 'rejected', reason: 'changed-action' };
            }
            if (r.conditionFingerprint !== wrapper.reply.conditionFingerprint) {
              return { outcome: 'rejected', reason: 'changed-condition' };
            }
            if (
              r.connectionId !== wrapper.reply.connectionId
              || r.connectionRevision !== wrapper.reply.connectionRevision
              || r.googleSubjectId !== wrapper.reply.googleSubjectId
              || wrapper.consumption.intentId !== input.intentId
            ) {
              return { outcome: 'rejected', reason: 'stale' };
            }
            return { outcome: 'existing', consumption: wrapper.consumption };
          }
        }
      }
      const anySession = await this.store.collection('metadata').findOne({
        kind: 'calendar-proposal',
        userId: r.userId,
        proposalId: r.proposalId,
      });
      if (anySession && anySession.sessionId !== r.sessionId) {
        return { outcome: 'rejected', reason: 'wrong-session' };
      }
      if (rawProp && rawProp.kind === 'calendar-proposal-tombstone') {
        if (rawProp.reason === 'expired') return { outcome: 'rejected', reason: 'expired' };
        if (rawProp.reason === 'cancelled') return { outcome: 'rejected', reason: 'cancelled' };
      }
      return { outcome: 'rejected', reason: 'stale' };
    }

    if (rawProp.state === 'consumed') {
      const p = decodeCalendar(calendarProposalSchema, rawProp);
      if (!p || !p.consumedBy) return { outcome: 'uncertain' };
      if (r.sessionId !== p.sessionId) {
        return { outcome: 'rejected', reason: 'wrong-session' };
      }
      if (r.canonicalActionHash !== p.consumedBy.canonicalActionHash) {
        return { outcome: 'rejected', reason: 'changed-action' };
      }
      if (r.conditionFingerprint !== p.conditionFingerprint) {
        return { outcome: 'rejected', reason: 'changed-condition' };
      }
      if (
        r.connectionId !== p.connectionId
        || r.connectionRevision !== p.connectionRevision
        || r.googleSubjectId !== p.googleSubjectId
        || p.consumedBy.intentId !== input.intentId
      ) {
        return { outcome: 'rejected', reason: 'stale' };
      }

      const wrapperId = proposalConsumptionKey(r.userId, r.sessionId, r.proposalId);
      const rawWrapper = await this.store.raw('metadata', { _id: wrapperId, userId: r.userId });
      if (!rawWrapper) {
        const approval = rawProp._calendarApproval as CalendarProposalReply | undefined;
        if (approval) {
          const wrapperRecord = proposalConsumptionRecordSchema.parse({
            schemaVersion: 2,
            kind: 'calendar-proposal-consumption',
            userId: p.userId,
            sessionId: p.sessionId,
            proposalId: p.proposalId,
            intentId: p.intentId,
            authorityExpiresAt: p.expiresAt,
            reply: approval,
            consumption: p.consumedBy,
          });
          const { doc: wrapperDoc } = encodeCalendar(
            proposalConsumptionRecordSchema,
            wrapperRecord,
            wrapperId,
            this.budgets.maxDocumentBytes,
          );
          try {
            await this.store.collection('metadata').updateOne(
              { _id: wrapperId, userId: p.userId },
              { $setOnInsert: wrapperDoc },
              { upsert: true, ...this.store.options() },
            );
          } catch {
            /* best effort confirm */
          }
        }
      }
      return { outcome: 'existing', consumption: p.consumedBy };
    }

    if (rawProp.state === 'cancelled') {
      return { outcome: 'rejected', reason: 'cancelled' };
    }
    if (rawProp.state === 'expired') {
      return { outcome: 'rejected', reason: 'expired' };
    }
    if (rawProp.state !== 'pending') {
      return { outcome: 'rejected', reason: 'stale' };
    }

    const p = decodeCalendar(calendarProposalSchema, rawProp);
    if (!p) return { outcome: 'rejected', reason: 'stale' };

    if (r.sessionId !== p.sessionId) {
      return { outcome: 'rejected', reason: 'wrong-session' };
    }

    const nowMs = this.clock();
    if (nowMs >= Date.parse(p.expiresAt) || nowMs >= Date.parse(p.contentExpiresAt)) {
      return { outcome: 'rejected', reason: 'expired' };
    }
    if (Date.parse(r.receivedAt) > nowMs) {
      return { outcome: 'rejected', reason: 'stale' };
    }
    if (Date.parse(r.receivedAt) >= Date.parse(p.expiresAt)) {
      return { outcome: 'rejected', reason: 'expired' };
    }

    if (r.decision === 'cancel') {
      const cancelledProp = {
        ...p,
        revision: p.revision + 1,
        state: 'cancelled' as const,
      };
      const { doc: cancelledDoc } = encodeCalendar(
        calendarProposalSchema,
        cancelledProp,
        propId,
        Math.min(this.budgets.maxDocumentBytes, 16384 + 1024),
      );
      cancelledDoc._revision = rawProp._revision + 1;
      try {
        await this.store.collection('metadata').replaceOne(
          {
            _id: propId,
            userId: p.userId,
            kind: 'calendar-proposal',
            state: 'pending',
            revision: p.revision,
            _revision: rawProp._revision,
          },
          cancelledDoc,
          this.store.options(),
        );
      } catch {
        /* best effort cancel */
      }
      return { outcome: 'rejected', reason: 'cancelled' };
    }

    if (input.intentId !== p.intentId) {
      return { outcome: 'rejected', reason: 'stale' };
    }

    // An incomplete-details proposal carries no canonical action yet, so it cannot be
    // consumed until a complete action/target proposal has replaced it.
    if (p.incomplete !== undefined) {
      return { outcome: 'rejected', reason: 'incomplete' };
    }

    if (!proposalMatchesReply(p, r)) {
      if (p.purpose === 'selection') {
        const matchesCandidate = p.candidates.some(
          (c) => c.target.calendarId === r.choiceCalendarId,
        );
        if (matchesCandidate && !p.candidates.some((c) => c.target.calendarId === r.choiceCalendarId && c.canonicalActionHash === r.canonicalActionHash)) {
          return { outcome: 'rejected', reason: 'changed-action' };
        }
      } else if (p.canonicalActionHash !== r.canonicalActionHash) {
        return { outcome: 'rejected', reason: 'changed-action' };
      }
      if (p.conditionFingerprint !== r.conditionFingerprint) {
        return { outcome: 'rejected', reason: 'changed-condition' };
      }
      return { outcome: 'rejected', reason: 'stale' };
    }

    const targetCalendarId = p.purpose === 'selection' ? r.choiceCalendarId! : p.target!.calendarId;
    const resId = intentReservationKey(p.userId, p.sessionId, p.intentId);
    const proposedReservation = calendarIntentReservationSchema.parse({
      schemaVersion: 2,
      kind: 'calendar-intent-reservation',
      userId: p.userId,
      sessionId: p.sessionId,
      connectionId: p.connectionId,
      connectionRevision: p.connectionRevision,
      googleSubjectId: p.googleSubjectId,
      intentId: p.intentId,
      operationId: input.operationId,
      canonicalActionHash: r.canonicalActionHash,
      calendarId: targetCalendarId,
    });
    const { doc: resDoc } = encodeCalendar(
      calendarIntentReservationSchema,
      proposedReservation,
      resId,
      this.budgets.maxDocumentBytes,
    );
    try {
      await this.store.collection('metadata').updateOne(
        { _id: resId, userId: p.userId },
        { $setOnInsert: resDoc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      /* confirm below */
    }
    const savedResRaw = await this.store.raw('metadata', { _id: resId, userId: p.userId });
    if (!savedResRaw) return { outcome: 'uncertain' };
    const savedRes = decodeCalendar(calendarIntentReservationSchema, savedResRaw);
    if (!savedRes) return { outcome: 'uncertain' };
    if (
      savedRes.userId !== p.userId
      || savedRes.connectionId !== p.connectionId
      || savedRes.googleSubjectId !== p.googleSubjectId
      || savedRes.canonicalActionHash !== r.canonicalActionHash
      || savedRes.calendarId !== targetCalendarId
    ) {
      throw new AppError('INVALID_REQUEST', 'Intent reservation mismatch.');
    }
    const effectiveOperationId = savedRes.operationId;

    const consumption = calendarProposalConsumptionSchema.parse({
      userId: p.userId,
      sessionId: p.sessionId,
      proposalId: p.proposalId,
      intentId: p.intentId,
      operationId: effectiveOperationId,
      acceptedMessageId: r.acceptedMessageId,
      acceptedTurnId: r.acceptedTurnId,
      canonicalActionHash: r.canonicalActionHash,
      calendarId: targetCalendarId,
      consumedAt: r.receivedAt,
    });

    const next = calendarProposalSchema.parse({
      ...p,
      revision: p.revision + 1,
      state: 'consumed',
      consumedBy: consumption,
    });

    const { doc: nextDoc } = encodeCalendar(
      calendarProposalSchema,
      next,
      propId,
      Math.min(this.budgets.maxDocumentBytes, 16384 + 1024),
      { _calendarApproval: r },
    );
    nextDoc._revision = rawProp._revision + 1;

    try {
      const casResult = await this.store.collection('metadata').replaceOne(
        {
          _id: propId,
          userId: p.userId,
          kind: 'calendar-proposal',
          state: 'pending',
          revision: p.revision,
          _revision: rawProp._revision,
        },
        nextDoc,
        this.store.options(),
      );
      if (casResult.matchedCount !== 1) {
        const rereadRaw = await this.store.raw('metadata', { _id: propId, userId: p.userId });
        if (!rereadRaw) return { outcome: 'uncertain' };
        const rereadProp = decodeCalendar(calendarProposalSchema, rereadRaw);
        if (rereadProp && rereadProp.state === 'consumed' && rereadProp.consumedBy) {
          if (
            rereadProp.consumedBy.canonicalActionHash === r.canonicalActionHash
            && rereadProp.consumedBy.acceptedMessageId === r.acceptedMessageId
          ) {
            return { outcome: 'existing', consumption: rereadProp.consumedBy };
          }
        }
        return { outcome: 'rejected', reason: 'stale' };
      }
    } catch {
      const rereadRaw = await this.store.raw('metadata', { _id: propId, userId: p.userId });
      if (!rereadRaw) return { outcome: 'uncertain' };
      const rereadProp = decodeCalendar(calendarProposalSchema, rereadRaw);
      if (!rereadProp) return { outcome: 'uncertain' };
      if (rereadProp.state === 'consumed' && rereadProp.consumedBy) {
        if (rereadProp.consumedBy.operationId !== effectiveOperationId) {
          return { outcome: 'existing', consumption: rereadProp.consumedBy };
        }
      } else {
        return { outcome: 'uncertain' };
      }
    }

    const wrapperId = proposalConsumptionKey(p.userId, p.sessionId, p.proposalId);
    const wrapperRecord = proposalConsumptionRecordSchema.parse({
      schemaVersion: 2,
      kind: 'calendar-proposal-consumption',
      userId: p.userId,
      sessionId: p.sessionId,
      proposalId: p.proposalId,
      intentId: p.intentId,
      authorityExpiresAt: p.expiresAt,
      reply: r,
      consumption,
    });
    const { doc: wrapperDoc } = encodeCalendar(
      proposalConsumptionRecordSchema,
      wrapperRecord,
      wrapperId,
      this.budgets.maxDocumentBytes,
    );
    try {
      await this.store.collection('metadata').updateOne(
        { _id: wrapperId, userId: p.userId },
        { $setOnInsert: wrapperDoc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      /* confirm below */
    }
    const confirmedWrapper = await this.store.raw('metadata', { _id: wrapperId, userId: p.userId });
    if (!confirmedWrapper) return { outcome: 'uncertain' };
    return { outcome: 'consumed', consumption };
  }

  async tombstone(input: {
    expectedRevision: number;
    tombstone: CalendarProposalTombstone;
  }): Promise<'confirmed' | 'conflict' | 'uncertain'> {
    let t: CalendarProposalTombstone;
    try {
      t = calendarProposalTombstoneSchema.parse(input.tombstone);
    } catch {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (t.revision !== input.expectedRevision + 1) {
      return 'conflict';
    }

    const id = proposalKey(t.userId, t.sessionId, t.proposalId);
    let raw: StoredDocument | null;
    try {
      raw = await this.store.raw('metadata', { _id: id, userId: t.userId });
    } catch {
      return 'uncertain';
    }
    if (!raw) return 'conflict';

    if (raw.kind === 'calendar-proposal-tombstone') {
      const existing = decodeCalendar(calendarProposalTombstoneSchema, raw);
      if (existing && isDeepStrictEqual(existing, t)) return 'confirmed';
      return 'conflict';
    }

    const current = decodeCalendar(calendarProposalSchema, raw);
    if (!current) return 'conflict';
    if (current.revision !== input.expectedRevision || t.revision !== current.revision + 1) {
      return 'conflict';
    }
    if (
      current.userId !== t.userId
      || current.sessionId !== t.sessionId
      || current.proposalId !== t.proposalId
      || current.intentId !== t.intentId
    ) {
      throw new AppError('INVALID_REQUEST', 'Tombstone identity mismatch.');
    }
    if (current.state === 'pending' && t.reason === 'consumed') {
      throw new AppError('INVALID_REQUEST', 'Pending proposal cannot tombstone as consumed.');
    }
    if (current.state === 'consumed') {
      if (!current.consumedBy) throw new AppError('INVALID_REQUEST', 'Missing consumedBy.');
      const wrapperId = proposalConsumptionKey(current.userId, current.sessionId, current.proposalId);
      const wrapperRaw = await this.store.raw('metadata', { _id: wrapperId, userId: current.userId });
      if (!wrapperRaw) {
        const approval = raw._calendarApproval as CalendarProposalReply | undefined;
        if (approval) {
          const wrapperRecord = proposalConsumptionRecordSchema.parse({
            schemaVersion: 2,
            kind: 'calendar-proposal-consumption',
            userId: current.userId,
            sessionId: current.sessionId,
            proposalId: current.proposalId,
            intentId: current.intentId,
            authorityExpiresAt: current.expiresAt,
            reply: approval,
            consumption: current.consumedBy,
          });
          const { doc: wrapperDoc } = encodeCalendar(
            proposalConsumptionRecordSchema,
            wrapperRecord,
            wrapperId,
            this.budgets.maxDocumentBytes,
          );
          await this.store.collection('metadata').updateOne(
            { _id: wrapperId, userId: current.userId },
            { $setOnInsert: wrapperDoc },
            { upsert: true, ...this.store.options() },
          );
        }
      }
      if (
        t.operationId !== current.consumedBy.operationId
        || t.canonicalActionHash !== current.consumedBy.canonicalActionHash
      ) {
        throw new AppError('INVALID_REQUEST', 'Tombstone operation or action hash mismatch.');
      }
    }
    if (t.unresolvedOperation && !t.operationId) {
      throw new AppError('INVALID_REQUEST', 'Unresolved operation tombstone requires operation ID.');
    }

    const { record, doc } = encodeCalendar(
      calendarProposalTombstoneSchema,
      t,
      id,
      Math.min(this.budgets.maxDocumentBytes, 16384 + 1024),
    );
    doc._revision = raw._revision + 1;
    try {
      const res = await this.store.collection('metadata').replaceOne(
        {
          _id: id,
          userId: t.userId,
          revision: input.expectedRevision,
          _revision: raw._revision,
        },
        doc,
        this.store.options(),
      );
      if (res.matchedCount === 1) return 'confirmed';
    } catch {
      /* confirm below */
    }

    let confirmRaw: StoredDocument | null;
    try {
      confirmRaw = await this.store.raw('metadata', { _id: id, userId: t.userId });
    } catch {
      return 'uncertain';
    }
    if (!confirmRaw) return 'uncertain';
    const decoded = decodeCalendar(calendarProposalTombstoneSchema, confirmRaw);
    if (decoded && isDeepStrictEqual(decoded, record)) return 'confirmed';
    return 'conflict';
  }
}
