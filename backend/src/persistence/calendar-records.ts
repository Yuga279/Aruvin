/**
 * ============================================================================
 * FILE: calendar-records.ts
 * LOCATION: backend/src/persistence/calendar-records.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Encoding, decoding, and deterministic keys for calendar persistence documents.
 *
 * ROLE IN PROJECT:
 *    Ensures boundary validation, version-safe BSON conversion, and key derivation
 *    for v1 and v2 calendar connections, operations, proposals, and evidence.
 *
 * KEY COMPONENTS:
 *    - proposalKey, intentOperationKey, proposalConsumptionKey: Deterministic identity keys.
 *    - encodeCalendar, decodeCalendar: Safe BSON transformation with Decimal128 handling.
 *    - redactCalendarDecision, redactCalendarResult: Retention redaction utilities.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { Document } from 'mongodb';
import { z } from 'zod';
import { decimalSchema } from '../contracts/usage-evidence.js';
import { idSchema, isoDateSchema } from '../contracts/identifiers.js';
import { sha256Schema } from '../contracts/calendar-connections.js';
import {
  resumableDecisionSchema,
  resumableDecisionV2Schema,
  resumableSkillDecisionSchema,
  type ResumableCalendarDecision,
  type ResumableCalendarDecisionV2,
  type ResumableSkillDecision,
} from '../contracts/calendar-model.js';
import { messageRecordSchema, type MessageRecord } from '../contracts/message.js';
import {
  calendarToolResultRecordSchema,
  calendarToolResultRecordV2Schema,
  type CalendarSourceReference,
  type CalendarSourceReferenceV2,
  type CalendarToolResultRecord,
  type CalendarToolResultRecordV2,
} from '../contracts/calendar-sources.js';
import {
  calendarProposalConsumptionSchema,
  calendarProposalReplySchema,
  calendarReplyReferenceSchema,
  type CalendarProposalReply,
} from '../contracts/calendar-authority.js';
import {
  calendarAccountBindingSchema,
  calendarCanonicalIdSchema,
} from '../contracts/calendar-discovery.js';
import type { CalendarAccountBinding } from '../contracts/calendar-discovery.js';
import { compatibleCalendarConnectionSchema } from '../contracts/calendar-compatibility.js';
import {
  operationRecordSchema,
  operationRecordV2Schema,
  calendarReceiptSchema,
  calendarReceiptV2Schema,
  type CalendarOperation,
  type CalendarOperationV2,
} from '../contracts/calendar-operations.js';
import { AppError } from '../platform/errors/app-error.js';
import { decodeAccountingMoney, encodeAccountingMoney } from './accounting-codec.js';
import { assertBytes, key, type StoredDocument } from './records.js';
import type { RecordStore } from './store.js';

export { type StoredDocument };

export const connectionKey = (userId: string) => key('calendar-connection', userId, 'google-calendar');
export const oauthKey = (stateHash: string) => key('calendar-oauth-state', stateHash);
export const operationKey = (userId: string, sessionId: string, turnId: string) =>
  key('calendar-operation', userId, sessionId, turnId);
export const budgetKey = (userId: string, sessionId: string, turnId: string) =>
  key('calendar-turn-budget', userId, sessionId, turnId);
export const operationEventKey = (userId: string, operationId: string, sequence: number) =>
  key('calendar-operation-event', userId, operationId, sequence);
export const reconciliationKey = (userId: string, operationId: string, eventId: string) =>
  key('calendar-operation-reconciliation', userId, operationId, eventId);
export const decisionKey = (kind: 'calendar-model-decision' | 'calendar-rejected-decision', userId: string, decisionId: string) =>
  key(kind, userId, decisionId);
export const resultKey = (userId: string, sessionId: string, toolCallId: string) =>
  key('calendar-tool-result', userId, sessionId, toolCallId);
export const dispatchKey = (userId: string, turnId: string, dispatchIndex: number) =>
  key('calendar-model-dispatch', userId, turnId, dispatchIndex);
export const aggregateKey = (userId: string, sessionId: string, turnId: string, attemptId: string) =>
  key('calendar-model-aggregate', userId, sessionId, turnId, attemptId);
export const sourceKey = (userId: string, sessionId: string, sourceId: string) =>
  key('calendar-source', userId, sessionId, sourceId);
export const proposalKey = (u: string, s: string, p: string) => key('calendar-proposal', u, s, p);
export const proposalConsumptionKey = (u: string, s: string, p: string) =>
  key('calendar-proposal-consumption', u, s, p);
export const intentOperationKey = (u: string, s: string, i: string) =>
  key('calendar-intent-operation', u, s, i);
export const intentReservationKey = (u: string, s: string, i: string) =>
  key('calendar-intent-reservation', u, s, i);
export const legacyDispositionKey = (u: string, kind: string, id: string) =>
  key('calendar-legacy-disposition', u, kind, id);
export const calendarReplyBindingKey = (u: string, s: string, a: string) =>
  key('calendar-reply-binding', u, s, a);

export async function readCurrentCalendarAccountBinding(
  store: RecordStore,
  userId: string,
): Promise<CalendarAccountBinding | null> {
  const raw = await store.raw('integration_connections', {
    _id: connectionKey(userId), userId, provider: 'google-calendar',
  });
  const connection = decodeCalendar(compatibleCalendarConnectionSchema, raw);
  if (!connection || !connection.enabled || connection.status !== 'connected') return null;
  return calendarAccountBindingSchema.parse({
    userId: connection.userId,
    connectionId: connection.connectionId,
    connectionRevision: connection.connectionRevision,
    googleSubjectId: connection.googleSubjectId,
  });
}

export async function requireCalendarAccountRevision(
  store: RecordStore,
  expected: Pick<CalendarAccountBinding, 'userId' | 'connectionId' | 'connectionRevision'>,
): Promise<CalendarAccountBinding> {
  const current = await readCurrentCalendarAccountBinding(store, expected.userId);
  if (!current || current.connectionId !== expected.connectionId
    || current.connectionRevision !== expected.connectionRevision) {
    throw new AppError('INVALID_REQUEST', 'Calendar account revision is no longer current.', false);
  }
  return current;
}

export function sameCalendarAccountBinding(
  left: CalendarAccountBinding | null,
  right: CalendarAccountBinding,
): boolean {
  return left !== null && left.userId === right.userId && left.connectionId === right.connectionId
    && left.connectionRevision === right.connectionRevision && left.googleSubjectId === right.googleSubjectId;
}

/**
 * Durable binding of the untrusted causal reply reference accepted with one attempt.
 *
 * Only the bounded reference is stored: the proposal revision the client answered.
 * The binding is evidence of what was accepted, never of approval.
 */
