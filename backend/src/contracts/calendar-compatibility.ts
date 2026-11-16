/**
 * ============================================================================
 * FILE: calendar-compatibility.ts
 * LOCATION: backend/src/contracts/calendar-compatibility.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define Google Calendar Phase 2 backward compatibility decoders and legacy dispositions.
 *
 * ROLE IN PROJECT:
 *    Provides safe union decoders for connections, operations, receipts, sources, cursors,
 *    and checkpoints while preserving terminal read-only semantics for v1 evidence.
 *
 * KEY COMPONENTS:
 *    - compatibleCalendarConnectionSchema / compatibleCalendarOperationSchema
 *    - compatibleCalendarReceiptSchema / compatibleCalendarSourceSchema
 *    - calendarCursorV1PayloadSchema / calendarCursorV2PayloadSchema / compatibleCalendarCursorPayloadSchema
 *    - calendarCheckpointRefsV1Schema / calendarCheckpointRefsV2Schema / compatibleCalendarCheckpointRefsSchema
 *    - calendarLegacyDispositionSchema / legacyOperationDisposition
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { connectionRecordSchema, sha256Schema } from './calendar-connections.js';
import { calendarConnectionV2Schema } from './calendar-discovery.js';
import { operationRecordSchema, operationRecordV2Schema, calendarReceiptSchema, calendarReceiptV2Schema,
  type CalendarOperation, type CalendarOperationV2 } from './calendar-operations.js';
import { sourceReferenceSchema, sourceReferenceV2Schema, calendarToolResultRecordSchema,
  calendarToolResultRecordV2Schema, localSkillResultRecordSchema } from './calendar-sources.js';
import { resumableDecisionSchema, resumableDecisionV2Schema,
  rejectedDecisionSchema, rejectedDecisionV2Schema, resumableSkillDecisionSchema } from './calendar-model.js';
import { SKILL_PROTOCOL_VERSION } from './calendar-policy.js';
import { modelDispatchSchema, modelDispatchV2Schema } from './calendar-accounting.js';

export const compatibleCalendarConnectionSchema = z.union([connectionRecordSchema, calendarConnectionV2Schema]);
export const compatibleCalendarOperationSchema = z.union([operationRecordSchema, operationRecordV2Schema]);
export const compatibleCalendarReceiptSchema = z.union([calendarReceiptSchema, calendarReceiptV2Schema]);
export const compatibleCalendarSourceSchema = z.union([sourceReferenceSchema, sourceReferenceV2Schema]);
export const compatibleCalendarResultRecordSchema = z.union([calendarToolResultRecordSchema, calendarToolResultRecordV2Schema]);
export const compatibleCalendarDecisionSchema = z.union([resumableDecisionSchema, resumableDecisionV2Schema]);
export const compatibleCalendarRejectedDecisionSchema = z.union([rejectedDecisionSchema, rejectedDecisionV2Schema]);
export const compatibleCalendarDispatchSchema = z.union([modelDispatchSchema, modelDispatchV2Schema]);

export const calendarCursorV1PayloadSchema = z.object({ v: z.literal(1), b: sha256Schema,
  q: sha256Schema, t: z.string().min(1).max(2048) }).strict();
export const calendarCursorV2PayloadSchema = z.object({ v: z.literal(2), b: sha256Schema,
  q: sha256Schema, t: z.string().min(1).max(2048), kind: z.enum(['events', 'calendars']),
  discoveryRevision: z.number().int().positive(), expiresAt: isoDateSchema }).strict();
export const compatibleCalendarCursorPayloadSchema = z.union([calendarCursorV1PayloadSchema, calendarCursorV2PayloadSchema]);

export const calendarCheckpointRefsV1Schema = z.object({ version: z.literal(1), userId: idSchema,
  sessionId: idSchema, turnId: idSchema, decisionIds: z.array(idSchema).max(8),
  toolCallIds: z.array(idSchema).max(6), operationId: idSchema.nullable() }).strict();
export const calendarCheckpointRefsV2Schema = z.object({ version: z.literal(2), userId: idSchema,
  sessionId: idSchema, turnId: idSchema, decisionIds: z.array(idSchema).max(8),
  toolCallIds: z.array(idSchema).max(6), operationId: idSchema.nullable(),
  intentId: idSchema.nullable(), proposalId: idSchema.nullable(), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), schemaRevision: z.literal('google-calendar.v2'),
}).strict();
export const compatibleCalendarCheckpointRefsSchema = z.union([calendarCheckpointRefsV1Schema, calendarCheckpointRefsV2Schema]);

export const compatibleSkillDecisionRecordSchema = z.union([
  resumableDecisionSchema, resumableDecisionV2Schema, resumableSkillDecisionSchema,
]);
export const compatibleSkillResultRecordSchema = z.union([
  calendarToolResultRecordSchema, calendarToolResultRecordV2Schema, localSkillResultRecordSchema,
]);
export const skillCheckpointRefsSchema = calendarCheckpointRefsV2Schema.extend({
  version: z.literal(3), protocolVersion: z.literal(SKILL_PROTOCOL_VERSION),
  toolCallIds: z.array(idSchema).max(8),
}).strict().refine(v => new Set(v.decisionIds).size === v.decisionIds.length
  && new Set(v.toolCallIds).size === v.toolCallIds.length
  && v.toolCallIds.length <= v.decisionIds.length);
export const compatibleSkillCheckpointRefsSchema = z.union([
  calendarCheckpointRefsV1Schema, calendarCheckpointRefsV2Schema, skillCheckpointRefsSchema,
]);

export const calendarLegacyDispositionSchema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-legacy-disposition'), userId: idSchema, sessionId: idSchema,
  turnId: idSchema, legacyKind: z.enum(['operation', 'decision', 'checkpoint']), legacyRecordId: idSchema,
  operationId: idSchema.nullable(), state: z.enum(['failed', 'cancelled']),
  externalOutcome: z.enum(['not-dispatched', 'unknown', 'known-terminal']),
  reconcileOriginal: z.boolean(), reason: z.literal('legacy-read-only'), at: isoDateSchema,
}).strict().refine(v => (v.externalOutcome !== 'unknown' || (v.reconcileOriginal && v.operationId !== null))
  && (!v.reconcileOriginal || v.operationId !== null));
export type CalendarLegacyDisposition = z.infer<typeof calendarLegacyDispositionSchema>;

export function legacyOperationDisposition(op: CalendarOperation | CalendarOperationV2,
  now: string): CalendarLegacyDisposition | null {
  if (op.schemaVersion !== 1 || ['succeeded', 'definitely-failed', 'evidence-expired'].includes(op.state)) return null;
  const uncertain = ['dispatching', 'unknown'].includes(op.state);
  return calendarLegacyDispositionSchema.parse({ schemaVersion: 2, kind: 'calendar-legacy-disposition',
    userId: op.userId, sessionId: op.sessionId, turnId: op.turnId, legacyKind: 'operation',
    legacyRecordId: op.operationId, operationId: op.operationId,
    state: uncertain ? 'cancelled' : 'failed', externalOutcome: uncertain ? 'unknown' : 'not-dispatched',
    reconcileOriginal: uncertain, reason: 'legacy-read-only', at: now });
}
