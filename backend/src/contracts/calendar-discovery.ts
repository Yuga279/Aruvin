/**
 * ============================================================================
 * FILE: calendar-discovery.ts
 * LOCATION: backend/src/contracts/calendar-discovery.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define Google Calendar Phase 2 discovery, roles, snapshots, targets, and connection contracts.
 *
 * ROLE IN PROJECT:
 *    Provides bounded schemas for discovered calendars, role/capability intersections,
 *    default calendar preference authority, and discovery provider/store ports.
 *
 * KEY COMPONENTS:
 *    - calendarRoleSchema / calendarCapabilitiesSchema / effectiveCalendarCapabilities
 *    - calendarDiscoveryEntrySchema / calendarDiscoverySnapshotSchema / primaryCalendarId
 *    - calendarDefaultSettingSchema / calendarResolvedTargetSchema
 *    - calendarConnectionV2Schema / calendarConnectionTransitionV2Schema
 *    - CalendarConnectionStoreV2 / CalendarDiscoveryPort / CalendarProviderContext
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { CALENDAR_SCOPES, calendarGrantSchema, calendarGrantStatus } from './calendar-policy.js';
import { encryptedCalendarSecretSchema, type CalendarConnectionRecord } from './calendar-connections.js';

export const calendarIdSchema = z.string().min(1).max(1024);
export const calendarCanonicalIdSchema = calendarIdSchema.refine(v => v !== 'primary');
export const calendarRoleSchema = z.enum(['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader']);
export const calendarCapabilitiesSchema = z.object({ readEvents: z.boolean(),
  createEvents: z.boolean(), availability: z.boolean() }).strict();
export type CalendarCapabilities = z.infer<typeof calendarCapabilitiesSchema>;
export function effectiveCalendarCapabilities(role: z.infer<typeof calendarRoleSchema>,
  scopes: readonly string[], policyAllows: boolean): CalendarCapabilities {
  const active = policyAllows && CALENDAR_SCOPES.every(s => scopes.includes(s));
  return { readEvents: active && role !== 'freeBusyReader',
    createEvents: active && ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(role),
    availability: active };
}
export const calendarDiscoveryEntrySchema = z.object({ calendarId: calendarCanonicalIdSchema,
  label: z.string().min(1).max(200), primary: z.boolean(), accessRole: calendarRoleSchema,
  privateAccess: z.boolean(), timeZone: z.string().min(1).max(100).nullable(), selected: z.boolean(),
  hidden: z.boolean(), deleted: z.boolean(), capabilities: calendarCapabilitiesSchema,
}).strict().refine(v => (!['reader', 'freeBusyReader', 'writerWithoutPrivateAccess'].includes(v.accessRole)
    || !v.privateAccess)
  && (!v.capabilities.createEvents || ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(v.accessRole))
  && (!v.capabilities.readEvents || v.accessRole !== 'freeBusyReader')
  && (!(v.hidden || v.deleted) || !Object.values(v.capabilities).some(Boolean)));
export type CalendarDiscoveryEntry = z.infer<typeof calendarDiscoveryEntrySchema>;
export const calendarDiscoveryLimitationSchema = z.enum(['page-limit', 'calendar-limit', 'byte-limit',
  'provider-error', 'unsupported-entry', 'primary-missing', 'stale']);
const snapshotObject = z.object({ schemaVersion: z.literal(2), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), discoveryRevision: z.number().int().positive(),
  entries: z.array(calendarDiscoveryEntrySchema).max(100), fetchedAt: isoDateSchema, expiresAt: isoDateSchema,
  complete: z.boolean(), truncated: z.boolean(), nextPageToken: z.string().min(1).max(2048).nullable(),
  limitations: z.array(calendarDiscoveryLimitationSchema).max(7),
  retentionPolicyId: idSchema.nullable(), retentionExpiresAt: isoDateSchema,
}).strict();
export const calendarDiscoverySnapshotSchema = snapshotObject.refine(v => {
  const lifetime = Date.parse(v.expiresAt) - Date.parse(v.fetchedAt);
  return lifetime >= 0 && lifetime <= 300000 && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 262144
    && Date.parse(v.expiresAt) <= Date.parse(v.retentionExpiresAt)
    && (v.retentionPolicyId !== null || lifetime === 0)
    && new Set(v.entries.map(e => e.calendarId)).size === v.entries.length
    && v.entries.filter(e => e.primary).length <= 1
    && (!v.complete || (!v.truncated && v.nextPageToken === null && !v.limitations.length))
    && (v.entries.some(e => e.primary) || (!v.complete && v.limitations.includes('primary-missing')))
    && (!v.truncated || !v.complete);
});
export type CalendarDiscoverySnapshot = z.infer<typeof calendarDiscoverySnapshotSchema>;
export function primaryCalendarId(snapshot: CalendarDiscoverySnapshot): string | null {
  return snapshot.entries.find(e => e.primary)?.calendarId ?? null;
}
export const calendarDefaultSettingSchema = z.object({ defaultCalendarId: calendarCanonicalIdSchema.nullable(),
  defaultSettingRevision: z.number().int().positive() }).strict();
export const calendarAccountBindingSchema = z.object({ userId: idSchema, connectionId: idSchema,
  connectionRevision: z.number().int().positive(), googleSubjectId: z.string().min(1).max(255) }).strict();
export type CalendarAccountBinding = z.infer<typeof calendarAccountBindingSchema>;
export const calendarResolvedTargetSchema = calendarAccountBindingSchema.extend({
  calendarId: calendarCanonicalIdSchema, calendarLabel: z.string().min(1).max(200),
  targetRevision: z.number().int().positive(), discoveryRevision: z.number().int().positive(),
  selectedBy: z.enum(['explicit', 'saved-default', 'primary', 'proposal']), accessRole: calendarRoleSchema,
  privateAccess: z.boolean(), capabilities: calendarCapabilitiesSchema, verifiedAt: isoDateSchema,
  proofRevision: z.literal('google-calendar.multi.v2'),
}).strict().refine(v => (!v.capabilities.createEvents || ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(v.accessRole))
  && (!v.capabilities.readEvents || v.accessRole !== 'freeBusyReader')
  && (!['reader', 'freeBusyReader', 'writerWithoutPrivateAccess'].includes(v.accessRole) || !v.privateAccess));
export type CalendarResolvedTarget = z.infer<typeof calendarResolvedTargetSchema>;
export const calendarConnectionV2Schema = z.object({ schemaVersion: z.literal(2), userId: idSchema,
  provider: z.literal('google-calendar'), connectionId: idSchema, revision: z.number().int().positive(),
  connectionRevision: z.number().int().positive(), credentialVersion: z.number().int().positive(),
  googleSubjectId: z.string().min(1).max(255), accountEmail: z.string().email().max(320).nullable(),
  enabled: z.boolean(), status: z.enum(['connected', 'disconnected', 'reconnect-required', 'degraded']),
  credentials: z.object({ access: encryptedCalendarSecretSchema.nullable(),
    refresh: encryptedCalendarSecretSchema }).strict().nullable(), tokenExpiresAt: isoDateSchema.nullable(),
  grantedScopes: calendarGrantSchema, updatedAt: isoDateSchema,
  defaultSetting: calendarDefaultSettingSchema, discovery: calendarDiscoverySnapshotSchema.nullable(),
}).strict().refine(v => (v.status !== 'connected' || (v.credentials !== null
    && calendarGrantStatus(v.grantedScopes).state === 'complete'))
  && (v.status !== 'disconnected' || (v.credentials === null && !v.enabled && v.discovery === null))
  && (v.discovery === null || (v.discovery.connectionId === v.connectionId
    && v.discovery.connectionRevision === v.connectionRevision
    && v.discovery.retentionPolicyId !== null
    && Date.parse(v.discovery.expiresAt) > Date.parse(v.discovery.fetchedAt)))
  && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 262144);
export type CalendarConnectionRecordV2 = z.infer<typeof calendarConnectionV2Schema>;
export interface CalendarConnectionStoreV2 {
  get(userId: string): Promise<CalendarConnectionRecord | CalendarConnectionRecordV2 | null>;
  create(record: CalendarConnectionRecordV2): Promise<{ outcome: 'confirmed'; record: CalendarConnectionRecordV2 }
    | { outcome: 'conflict'; currentRevision: number; currentDefaultSettingRevision: number }
    | { outcome: 'uncertain' }>;
  compareAndSwap(input: { userId: string; expectedRevision: number;
    expectedConnectionRevision: number; expectedDefaultSettingRevision: number;
    next: CalendarConnectionRecordV2 }): Promise<
      { outcome: 'confirmed'; record: CalendarConnectionRecordV2 }
      | { outcome: 'conflict'; currentRevision: number; currentDefaultSettingRevision: number }
      | { outcome: 'uncertain' }>;
}
export type CalendarProviderContext = {
  account: CalendarAccountBinding; accessToken: string; signal: AbortSignal;
  grantedScopes: readonly string[]; policyAllows: boolean;
  retentionPolicy: { policyId: string; expiresAt: string } | null;
  deadlineAt: string; now: string;
  consumeRequest: (kind: 'discovery' | 'availability' | 'preflight' | 'capability-recheck') => Promise<void>;
};
export interface CalendarDiscoveryPort {
  discover(input: CalendarProviderContext & { mode: 'in-turn' | 'out-of-turn';
    discoveryRevision: number; limits: { retainedCalendars: number; pageDeliveries: number;
      snapshotBytes: number; freshnessMs: number } }): Promise<CalendarDiscoverySnapshot>;
  checkTarget?(input: CalendarProviderContext & { calendarId: string }): Promise<CalendarDiscoveryEntry | null>;
}
export const calendarConnectionTransitionV2Schema = z.object({ previous: calendarConnectionV2Schema,
  next: calendarConnectionV2Schema }).strict().refine(({ previous: p, next: n }) => {
  const replaced = p.connectionId !== n.connectionId || p.googleSubjectId !== n.googleSubjectId;
  const sameAuthority = !replaced && p.enabled === n.enabled && p.status === n.status
    && JSON.stringify([...p.grantedScopes].sort()) === JSON.stringify([...n.grantedScopes].sort());
  const defaultChanged = replaced || p.defaultSetting.defaultCalendarId !== n.defaultSetting.defaultCalendarId;
  return p.userId === n.userId && n.revision === p.revision + 1
    && (sameAuthority ? n.connectionRevision === p.connectionRevision
      : n.connectionRevision >= p.connectionRevision && n.connectionRevision <= p.connectionRevision + 1)
    && (!replaced || n.connectionRevision === p.connectionRevision + 1)
    && n.defaultSetting.defaultSettingRevision === p.defaultSetting.defaultSettingRevision + (defaultChanged ? 1 : 0)
    && (!replaced || (n.defaultSetting.defaultCalendarId === null && n.discovery === null));
});

export const calendarListCalendarsResultSchema = z.object({ schemaVersion: z.literal(2),
  tool: z.literal('calendar_list_calendars'), calendars: z.array(calendarDiscoveryEntrySchema).max(20),
  discoveryRevision: z.number().int().positive(), fetchedAt: isoDateSchema, expiresAt: isoDateSchema,
  complete: z.boolean(), truncated: z.boolean(), nextPageToken: z.string().min(1).max(2048).nullable(),
  limitations: z.array(calendarDiscoveryLimitationSchema).max(7),
}).strict().refine(v => Date.parse(v.expiresAt) >= Date.parse(v.fetchedAt)
  && Date.parse(v.expiresAt) - Date.parse(v.fetchedAt) <= 300000
  && (!v.complete || (!v.truncated && v.limitations.length === 0))
  && new Set(v.calendars.map(c => c.calendarId)).size === v.calendars.length
  && v.calendars.filter(c => c.primary).length <= 1
  && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 15360);