export const calendarReplyBindingSchema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-reply-binding'), userId: idSchema, sessionId: idSchema,
  turnId: idSchema, attemptId: idSchema,
  replyTo: calendarReplyReferenceSchema,
  boundAt: isoDateSchema,
}).strict();
export type CalendarReplyBinding = z.infer<typeof calendarReplyBindingSchema>;

export const proposalConsumptionRecordSchema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-proposal-consumption'), userId: idSchema, sessionId: idSchema,
  proposalId: idSchema, intentId: idSchema, authorityExpiresAt: isoDateSchema,
  reply: calendarProposalReplySchema,
  consumption: calendarProposalConsumptionSchema,
}).strict().refine(v => v.userId === v.reply.userId && v.userId === v.consumption.userId
  && v.sessionId === v.reply.sessionId && v.sessionId === v.consumption.sessionId
  && v.proposalId === v.reply.proposalId && v.proposalId === v.consumption.proposalId
  && v.intentId === v.consumption.intentId
  && v.reply.acceptedMessageId === v.consumption.acceptedMessageId
  && v.reply.acceptedTurnId === v.consumption.acceptedTurnId
  && v.reply.canonicalActionHash === v.consumption.canonicalActionHash
  && v.reply.receivedAt === v.consumption.consumedAt
  && Date.parse(v.authorityExpiresAt) > Date.parse(v.consumption.consumedAt));

