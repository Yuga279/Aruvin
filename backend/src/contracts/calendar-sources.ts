/**
 * ============================================================================
 * FILE: calendar-sources.ts
 * LOCATION: backend/src/contracts/calendar-sources.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define Google Calendar source reference, result persistence, and provenance contracts.
 *
 * ROLE IN PROJECT:
 *    Governs multi-calendar provenance, source permission boundaries, retention lifetimes,
 *    and persisted tool result records for both v1 and v2.
 *
 * KEY COMPONENTS:
 *    - sourceReferenceSchema / sourceReferenceV2Schema: Source metadata provenance.
 *    - persistedCalendarResultSchema / persistedCalendarResultV2Schema: Persisted result envelopes.
 *    - calendarToolResultRecordSchema / calendarToolResultRecordV2Schema: Durable result records.
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { calendarResultV1Schema, calendarResultV2Schema, skillLocalResultSchema } from './calendar-tools.js';
import { SKILL_PROTOCOL_VERSION } from './calendar-policy.js';
import { sha256Schema } from './calendar-connections.js';
import { calendarCanonicalIdSchema } from './calendar-discovery.js';

export const CALENDAR_TOMBSTONE = '[Google Calendar details expired or disconnected]';
export function effectiveSourceExpiry(fetchedAt: string, deadlines: readonly number[], permitted: boolean): string {
  const start = Date.parse(isoDateSchema.parse(fetchedAt));
  if (!deadlines.every(Number.isFinite)) throw new Error('Invalid source deadline.');
  return new Date(permitted ? Math.min(start + 86400000, ...deadlines) : start).toISOString();
}
export const sourcePermissionSchema = z.object({ content: z.enum(['volatile', 'retained']),
  minimalEvidenceAllowed: z.boolean(), policyId: idSchema }).strict();

export const sourceReferenceSchema = z.object({ schemaVersion: z.literal(1),
  sourceId: idSchema, plugin: z.literal('google-calendar'), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), operationIds: z.array(idSchema).min(1).max(6),
  fetchedAt: isoDateSchema, expiresAt: isoDateSchema, redactedAt: isoDateSchema.nullable(),
  permission: sourcePermissionSchema,
}).strict().superRefine((v, ctx) => {
  const lifetime = Date.parse(v.expiresAt) - Date.parse(v.fetchedAt);
  if (lifetime > 86400000 || (v.permission.content === 'volatile' && lifetime > 0))
    ctx.addIssue({ code: 'custom', message: 'Source lifetime exceeds permission.' });
});
export type CalendarSourceReference = z.infer<typeof sourceReferenceSchema>;

export const persistedCalendarResultSchema = z.discriminatedUnion('storage', [
  z.object({ storage: z.literal('reference'), source: sourceReferenceSchema,
    toolCallId: idSchema, operationId: idSchema, outcome: z.enum(['ok', 'error', 'unknown']) }).strict(),
  z.object({ storage: z.literal('retained'), source: sourceReferenceSchema,
    toolCallId: idSchema, operationId: idSchema, result: calendarResultV1Schema }).strict(),
  z.object({ storage: z.literal('tombstone'), source: sourceReferenceSchema,
    toolCallId: idSchema, operationId: idSchema, reason: z.enum(['expired', 'disconnected', 'not-permitted']) }).strict(),
]).superRefine((v, ctx) => {
  if (!v.source.permission.minimalEvidenceAllowed || !v.source.operationIds.includes(v.operationId)
    || (v.storage === 'retained' && (v.source.permission.content !== 'retained'
      || Date.parse(v.source.expiresAt) <= Date.parse(v.source.fetchedAt))))
    ctx.addIssue({ code: 'custom', message: 'Durable evidence is not permitted.' });
});
export type PersistedCalendarResult = z.infer<typeof persistedCalendarResultSchema>;

export const calendarToolResultRecordSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('calendar-tool-result'),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  decisionId: idSchema, eventId: idSchema, sequence: z.number().int().nonnegative(),
  toolCallId: idSchema, createdAt: isoDateSchema, resultRef: persistedCalendarResultSchema,
}).strict().refine(v => v.toolCallId === v.resultRef.toolCallId);
export type CalendarToolResultRecord = z.infer<typeof calendarToolResultRecordSchema>;

export interface CalendarResultStore {
  put(record: CalendarToolResultRecord): Promise<void>;
  get(userId: string, sessionId: string, toolCallId: string): Promise<CalendarToolResultRecord | null>;
}

export const sourceReferenceV2Schema = z.object({ schemaVersion: z.literal(2), sourceId: idSchema,
  plugin: z.literal('google-calendar'), connectionId: idSchema, connectionRevision: z.number().int().positive(),
  operationIds: z.array(idSchema).max(6), toolCallIds: z.array(idSchema).min(1).max(6),
  fetchedAt: isoDateSchema, expiresAt: isoDateSchema, redactedAt: isoDateSchema.nullable(),
  permission: sourcePermissionSchema, discoveryRevision: z.number().int().positive(),
  availabilityRevision: z.number().int().positive().nullable(), calendarSetHash: sha256Schema.nullable(),
  targets: z.array(z.object({ calendarId: calendarCanonicalIdSchema,
    calendarLabel: z.string().min(1).max(200).nullable() }).strict()).max(100),
}).strict().refine(v => {
  const lifetime = Date.parse(v.expiresAt) - Date.parse(v.fetchedAt);
  return lifetime >= 0 && lifetime <= 86400000
    && (v.permission.content === 'retained' || (lifetime === 0 && v.targets.every(t => t.calendarLabel === null)))
    && new Set(v.targets.map(t => t.calendarId)).size === v.targets.length
    && new Set(v.toolCallIds).size === v.toolCallIds.length
    && new Set(v.operationIds).size === v.operationIds.length
    && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 262144;
});
export type CalendarSourceReferenceV2 = z.infer<typeof sourceReferenceV2Schema>;

export const persistedCalendarResultV2Schema = z.union([
  z.object({ storage: z.literal('reference'), source: sourceReferenceV2Schema,
    toolCallId: idSchema, operationId: idSchema.nullable(), outcome: z.enum(['ok', 'error', 'unknown']) }).strict(),
  z.object({ storage: z.literal('retained'), source: sourceReferenceV2Schema,
    toolCallId: idSchema, operationId: idSchema.nullable(), result: calendarResultV2Schema }).strict(),
  z.object({ storage: z.literal('tombstone'), source: sourceReferenceV2Schema,
    toolCallId: idSchema, operationId: idSchema.nullable(), reason: z.enum(['expired', 'disconnected', 'not-permitted']) }).strict(),
]).refine(v => {
  if (!v.source.permission.minimalEvidenceAllowed || !v.source.toolCallIds.includes(v.toolCallId)
    || (v.operationId !== null && !v.source.operationIds.includes(v.operationId))) return false;
  if (v.storage !== 'retained') return true;
  if (v.source.permission.content !== 'retained' || Date.parse(v.source.expiresAt) <= Date.parse(v.source.fetchedAt)) return false;
  const result = v.result;
  const targets = 'target' in result ? [result.target]
    : result.tool === 'calendar_list_calendars' ? result.calendars.map(c => ({ calendarId: c.calendarId, calendarLabel: c.label }))
      : result.calendars;
  return targets.every(t => v.source.targets.some(s => s.calendarId === t.calendarId && s.calendarLabel === t.calendarLabel))
    && (result.tool !== 'calendar_check_availability' || (v.source.calendarSetHash === result.calendarSetHash
      && v.source.availabilityRevision === result.availabilityRevision
      && v.source.discoveryRevision === result.discoveryRevision));
});

export const calendarToolResultRecordV2Schema = z.object({ schemaVersion: z.literal(2),
  kind: z.literal('calendar-tool-result'), userId: idSchema, sessionId: idSchema, turnId: idSchema,
  attemptId: idSchema, decisionId: idSchema, eventId: idSchema, sequence: z.number().int().nonnegative(),
  toolCallId: idSchema, createdAt: isoDateSchema, resultRef: persistedCalendarResultV2Schema,
}).strict().refine(v => v.toolCallId === v.resultRef.toolCallId);
export type CalendarToolResultRecordV2 = z.infer<typeof calendarToolResultRecordV2Schema>;

export interface CalendarResultStoreV2 {
  put(record: CalendarToolResultRecordV2): Promise<void>;
  get(userId: string, sessionId: string, toolCallId: string):
    Promise<CalendarToolResultRecord | CalendarToolResultRecordV2 | null>;
}

const localSkillContentSchema = z.string().refine(content => {
  if (Buffer.byteLength(content, 'utf8') > 16384) return false;
  try { return skillLocalResultSchema.safeParse(JSON.parse(content)).success; }
  catch { return false; }
});
export const localSkillResultRecordSchema = z.object({ schemaVersion: z.literal(3),
  kind: z.literal('calendar-tool-result'), protocolVersion: z.literal(SKILL_PROTOCOL_VERSION),
  userId: idSchema, sessionId: idSchema, turnId: idSchema, attemptId: idSchema,
  decisionId: idSchema, eventId: idSchema, sequence: z.number().int().nonnegative(),
  toolCallId: idSchema, createdAt: isoDateSchema,
  resultRef: z.object({ storage: z.literal('local'), toolCallId: idSchema,
    content: localSkillContentSchema }).strict(),
}).strict().refine(v => v.toolCallId === v.resultRef.toolCallId);
export type LocalSkillResultRecord = z.infer<typeof localSkillResultRecordSchema>;
export interface SkillResultStore {
  put(record: CalendarToolResultRecordV2 | LocalSkillResultRecord): Promise<void>;
  get(userId: string, sessionId: string, toolCallId: string):
    Promise<CalendarToolResultRecord | CalendarToolResultRecordV2 | LocalSkillResultRecord | null>;
}
