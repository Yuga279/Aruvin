/**
 * ============================================================================
 * FILE: calendar-operations.ts
 * LOCATION: backend/src/contracts/calendar-operations.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define Google Calendar operation ledgers, durable receipts, and execution ports.
 *
 * ROLE IN PROJECT:
 *    Ensures idempotent external operations, immutable targeting, CAS transitions,
 *    matched readbacks, and execution bindings for both v1 and v2 workflows.
 *
 * KEY COMPONENTS:
 *    - operationRecordSchema / operationRecordV2Schema: Operation record contracts.
 *    - operationEventSchema / operationEventV2Schema: Durable operation event contracts.
 *    - calendarReceiptSchema / calendarReceiptV2Schema: Durable external receipts.
 *    - calendarExecutionBindingV2Schema / CalendarExecutionPortV2: Execution ports.
 *    - calendarOperationTransitionV2Schema: Fenced operation transition validation.
 *    - calendarRequestKindSchema / CalendarRequestKindV2: Request category accounting.
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { calendarInputSchemas, calendarInputSchemasV1, calendarResultV2Schema, jsonBytes, type CalendarCall, type CalendarResult, type CalendarResultV2 } from './calendar-tools.js';
import { calendarFailureSchema, type CalendarFailure } from './calendar-policy.js';
import { sha256Schema, type CalendarConnectionBinding } from './calendar-connections.js';
import { sourceReferenceSchema, sourceReferenceV2Schema, type CalendarSourceReference, type CalendarSourceReferenceV2 } from './calendar-sources.js';
import { calendarCanonicalIdSchema, calendarAccountBindingSchema, calendarResolvedTargetSchema } from './calendar-discovery.js';
import type { CalendarProposalConsumption } from './calendar-authority.js';

export const calendarReceiptSchema = z.object({ operationId: idSchema, googleEventId: z.string().min(5).max(1024),
  connectionId: idSchema, connectionRevision: z.number().int().positive(), targetRevision: z.number().int().positive(),
  calendarIdHash: sha256Schema, requestHash: sha256Schema, verifiedAt: isoDateSchema,
  source: sourceReferenceSchema, htmlLink: z.string().max(2048).nullable(),
}).strict().superRefine((v, ctx) => {
  if (!v.source.permission.minimalEvidenceAllowed || !v.source.operationIds.includes(v.operationId)
    || v.source.connectionId !== v.connectionId || v.source.connectionRevision !== v.connectionRevision
    || (v.htmlLink !== null && v.source.permission.content !== 'retained'))
    ctx.addIssue({ code: 'custom', message: 'Receipt content exceeds retention permission.' });
});
export type CalendarReceipt = z.infer<typeof calendarReceiptSchema>;

export const operationStateSchema = z.enum(['planned', 'dispatching', 'succeeded',
  'definitely-failed', 'unknown', 'evidence-expired']);

export const operationRecordSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-operation'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, operationId: idSchema,
  originatingAttemptId: idSchema, revision: z.number().int().positive(), sequence: sequenceSchema,
  connectionId: idSchema, connectionRevision: z.number().int().positive(), googleSubjectId: z.string().min(1).max(255),
  calendarId: z.string().min(1).max(1024), targetRevision: z.number().int().positive(),
  requestHash: sha256Schema, googleEventId: z.string().regex(/^[0-9a-v]{5,1024}$/),
  schemaRevision: z.literal('google-calendar.v1'), action: calendarInputSchemasV1.calendar_create_event.nullable(),
  actionSources: z.array(sourceReferenceSchema).max(6).default([]),
  authorization: z.object({ acceptedUserMessageId: idSchema, canonicalActionHash: sha256Schema,
    approvedAt: isoDateSchema, basis: z.enum(['explicit-request', 'canonical-approval']) }).strict(),
  deliveryRetries: z.number().int().min(0).max(2), createdAt: isoDateSchema, updatedAt: isoDateSchema,
  auditExpiresAt: isoDateSchema, state: operationStateSchema, receipt: calendarReceiptSchema.nullable(),
  failure: calendarFailureSchema.nullable(),
}).strict().superRefine((v, ctx) => {
  const invalid = v.authorization.canonicalActionHash !== v.requestHash
    || (['planned', 'dispatching'].includes(v.state) && v.action === null)
    || (v.state === 'succeeded' && v.receipt === null)
    || (v.state !== 'succeeded' && v.receipt !== null)
    || (v.state === 'evidence-expired' && v.action !== null)
    || v.actionSources.some(s => !s.permission.minimalEvidenceAllowed)
    || (v.action !== null && v.actionSources.some(s => s.permission.content !== 'retained'))
    || Date.parse(v.auditExpiresAt) - Date.parse(v.createdAt) > 2592000000
    || (v.receipt !== null && (v.receipt.operationId !== v.operationId
      || v.receipt.googleEventId !== v.googleEventId || v.receipt.requestHash !== v.requestHash
      || v.receipt.connectionId !== v.connectionId || v.receipt.connectionRevision !== v.connectionRevision
      || v.receipt.targetRevision !== v.targetRevision));
  if (invalid) ctx.addIssue({ code: 'custom', message: 'Inconsistent operation authority.' });
});
export type CalendarOperation = z.infer<typeof operationRecordSchema>;

export const operationEventSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-operation-event'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  operationId: idSchema, eventId: idSchema, sequence: sequenceSchema, state: operationStateSchema,
  createdAt: isoDateSchema, failure: calendarFailureSchema.nullable(),
}).strict();
export type CalendarOperationEvent = z.infer<typeof operationEventSchema>;

export type OperationCas = { outcome: 'confirmed'; record: CalendarOperation }
  | { outcome: 'conflict' } | { outcome: 'uncertain' };

export interface CalendarOperationStore {
  getByTurn(userId: string, sessionId: string, turnId: string): Promise<CalendarOperation | null>;
  reserve(record: CalendarOperation): Promise<{ outcome: 'created' | 'existing'; record: CalendarOperation }>;
  compareAndSwap(expectedRevision: number, next: CalendarOperation): Promise<OperationCas>;
  appendEvent(event: CalendarOperationEvent): Promise<void>;
  listEvents(input: { userId: string; operationId: string; cursor: string | null; limit: number }):
    Promise<{ items: CalendarOperationEvent[]; nextCursor: string | null }>;
}

export type CalendarExecutionBinding = Readonly<CalendarConnectionBinding & {
  sessionId: string; turnId: string; attemptId: string; decisionId: string; toolCallId: string;
  schemaRevision: 'google-calendar.v1'; operation: CalendarOperation | null;
  trustedNow: string; trustedTimeZone: string; deadlineAt: string;
}>;
export type CalendarRequestKind = 'list' | 'get' | 'create' | 'readback';
export type CalendarExecutionResult =
  | { outcome: 'success'; result: CalendarResult; source: CalendarSourceReference; receipt: CalendarReceipt | null }
  | { outcome: 'failure'; failure: CalendarFailure };
export interface CalendarExecutionPort {
  invoke(input: { binding: CalendarExecutionBinding; call: CalendarCall; signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKind) => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<CalendarExecutionResult>;
  readback(input: { binding: CalendarExecutionBinding; operation: CalendarOperation; signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKind) => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<
      { outcome: 'matched'; receipt: CalendarReceipt }
      | { outcome: 'absent' | 'mismatch' | 'unknown' }>;
  close(): Promise<void>;
}

export const calendarReceiptV2Schema = z.object({ schemaVersion: z.literal(2), operationId: idSchema,
  googleEventId: z.string().regex(/^[0-9a-v]{5,1024}$/), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), targetRevision: z.number().int().positive(),
  calendarId: calendarCanonicalIdSchema, calendarLabel: z.string().min(1).max(200).nullable(),
  labelExpiresAt: isoDateSchema.nullable(), requestHash: sha256Schema, verifiedAt: isoDateSchema,
  source: sourceReferenceV2Schema, htmlLink: z.string().max(2048).nullable(),
}).strict().refine(v => v.source.permission.minimalEvidenceAllowed
  && v.source.operationIds.includes(v.operationId) && v.source.connectionId === v.connectionId
  && v.source.connectionRevision === v.connectionRevision
  && v.source.targets.some(t => t.calendarId === v.calendarId && t.calendarLabel === v.calendarLabel)
  && ((v.calendarLabel === null) === (v.labelExpiresAt === null))
  && (v.labelExpiresAt === null || (v.source.permission.content === 'retained'
    && Date.parse(v.labelExpiresAt) <= Date.parse(v.source.expiresAt)))
  && (v.htmlLink === null || v.source.permission.content === 'retained')
  && (v.labelExpiresAt === null || Date.parse(v.labelExpiresAt) >= Date.parse(v.verifiedAt)));
export type CalendarReceiptV2 = z.infer<typeof calendarReceiptV2Schema>;

export const operationStateV2Schema = z.enum(['planned', 'dispatching', 'succeeded',
  'definitely-failed', 'unknown', 'evidence-expired', 'failed', 'cancelled']);

export const operationRecordV2Schema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-operation'), userId: idSchema, sessionId: idSchema, turnId: idSchema,
  operationId: idSchema, originatingAttemptId: idSchema, revision: z.number().int().positive(), sequence: sequenceSchema,
  intentId: idSchema, originatingTurnId: idSchema, originatingAcceptedMessageId: idSchema,
  connectionId: idSchema, connectionRevision: z.number().int().positive(), googleSubjectId: z.string().min(1).max(255),
  calendarId: calendarCanonicalIdSchema, targetRevision: z.number().int().positive(),
  calendarLabel: z.string().min(1).max(200).nullable(), labelExpiresAt: isoDateSchema.nullable(),
  discoveryRevision: z.number().int().positive(), proofRevision: z.literal('google-calendar.multi.v2'),
  requestHash: sha256Schema, googleEventId: z.string().regex(/^[0-9a-v]{5,1024}$/),
  schemaRevision: z.literal('google-calendar.v2'), action: calendarInputSchemas.calendar_create_event.nullable(),
  actionSources: z.array(sourceReferenceV2Schema).max(6).default([]),
  authorization: z.object({ acceptedUserMessageId: idSchema, acceptedTurnId: idSchema,
    canonicalActionHash: sha256Schema, approvedAt: isoDateSchema,
    basis: z.enum(['explicit-request', 'proposal-selection', 'proposal-confirmation', 'conflict-acceptance']),
    proposalId: idSchema.nullable(), conditionFingerprint: sha256Schema.nullable() }).strict(),
  deliveryRetries: z.number().int().min(0).max(2), createdAt: isoDateSchema, updatedAt: isoDateSchema,
  auditExpiresAt: isoDateSchema, state: operationStateV2Schema, receipt: calendarReceiptV2Schema.nullable(),
  failure: calendarFailureSchema.nullable(),
}).strict().refine(v => {
  const a = v.authorization, r = v.receipt;
  return a.canonicalActionHash === v.requestHash
    && a.acceptedTurnId === v.turnId
    && (a.basis === 'explicit-request' || a.proposalId !== null)
    && (a.basis !== 'conflict-acceptance' || a.conditionFingerprint !== null)
    && (!['planned', 'dispatching'].includes(v.state) || v.action !== null)
    && (v.action === null || v.action.calendarId === v.calendarId)
    && ((v.state === 'succeeded') === (r !== null))
    && (v.state !== 'evidence-expired' || v.action === null)
    && ((v.calendarLabel === null) === (v.labelExpiresAt === null))
    && v.actionSources.every(s => s.permission.minimalEvidenceAllowed
      && s.connectionId === v.connectionId && s.connectionRevision === v.connectionRevision
      && (v.action === null || s.permission.content === 'retained'))
    && Date.parse(v.auditExpiresAt) >= Date.parse(v.createdAt)
    && Date.parse(v.auditExpiresAt) - Date.parse(v.createdAt) <= 2592000000
    && (r === null || (r.operationId === v.operationId && r.googleEventId === v.googleEventId
      && r.requestHash === v.requestHash && r.calendarId === v.calendarId
      && r.connectionId === v.connectionId && r.connectionRevision === v.connectionRevision
      && r.targetRevision === v.targetRevision))
    && (v.calendarLabel === null || (v.labelExpiresAt !== null
      && Date.parse(v.labelExpiresAt) >= Date.parse(v.createdAt)
      && Date.parse(v.labelExpiresAt) <= Date.parse(v.createdAt) + 86400000
      && v.actionSources.some(s => s.permission.content === 'retained'
        && Date.parse(s.expiresAt) >= Date.parse(v.labelExpiresAt!)
        && s.targets.some(t => t.calendarId === v.calendarId && t.calendarLabel === v.calendarLabel))));
});
export type CalendarOperationV2 = z.infer<typeof operationRecordV2Schema>;

/**
 * Durable transition event for a v2 intent operation. The `kind` literal is
 * distinct from the v1 event kind so the legacy v1 event read path can never
 * select a v2 document and fail its strict v1 decode.
 */