export const calendarIntentReservationSchema = calendarAccountBindingSchema.extend({
  schemaVersion: z.literal(2), kind: z.literal('calendar-intent-reservation'),
  sessionId: idSchema, intentId: idSchema, operationId: idSchema,
  canonicalActionHash: sha256Schema, calendarId: calendarCanonicalIdSchema,
}).strict();
export type CalendarIntentReservation = z.infer<typeof calendarIntentReservationSchema>;

export function calendarSourceExpired(
  source: CalendarSourceReference | CalendarSourceReferenceV2,
  nowMs: number,
): boolean {
  return source.permission.content === 'volatile'
    || source.redactedAt !== null
    || Date.parse(source.expiresAt) <= nowMs;
}

function markSourceRedacted<T extends CalendarSourceReference | CalendarSourceReferenceV2>(
  source: T,
  nowMs: number,
): T {
  const redactedAt = source.redactedAt ?? new Date(nowMs).toISOString();
  if (source.schemaVersion === 2) {
    return {
      ...source,
      redactedAt,
      targets: source.targets.map((t) => ({ ...t, calendarLabel: null })),
    };
  }
  return { ...source, redactedAt };
}

export function redactCalendarMessage(record: MessageRecord, _nowMs: number): MessageRecord {
  // Retrieved calendar details stay in the visible transcript. Source/tool
  // evidence still expires separately; this must not rewrite chat history.
  return messageRecordSchema.parse(record);
}

export function redactCalendarMessageContent(record: MessageRecord, _nowMs: number): MessageRecord {
  return messageRecordSchema.parse(record);
}

function sourceBelongsToAccount(
  source: CalendarSourceReference | CalendarSourceReferenceV2,
  account: CalendarAccountBinding,
): boolean {
  return source.connectionId === account.connectionId && source.connectionRevision === account.connectionRevision;
}

export function redactCalendarSourceForAccount<T extends CalendarSourceReference | CalendarSourceReferenceV2>(
  source: T,
  account: CalendarAccountBinding,
  nowMs: number,
): T {
  return sourceBelongsToAccount(source, account) ? markSourceRedacted(source, nowMs) : source;
}

export function redactCalendarSource<T extends CalendarSourceReference | CalendarSourceReferenceV2>(
  source: T,
  nowMs: number,
): T {
  return markSourceRedacted(source, nowMs);
}

export function redactCalendarMessageForAccount(
  record: MessageRecord,
  account: CalendarAccountBinding,
  nowMs: number,
): MessageRecord {
  const parsed = messageRecordSchema.parse(record);
  if (!parsed.sourceProvenance?.some(source => sourceBelongsToAccount(source, account))) return parsed;
  const next = {
    ...parsed,
    sourceProvenance: parsed.sourceProvenance.map(source => redactCalendarSourceForAccount(source, account, nowMs)),
  };
  return isDeepStrictEqual(parsed, next) ? parsed : messageRecordSchema.parse(next);
}

