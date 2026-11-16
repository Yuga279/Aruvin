/**
 * ============================================================================
 * FILE: calendar-wire.ts
 * LOCATION: backend/src/contracts/calendar-wire.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define versioned HTTP, SSE, and turn-state wire schemas for Google Calendar.
 *
 * ROLE IN PROJECT:
 *    Establishes strict validation boundaries for client settings, status,
 *    SSE stream envelopes, and turn operation states across v1, v2, and v3.
 *
 * KEY COMPONENTS:
 *    - CALENDAR_API_ROUTES: HTTP endpoint routes for Google Calendar plugin.
 *    - calendarStatusResponseSchema / calendarStatusV2ResponseSchema: Status payloads.
 *    - calendarTurnStateV2Schema / calendarClarificationWireSchema: Turn state payloads.
 *    - calendarMultiStreamEnvelopeSchema: v3 SSE stream envelope.
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { operationStateSchema, operationStateV2Schema } from './calendar-operations.js';
import {
  calendarCanonicalIdSchema,
  calendarDefaultSettingSchema,
  calendarListCalendarsResultSchema,
} from './calendar-discovery.js';
import { streamEnvelopeSchema, streamEventSchema } from './stream.js';
import { calendarViewSchema, calendarProposalViewSchema } from './calendar-view.js';
import { safeCalendarLinkSchema } from './calendar-link.js';

export { safeCalendarLinkSchema } from './calendar-link.js';

export const CALENDAR_STATUS_PROTOCOL_V2 = 2 as const;
export const CALENDAR_STREAM_PROTOCOL_V2 = 3 as const;

export const CALENDAR_API_ROUTES = {
  status: '/plugins/google-calendar/status',
  settings: '/plugins/google-calendar/settings',
  oauthStart: '/plugins/google-calendar/oauth/start',
  oauthCallback: '/plugins/google-calendar/oauth/callback',
  disconnect: '/plugins/google-calendar/disconnect',
  calendars: '/plugins/google-calendar/calendars',
  calendarsRefresh: '/plugins/google-calendar/calendars/refresh',
} as const;

export const calendarSettingsRequestSchema = z.object({ enabled: z.boolean() }).strict();
export const calendarOAuthStartRequestSchema = z.object({}).strict();
export const calendarOAuthStartResponseSchema = z.object({ authorizationUrl: z.string().max(8192).url().refine(v => {
  const u = new URL(v);
  return u.origin === 'https://accounts.google.com' && u.pathname === '/o/oauth2/v2/auth'
    && !u.username && !u.password && !u.hash;
}) }).strict();
export const calendarDisconnectRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('local') }).strict(),
  z.object({ mode: z.literal('revoke-google-grant'), acknowledgeProjectWideRevocation: z.literal(true) }).strict(),
]);
export const calendarDisconnectResponseSchema = z.object({ disconnected: z.literal(true),
  remoteRevocation: z.enum(['not-requested', 'confirmed', 'failed', 'unknown']) }).strict();
export const calendarStatusResponseSchema = z.object({ protocolVersion: z.literal(1),
  state: z.enum(['disabled', 'setup-required', 'connected', 'reconnect-required', 'degraded']),
  enabled: z.boolean(), accountEmail: z.string().email().max(320).nullable(),
  targetCalendarId: z.string().min(1).max(1024).nullable(),
  processingDisclosure: z.object({ policyId: idSchema, processors: z.literal('Google, OpenRouter and the configured model provider'),
    dataCollection: z.literal('deny') }).strict().nullable(),
}).strict();
export type CalendarPublicStatus = z.infer<typeof calendarStatusResponseSchema>;
export const calendarTurnStateSchema = z.object({ operationId: idSchema, state: operationStateSchema,
  narration: z.enum(['pending', 'completed', 'failed', 'interrupted']),
  retryAction: z.enum(['none', 'resume-reconciliation', 'reconnect', 'clarify', 'blocked-expired']),
  receipt: z.object({ durable: z.literal(true), eventId: z.string().min(5).max(1024),
    htmlLink: safeCalendarLinkSchema.nullable(), expiresAt: isoDateSchema.nullable() }).strict().nullable(),
}).strict().refine(v => (v.state === 'succeeded') === (v.receipt !== null)
  && (v.receipt?.htmlLink == null || v.receipt.expiresAt !== null));
export type CalendarTurnState = z.infer<typeof calendarTurnStateSchema>;
export const calendarProgressEventSchema = z.object({ type: z.literal('calendar-progress'),
  phase: z.enum(['validating', 'repairing', 'executing', 'reconciling']) }).strict();
export const calendarOperationWireEventSchema = z.object({ type: z.literal('calendar-operation'),
  operation: calendarTurnStateSchema }).strict();
export const calendarStreamEnvelopeSchema = z.object({ protocolVersion: z.literal(2),
  sessionId: idSchema, turnId: idSchema, attemptId: idSchema, sequence: sequenceSchema,
  event: z.union([streamEventSchema, calendarProgressEventSchema, calendarOperationWireEventSchema]),
}).strict();
export type CalendarStreamEnvelope = z.infer<typeof calendarStreamEnvelopeSchema>;

export const calendarSettingsV2RequestSchema = z.object({
  enabled: z.boolean().optional(),
  defaultSetting: z.object({
    calendarId: calendarCanonicalIdSchema.nullable(),
    expectedRevision: z.number().int().positive(),
    expectedConnectionRevision: z.number().int().positive(),
  }).strict().optional(),
}).strict().refine(v => v.enabled !== undefined || v.defaultSetting !== undefined);

export const calendarCalendarsQuerySchema = z.object({ pageToken: z.string().min(1).max(2048).optional() }).strict();
export const calendarCalendarsResponseSchema = z.object({
  protocolVersion: z.literal(2),
  page: calendarListCalendarsResultSchema,
}).strict();
export const calendarRefreshRequestSchema = z.object({ expectedConnectionRevision: z.number().int().positive() }).strict();

export const calendarStatusV2ResponseSchema = calendarStatusResponseSchema.omit({ targetCalendarId: true }).extend({
  protocolVersion: z.literal(2),
  connectionRevision: z.number().int().positive().nullable(),
  defaultSetting: calendarDefaultSettingSchema.nullable(),
  primaryCalendarId: calendarCanonicalIdSchema.nullable(),
  discovery: z.object({
    discoveryRevision: z.number().int().positive(),
    fetchedAt: isoDateSchema,
    expiresAt: isoDateSchema,
    complete: z.boolean(),
    truncated: z.boolean(),
    stale: z.boolean(),
  }).strict().nullable(),
  missingScopes: z.array(z.string().min(1).max(200)).max(5),
}).strict().refine(v => v.state !== 'connected' || v.missingScopes.length === 0);

export const calendarTurnStateV2Schema = z.object({
  schemaVersion: z.literal(2),
  operationId: idSchema,
  proposalId: idSchema.nullable().optional(),
  intentId: idSchema.optional(),
  state: operationStateV2Schema,
  narration: z.enum(['pending', 'completed', 'failed', 'interrupted']),
  retryAction: z.enum(['none', 'resume-reconciliation', 'reconnect', 'clarify', 'blocked-expired']),
  receipt: z.object({
    durable: z.literal(true),
    eventId: z.string().min(5).max(1024),
    htmlLink: safeCalendarLinkSchema.nullable(),
    expiresAt: isoDateSchema.nullable(),
    calendarLabel: z.string().min(1).max(200).nullable(),
  }).strict().nullable(),
}).strict().refine(v => (v.state === 'succeeded') === (v.receipt !== null)
  && ((v.receipt?.htmlLink == null && v.receipt?.calendarLabel == null) || v.receipt?.expiresAt != null));

export const calendarCompatibleTurnStateSchema = z.union([calendarTurnStateSchema, calendarTurnStateV2Schema]);

export const calendarClarificationWireSchema = z.object({
  type: z.literal('calendar-clarification'),
  proposalId: idSchema,
  proposalRevision: z.number().int().positive().optional(),
  expiresAt: isoDateSchema,
  reason: z.enum(['target', 'details', 'conflict', 'coverage']),
  message: z.string().min(1).max(1000),
  candidates: z.array(z.object({
    calendarId: calendarCanonicalIdSchema,
    label: z.string().min(1).max(200),
    role: z.enum(['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader']),
  }).strict()).max(20),
  view: calendarProposalViewSchema.optional(),
}).strict();

export const calendarViewEventSchema = z.object({ type: z.literal('calendar-view'), view: calendarViewSchema }).strict();

export const calendarPresentationEventSchema = z.union([
  calendarProgressEventSchema,
  z.object({ type: z.literal('calendar-operation'), operation: calendarTurnStateV2Schema }).strict(),
  calendarClarificationWireSchema,
  calendarViewEventSchema,
]);
export type CalendarPresentationEvent = z.infer<typeof calendarPresentationEventSchema>;
export function isCalendarPresentationEvent(value: unknown): value is CalendarPresentationEvent {
  return calendarPresentationEventSchema.safeParse(value).success;
}

export const calendarMultiStreamEnvelopeSchema = z.object({
  protocolVersion: z.literal(3),
  sessionId: idSchema,
  turnId: idSchema,
  attemptId: idSchema,
  sequence: sequenceSchema,
  event: z.union([
    streamEventSchema,
    calendarProgressEventSchema,
    z.object({ type: z.literal('calendar-operation'), operation: calendarTurnStateV2Schema }).strict(),
    calendarClarificationWireSchema,
    calendarViewEventSchema,
  ]),
}).strict().refine(v => Buffer.byteLength(JSON.stringify(v), 'utf8') <= 16384);

export const calendarCompatibleEnvelopeSchema = z.union([
  streamEnvelopeSchema,
  calendarStreamEnvelopeSchema,
  calendarMultiStreamEnvelopeSchema,
]);

export function parseCalendarCompatibleFrame(line: string): z.infer<typeof calendarCompatibleEnvelopeSchema> {
  const value = line.trim();
  if (!value.startsWith('data:')) throw new Error('invalid_sse_line');
  return calendarCompatibleEnvelopeSchema.parse(JSON.parse(value.slice(5).trim()));
}