export const operationEventV2Schema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-operation-event-v2'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  operationId: idSchema, intentId: idSchema, eventId: idSchema, sequence: sequenceSchema,
  state: operationStateV2Schema, revision: z.number().int().positive(),
  createdAt: isoDateSchema, failure: calendarFailureSchema.nullable(),
}).strict();
export type CalendarOperationEventV2 = z.infer<typeof operationEventV2Schema>;

export const calendarExecutionBindingV2Schema = calendarAccountBindingSchema.extend({
  target: calendarResolvedTargetSchema.nullable(),
  sessionId: idSchema, turnId: idSchema, attemptId: idSchema, decisionId: idSchema, toolCallId: idSchema,
  schemaRevision: z.literal('google-calendar.v2'), operation: operationRecordV2Schema.nullable(),
  trustedNow: isoDateSchema, trustedTimeZone: z.string().min(1).max(100), deadlineAt: isoDateSchema,
}).strict().refine(v => {
  const t = v.target, o = v.operation;
  return Date.parse(v.deadlineAt) > Date.parse(v.trustedNow)
    && (t === null || (t.userId === v.userId && t.connectionId === v.connectionId
      && t.connectionRevision === v.connectionRevision && t.googleSubjectId === v.googleSubjectId))
    && (o === null || (t !== null && o.userId === v.userId && o.sessionId === v.sessionId
      && o.connectionId === v.connectionId && o.connectionRevision === v.connectionRevision
      && o.googleSubjectId === v.googleSubjectId && o.calendarId === t.calendarId
      && o.targetRevision === t.targetRevision));
});
export type CalendarExecutionBindingV2 = z.infer<typeof calendarExecutionBindingV2Schema>;