export function redactCalendarDecisionForAccount(
  record: ResumableCalendarDecision,
  account: CalendarAccountBinding,
  nowMs: number,
): ResumableCalendarDecision;
export function redactCalendarDecisionForAccount(
  record: ResumableCalendarDecisionV2,
  account: CalendarAccountBinding,
  nowMs: number,
): ResumableCalendarDecisionV2;
export function redactCalendarDecisionForAccount(
  record: ResumableSkillDecision,
  account: CalendarAccountBinding,
  nowMs: number,
): ResumableSkillDecision;
export function redactCalendarDecisionForAccount(
  record: ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision,
  account: CalendarAccountBinding,
  nowMs: number,
): ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision;
export function redactCalendarDecisionForAccount(
  record: ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision,
  account: CalendarAccountBinding,
  nowMs: number,
): ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision {
  const parsed = parseDecisionRecord(record);
  if (parsed.schemaVersion === 3 && parsed.decision?.kind === 'activate_skill') return parsed;
  if (parsed.userId !== account.userId || parsed.connectionId !== account.connectionId
    || parsed.connectionRevision !== account.connectionRevision) return parsed;
  const next = { ...parsed, decision: null, sources: parsed.sources.map(source => markSourceRedacted(source, nowMs)) };
  if (parsed.schemaVersion === 2) {
    return isDeepStrictEqual(parsed, next) ? parsed : resumableDecisionV2Schema.parse(next);
  }
  if (parsed.schemaVersion === 3) {
    return isDeepStrictEqual(parsed, next) ? parsed : resumableSkillDecisionSchema.parse(next);
  }
  return isDeepStrictEqual(parsed, next) ? parsed : resumableDecisionSchema.parse(next);
}

export function redactCalendarResultForAccount(
  record: CalendarToolResultRecord,
  account: CalendarAccountBinding,
  nowMs: number,
): CalendarToolResultRecord;
export function redactCalendarResultForAccount(
  record: CalendarToolResultRecordV2,
  account: CalendarAccountBinding,
  nowMs: number,
): CalendarToolResultRecordV2;
export function redactCalendarResultForAccount(
  record: CalendarToolResultRecord | CalendarToolResultRecordV2,
  account: CalendarAccountBinding,
  nowMs: number,
): CalendarToolResultRecord | CalendarToolResultRecordV2;
export function redactCalendarResultForAccount(
  record: CalendarToolResultRecord | CalendarToolResultRecordV2,
  account: CalendarAccountBinding,
  nowMs: number,
): CalendarToolResultRecord | CalendarToolResultRecordV2 {
  const parsed = record.schemaVersion === 2
    ? calendarToolResultRecordV2Schema.parse(record)
    : calendarToolResultRecordSchema.parse(record);
  if (!sourceBelongsToAccount(parsed.resultRef.source, account)) return parsed;
  const source = markSourceRedacted(parsed.resultRef.source, nowMs);
  const resultRef = parsed.resultRef.storage === 'retained'
    ? { storage: 'tombstone' as const, source, toolCallId: parsed.resultRef.toolCallId,
      operationId: parsed.resultRef.operationId, reason: 'disconnected' as const }
    : { ...parsed.resultRef, source };
  const next = { ...parsed, resultRef };
  if (parsed.schemaVersion === 2) {
    return isDeepStrictEqual(parsed, next) ? parsed : calendarToolResultRecordV2Schema.parse(next);
  }
  return isDeepStrictEqual(parsed, next) ? parsed : calendarToolResultRecordSchema.parse(next);
}

export function redactCalendarOperationForAccount(
  record: CalendarOperation,
  account: CalendarAccountBinding,
  nowMs: number,
): CalendarOperation;
export function redactCalendarOperationForAccount(
  record: CalendarOperationV2,
  account: CalendarAccountBinding,
  nowMs: number,
): CalendarOperationV2;
export function redactCalendarOperationForAccount(
  record: CalendarOperation | CalendarOperationV2,
  account: CalendarAccountBinding,
  nowMs: number,
): CalendarOperation | CalendarOperationV2;
export function redactCalendarOperationForAccount(
  record: CalendarOperation | CalendarOperationV2,
  account: CalendarAccountBinding,
  nowMs: number,
): CalendarOperation | CalendarOperationV2 {
  const parsed = record.schemaVersion === 2
    ? operationRecordV2Schema.parse(record)
    : operationRecordSchema.parse(record);
  if (parsed.userId !== account.userId || parsed.connectionId !== account.connectionId
    || parsed.connectionRevision !== account.connectionRevision || parsed.googleSubjectId !== account.googleSubjectId) {
    return parsed;
  }
  let next: CalendarOperation | CalendarOperationV2;
  if (parsed.schemaVersion === 2) {
    next = operationRecordV2Schema.parse({
      ...parsed,
      state: parsed.state === 'planned' ? 'evidence-expired'
        : parsed.state === 'dispatching' ? 'unknown' : parsed.state,
      action: null,
      actionSources: parsed.actionSources.map(source => markSourceRedacted(source, nowMs)),
      calendarLabel: null,
      labelExpiresAt: null,
      receipt: parsed.receipt === null ? null : calendarReceiptV2Schema.parse({
        ...parsed.receipt,
        source: markSourceRedacted(parsed.receipt.source, nowMs),
        htmlLink: null,
        calendarLabel: null,
        labelExpiresAt: null,
      }),
    });
  } else {
    next = operationRecordSchema.parse({
      ...parsed,
      state: parsed.state === 'planned' ? 'evidence-expired'
        : parsed.state === 'dispatching' ? 'unknown' : parsed.state,
      action: null,
      actionSources: parsed.actionSources.map(source => markSourceRedacted(source, nowMs)),
      receipt: parsed.receipt === null ? null : calendarReceiptSchema.parse({
        ...parsed.receipt,
        source: markSourceRedacted(parsed.receipt.source, nowMs),
        htmlLink: null,
      }),
    });
  }
  return isDeepStrictEqual(parsed, next) ? parsed : next;
}

export function redactCalendarDecision(record: ResumableCalendarDecision, nowMs: number): ResumableCalendarDecision;
export function redactCalendarDecision(record: ResumableCalendarDecisionV2, nowMs: number): ResumableCalendarDecisionV2;
export function redactCalendarDecision(
  record: ResumableCalendarDecision | ResumableCalendarDecisionV2,
  nowMs: number,
): ResumableCalendarDecision | ResumableCalendarDecisionV2;
export function redactCalendarDecision(record: ResumableSkillDecision, nowMs: number): ResumableSkillDecision;
export function redactCalendarDecision(
  record: ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision,
  nowMs: number,
): ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision;
export function redactCalendarDecision(
  record: ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision,
  nowMs: number,
): ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision {
  const schema = record.schemaVersion === 3 ? resumableSkillDecisionSchema
    : record.schemaVersion === 2 ? resumableDecisionV2Schema : resumableDecisionSchema;
  const parsed = schema.parse(record);
  if (!parsed.sources.some((source) => calendarSourceExpired(source, nowMs))) return parsed;
  return schema.parse({
    ...parsed,
    decision: null,
    sources: parsed.sources.map((source) => markSourceRedacted(source, nowMs)),
  });
}

export function parseDecisionRecord(
  record: ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision,
): ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision {
  return record.schemaVersion === 3 ? resumableSkillDecisionSchema.parse(record)
    : record.schemaVersion === 2 ? resumableDecisionV2Schema.parse(record) : resumableDecisionSchema.parse(record);
}