export const calendarRequestKindSchema = z.enum(['list', 'get', 'create', 'readback',
  'discovery', 'availability', 'preflight', 'capability-recheck']);
export type CalendarRequestKindV2 = z.infer<typeof calendarRequestKindSchema>;

export type CalendarExecutionResultV2 =
  | { outcome: 'success'; result: CalendarResultV2; source: CalendarSourceReferenceV2; receipt: CalendarReceiptV2 | null }
  | { outcome: 'failure'; failure: CalendarFailure };

export interface CalendarExecutionPortV2 {
  invoke(input: { binding: CalendarExecutionBindingV2; call: CalendarCall; signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKindV2) => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<CalendarExecutionResultV2>;
  readback(input: { binding: CalendarExecutionBindingV2; operation: CalendarOperationV2; signal: AbortSignal;
    consumeRequest: (kind: CalendarRequestKindV2) => Promise<void>;
    consumeRefreshRequest: () => Promise<void> }): Promise<{ outcome: 'matched'; receipt: CalendarReceiptV2 }
      | { outcome: 'absent' | 'mismatch' | 'unknown' }>;
  close(): Promise<void>;
}

export const calendarOperationTransitionV2Schema = z.object({ previous: operationRecordV2Schema,
  next: operationRecordV2Schema }).strict().refine(({ previous: p, next: n }) =>
  n.revision === p.revision + 1 && n.sequence > p.sequence
  && (['userId', 'sessionId', 'turnId', 'operationId', 'originatingAttemptId', 'intentId',
    'originatingTurnId', 'originatingAcceptedMessageId', 'connectionId', 'connectionRevision',
    'googleSubjectId', 'calendarId', 'targetRevision', 'requestHash', 'googleEventId',
    'schemaRevision', 'proofRevision'] as const).every(key => p[key] === n[key])
  && JSON.stringify(p.authorization) === JSON.stringify(n.authorization)
  && (!['succeeded', 'definitely-failed', 'failed', 'cancelled', 'evidence-expired'].includes(p.state)
    || n.state === p.state || n.state === 'evidence-expired')
  && (p.state !== 'unknown' || n.state !== 'dispatching'));

export interface CalendarOperationStoreV2 {
  getByTurn(userId: string, sessionId: string, turnId: string): Promise<CalendarOperation | CalendarOperationV2 | null>;
  getByIntent(userId: string, sessionId: string, intentId: string): Promise<CalendarOperationV2 | null>;
  reserveByIntent(input: { operation: CalendarOperationV2; consumption: CalendarProposalConsumption | null }):
    Promise<{ outcome: 'created' | 'existing'; operation: CalendarOperationV2 } | { outcome: 'uncertain' }>;
  compareAndSwap(input: { expectedRevision: number; next: CalendarOperationV2 }):
    Promise<{ outcome: 'confirmed'; operation: CalendarOperationV2 } | { outcome: 'conflict' | 'uncertain' }>;
  /** Records one v2 operation transition event; idempotent per event id. */
  appendEventV2(event: CalendarOperationEventV2): Promise<{ outcome: 'confirmed' | 'uncertain' }>;
  /** Reads the bounded, sequence-ordered event history of one v2 operation. */
  listEventsV2(input: { userId: string; sessionId: string; operationId: string }):
    Promise<CalendarOperationEventV2[]>;
  /**
   * Lists the bounded, unresolved operations of one session.
   * `overflow` is true when more unresolved operations matched than the limit,
   * so the caller can refuse rather than silently act on a truncated view.
   */
  listUnresolvedBySession(input: { userId: string; sessionId: string; limit: number }):
    Promise<{ operations: (CalendarOperation | CalendarOperationV2)[]; overflow: boolean }>;
  /**
   * Finds a succeeded create in this session with the same canonical action.
   * A later turn that repeats the event must reuse this row instead of treating
   * the written busy interval as a new foreign conflict.
   */
  findSucceededByRequestHash(userId: string, sessionId: string, requestHash: string):
    Promise<CalendarOperationV2 | null>;
  /**
   * Finds a succeeded or dispatching create in this session on the same calendar
   * whose action occupies the same start/end instants. Timestamp spelling and
   * request-hash differences must not treat our own written window as a foreign
   * busy conflict.
   */
  findOwnCreateBySlot(userId: string, sessionId: string, slot: {
    calendarId: string; start: string; end: string;
  }): Promise<CalendarOperationV2 | null>;
}

export const calendarExecutionEnvelopeV2Schema = z.union([
  z.object({ outcome: z.literal('success'), result: calendarResultV2Schema,
    source: sourceReferenceV2Schema, receipt: calendarReceiptV2Schema.nullable() }).strict(),
  z.object({ outcome: z.literal('failure'), failure: calendarFailureSchema }).strict(),
]).refine(v => {
  const encoded = { content: [], structuredContent: v, ...(v.outcome === 'failure' ? { isError: true } : {}) };
  if (jsonBytes(encoded) > 16384) return false;
  if (v.outcome === 'failure') return true;
  const r = v.result;
  const targets = 'target' in r ? [r.target]
    : r.tool === 'calendar_list_calendars' ? r.calendars.map(c => ({ calendarId: c.calendarId, calendarLabel: c.label }))
      : r.calendars;
  if (!targets.every(t => v.source.targets.some(s => s.calendarId === t.calendarId
    && (s.calendarLabel === null || s.calendarLabel === t.calendarLabel)))) return false;
  if (r.tool === 'calendar_check_availability' && (v.source.availabilityRevision !== r.availabilityRevision
    || v.source.discoveryRevision !== r.discoveryRevision || v.source.calendarSetHash !== r.calendarSetHash)) return false;
  return r.tool === 'calendar_create_event'
    ? v.receipt !== null && v.receipt.googleEventId === r.event.eventId
      && v.receipt.calendarId === r.target.calendarId
      && v.receipt.connectionId === v.source.connectionId
      && v.receipt.connectionRevision === v.source.connectionRevision
    : v.receipt === null;
});
export type CalendarExecutionEnvelopeV2 = z.infer<typeof calendarExecutionEnvelopeV2Schema>;