export function redactCalendarResult(record: CalendarToolResultRecord, nowMs: number): CalendarToolResultRecord;
export function redactCalendarResult(record: CalendarToolResultRecordV2, nowMs: number): CalendarToolResultRecordV2;
export function redactCalendarResult(
  record: CalendarToolResultRecord | CalendarToolResultRecordV2,
  nowMs: number,
): CalendarToolResultRecord | CalendarToolResultRecordV2;
export function redactCalendarResult(
  record: CalendarToolResultRecord | CalendarToolResultRecordV2,
  nowMs: number,
): CalendarToolResultRecord | CalendarToolResultRecordV2 {
  if (record.schemaVersion === 2) {
    const parsed = calendarToolResultRecordV2Schema.parse(record);
    const expired = calendarSourceExpired(parsed.resultRef.source, nowMs);
    const source = expired ? markSourceRedacted(parsed.resultRef.source, nowMs) : parsed.resultRef.source;
    if (parsed.resultRef.storage !== 'retained' || !expired) {
      return { ...parsed, resultRef: { ...parsed.resultRef, source } };
    }
    return calendarToolResultRecordV2Schema.parse({
      ...parsed,
      resultRef: {
        storage: 'tombstone',
        source,
        toolCallId: parsed.resultRef.toolCallId,
        operationId: parsed.resultRef.operationId,
        reason: 'expired',
      },
    });
  }
  const parsed = calendarToolResultRecordSchema.parse(record);
  const expired = calendarSourceExpired(parsed.resultRef.source, nowMs);
  const source = expired ? markSourceRedacted(parsed.resultRef.source, nowMs) : parsed.resultRef.source;
  if (parsed.resultRef.storage !== 'retained' || !expired) {
    return { ...parsed, resultRef: { ...parsed.resultRef, source } };
  }
  return calendarToolResultRecordSchema.parse({
    ...parsed,
    resultRef: {
      storage: 'tombstone',
      source,
      toolCallId: parsed.resultRef.toolCallId,
      operationId: parsed.resultRef.operationId,
      reason: 'expired',
    },
  });
}

export function redactCalendarOperation(record: CalendarOperation, nowMs: number): CalendarOperation;
export function redactCalendarOperation(record: CalendarOperationV2, nowMs: number): CalendarOperationV2;
export function redactCalendarOperation(
  record: CalendarOperation | CalendarOperationV2,
  nowMs: number,
): CalendarOperation | CalendarOperationV2;
export function redactCalendarOperation(
  record: CalendarOperation | CalendarOperationV2,
  nowMs: number,
): CalendarOperation | CalendarOperationV2 {
  if (record.schemaVersion === 2) {
    const parsed = operationRecordV2Schema.parse(record);
    const anySourceExpired = parsed.actionSources.some((s) => calendarSourceExpired(s, nowMs));
    const labelExpired = parsed.labelExpiresAt !== null && Date.parse(parsed.labelExpiresAt) <= nowMs;
    const auditExpired = Date.parse(parsed.auditExpiresAt) <= nowMs;
    const receiptSourceExpired = parsed.receipt !== null && calendarSourceExpired(parsed.receipt.source, nowMs);
    const receiptLabelExpired = parsed.receipt?.labelExpiresAt !== null && parsed.receipt?.labelExpiresAt !== undefined
      && Date.parse(parsed.receipt.labelExpiresAt) <= nowMs;

    let action = parsed.action;
    let calendarLabel = parsed.calendarLabel;
    let labelExpiresAt = parsed.labelExpiresAt;
    let state = parsed.state;
    let actionSources = parsed.actionSources;
    let receipt = parsed.receipt;

    if (anySourceExpired) {
      actionSources = actionSources.map((s) => (calendarSourceExpired(s, nowMs) ? markSourceRedacted(s, nowMs) : s));
      action = null;
      calendarLabel = null;
      labelExpiresAt = null;
    } else if (labelExpired) {
      calendarLabel = null;
      labelExpiresAt = null;
    }

    if (auditExpired) {
      if (['succeeded', 'definitely-failed', 'failed', 'cancelled'].includes(state)) {
        state = 'evidence-expired';
        action = null;
        calendarLabel = null;
        labelExpiresAt = null;
      }
    }

    if (parsed.state === 'dispatching' && action === null) {
      state = 'unknown';
    }

    if (receipt) {
      let rSource = receipt.source;
      let rLink = receipt.htmlLink;
      let rLabel = receipt.calendarLabel;
      let rLabelExp = receipt.labelExpiresAt;

      if (receiptSourceExpired || anySourceExpired) {
        rSource = markSourceRedacted(receipt.source, nowMs);
        rLink = null;
        rLabel = null;
        rLabelExp = null;
      } else if (receiptLabelExpired || labelExpired) {
        rLabel = null;
        rLabelExp = null;
      }

      if (rSource !== receipt.source || rLink !== receipt.htmlLink || rLabel !== receipt.calendarLabel || rLabelExp !== receipt.labelExpiresAt) {
        receipt = calendarReceiptV2Schema.parse({
          ...receipt,
          source: rSource,
          htmlLink: rLink,
          calendarLabel: rLabel,
          labelExpiresAt: rLabelExp,
        });
      }
    }

    const changed = action !== parsed.action
      || calendarLabel !== parsed.calendarLabel
      || labelExpiresAt !== parsed.labelExpiresAt
      || state !== parsed.state
      || actionSources !== parsed.actionSources
      || receipt !== parsed.receipt;

    if (!changed) return parsed;

    return operationRecordV2Schema.parse({
      ...parsed,
      action,
      calendarLabel,
      labelExpiresAt,
      state,
      actionSources,
      receipt,
    });
  }

  const parsed = operationRecordSchema.parse(record);
  const anySourceExpired = parsed.actionSources.some((s) => calendarSourceExpired(s, nowMs));
  const auditExpired = Date.parse(parsed.auditExpiresAt) <= nowMs;
  let action = parsed.action;
  let state = parsed.state;
  let actionSources = parsed.actionSources;
  let receipt = parsed.receipt;

  if (anySourceExpired) {
    actionSources = actionSources.map((s) => (calendarSourceExpired(s, nowMs) ? markSourceRedacted(s, nowMs) : s));
    action = null;
  }
  if (auditExpired && ['succeeded', 'definitely-failed'].includes(state)) {
    state = 'evidence-expired';
    action = null;
  }
  if (receipt && (calendarSourceExpired(receipt.source, nowMs) || anySourceExpired)) {
    receipt = calendarReceiptSchema.parse({
      ...receipt,
      source: markSourceRedacted(receipt.source, nowMs),
      htmlLink: null,
    });
  }

  const changed = action !== parsed.action
    || state !== parsed.state
    || actionSources !== parsed.actionSources
    || receipt !== parsed.receipt;

  if (!changed) return parsed;

  return operationRecordSchema.parse({
    ...parsed,
    action,
    state,
    actionSources,
    receipt,
  });
}


export const reconciliationSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('calendar-operation-reconciliation'),
  userId: idSchema,
  sessionId: idSchema,
  turnId: idSchema,
  operationId: idSchema,
  eventId: idSchema,
  operationRevision: z.number().int().positive(),
  outcome: z.enum(['absent', 'mismatch', 'unknown']),
  connectionRevision: z.number().int().positive(),
  targetRevision: z.number().int().positive(),
  checkedAt: isoDateSchema,
  consumedAt: isoDateSchema.nullable(),
}).strict();

const eventCursorSchema = z.object({
  v: z.literal(1),
  kind: z.literal('calendar-operation-event'),
  userId: idSchema,
  operationId: idSchema,
  sequence: z.number().int().nonnegative(),
  eventId: idSchema,
}).strict();

export function encodeOperationEventCursor(
  userId: string, operationId: string, sequence: number, eventId: string,
): string {
  return Buffer.from(JSON.stringify(eventCursorSchema.parse({
    v: 1, kind: 'calendar-operation-event', userId, operationId, sequence, eventId,
  }))).toString('base64url');
}

export function decodeOperationEventCursor(
  value: string, userId: string, operationId: string,
): { sequence: number; eventId: string } {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('cursor');
    const parsed = eventCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (parsed.userId !== userId || parsed.operationId !== operationId) throw new Error('scope');
    return { sequence: parsed.sequence, eventId: parsed.eventId };
  } catch {
    throw new AppError('INVALID_REQUEST', 'Invalid page cursor.');
  }
}

export const calendarClaimSchema = z.object({
  dispatchId: idSchema,
  dispatchIndex: z.number().int().min(1).max(8),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reservationUsd: decimalSchema,
}).strict();
export const calendarClaimsSchema = z.array(calendarClaimSchema).max(8);

export const calendarAuditSchema = z.object({
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema,
  redactedAt: isoDateSchema.nullable(),
}).strict().refine((value) => {
  const lifetime = Date.parse(value.expiresAt) - Date.parse(value.createdAt);
  return lifetime > 0 && lifetime <= 2_592_000_000;
});

export const oauthTombstoneSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('calendar-oauth-state-tombstone'),
  userId: idSchema,
  stateHash: sha256Schema,
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema,
  consumedAt: isoDateSchema,
  reason: z.enum(['consumed', 'expired']),
}).strict();

export function auditExpiry(createdAt: string, policyDeadline?: string): string {
  const created = Date.parse(isoDateSchema.parse(createdAt));
  const ceiling = created + 2_592_000_000;
  const policy = policyDeadline === undefined ? ceiling : Date.parse(isoDateSchema.parse(policyDeadline));
  if (!Number.isFinite(policy) || policy <= created) {
    throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
  }
  return new Date(Math.min(ceiling, policy)).toISOString();
}

export function decodeCalendar<S extends z.ZodTypeAny>(schema: S, doc: Document | null): z.output<S> | null {
  if (!doc) return null;
  const decoded = decodeAccountingMoney(doc);
  const {
    _id: ignoredId,
    _revision: ignoredRevision,
    _calendarClaims,
    _calendarAudit,
    _calendarApproval,
    ...payload
  } = decoded as StoredDocument & {
    _calendarClaims?: unknown;
    _calendarAudit?: unknown;
    _calendarApproval?: unknown;
  };
  void ignoredId;
  void ignoredRevision;
  if (_calendarClaims !== undefined && !calendarClaimsSchema.safeParse(_calendarClaims).success) {
    throw new AppError('PERSISTENCE_ERROR', 'Saved chat data is unavailable.');
  }
  if (_calendarAudit !== undefined && !calendarAuditSchema.safeParse(_calendarAudit).success) {
    throw new AppError('PERSISTENCE_ERROR', 'Saved chat data is unavailable.');
  }
  if (_calendarApproval !== undefined && !calendarProposalReplySchema.safeParse(_calendarApproval).success) {
    throw new AppError('PERSISTENCE_ERROR', 'Saved chat data is unavailable.');
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError('PERSISTENCE_ERROR', 'Saved chat data is unavailable.');
  }
  return parsed.data;
}

export function encodeCalendar<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  id: string,
  limit: number,
  extras: {
    _calendarClaims?: z.infer<typeof calendarClaimsSchema>;
    _calendarAudit?: z.infer<typeof calendarAuditSchema>;
    _calendarApproval?: CalendarProposalReply;
  } = {},
): { record: z.output<S>; doc: StoredDocument } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
  }
  if (extras._calendarClaims) calendarClaimsSchema.parse(extras._calendarClaims);
  if (extras._calendarAudit) calendarAuditSchema.parse(extras._calendarAudit);
  if (extras._calendarApproval) calendarProposalReplySchema.parse(extras._calendarApproval);
  const doc = encodeAccountingMoney({
    ...parsed.data,
    ...extras,
    _id: id,
    _revision: 0,
  }) as StoredDocument;
  assertBytes(doc, limit);
  return { record: parsed.data, doc };
}

export async function confirmCalendarRecord<T>(
  read: () => Promise<T | null>,
  expected: T,
  revisionOf: (record: T) => number,
): Promise<{ outcome: 'confirmed'; record: T } | { outcome: 'conflict'; currentRevision: number } | { outcome: 'uncertain' }> {
  try {
    const saved = await read();
    if (saved && isDeepStrictEqual(saved, expected)) return { outcome: 'confirmed', record: saved };
    if (saved) return { outcome: 'conflict', currentRevision: revisionOf(saved) };
    return { outcome: 'uncertain' };
  } catch {
    return { outcome: 'uncertain' };
  }
}
