/**
 * ============================================================================
 * FILE: calendar-view.ts
 * LOCATION: backend/src/contracts/calendar-view.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define bounded, data-only Calendar presentation views.
 *
 * ROLE IN PROJECT:
 *    Supplies strict agenda, proposal, outcome, and notice snapshots for SSE,
 *    message archives, and voice frames without model-authored calendar facts.
 *
 * KEY COMPONENTS:
 *    - calendarViewSchema: Strict union capped at 14,336 UTF-8 bytes.
 *    - calendarAgendaViewSchema / calendarProposalViewSchema: Presentation facts.
 *    - calendarOutcomeViewSchema / calendarNoticeViewSchema: Truthful outcomes.
 *    - CalendarView / CalendarProposalView: Exported view types.
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { calendarCanonicalIdSchema } from './calendar-discovery.js';
import { calendarInputSchemas } from './calendar-tools.js';
import { operationStateV2Schema } from './calendar-operations.js';
import { safeCalendarLinkSchema } from './calendar-link.js';

export const CALENDAR_VIEW_MAX_BYTES = 14336;
const label = z.string().min(1).max(200);
const date = z.string().date();
const zone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
});
export const calendarViewTargetSchema = z.object({ calendarId: calendarCanonicalIdSchema,
  calendarLabel: label.nullable(), labelExpiresAt: isoDateSchema.nullable() }).strict();
const entryObject = z.object({ eventId: z.string().min(1).max(1024), summary: z.string().max(200),
  start: z.string().min(1).max(96), end: z.string().min(1).max(96), allDay: z.boolean(),
  timeZone: zone.nullable(), status: z.enum(['confirmed', 'tentative', 'cancelled']),
  location: z.string().max(500).optional(), description: z.string().max(2000).optional(),
  htmlLink: safeCalendarLinkSchema.nullable() }).strict();
export const calendarViewEntrySchema = entryObject.refine(v => v.allDay
  ? date.safeParse(v.start).success && date.safeParse(v.end).success && v.end > v.start
  : z.string().datetime({ offset: true }).safeParse(v.start).success
    && z.string().datetime({ offset: true }).safeParse(v.end).success
    && Date.parse(v.end) > Date.parse(v.start));
export const calendarAgendaViewSchema = z.object({ viewVersion: z.literal(1), kind: z.literal('agenda'),
  target: calendarViewTargetSchema,
  requested: z.object({ timeMin: isoDateSchema, timeMax: isoDateSchema, displayTimeZone: zone }).strict().nullable(),
  entries: z.array(calendarViewEntrySchema).max(20), nextPageToken: z.string().min(1).max(2048).nullable(),
  truncated: z.boolean(), detailsTrimmed: z.boolean(), entriesOmitted: z.number().int().min(0).max(20),
  expiresAt: isoDateSchema }).strict();
export const calendarProposalViewSchema = z.object({ viewVersion: z.literal(1), kind: z.literal('proposal'),
  proposalId: idSchema, intentId: idSchema, revision: z.number().int().positive(), expiresAt: isoDateSchema,
  reason: z.enum(['target', 'details', 'conflict', 'coverage']),
  target: calendarViewTargetSchema.nullable(), action: calendarInputSchemas.calendar_create_event.nullable(),
  candidates: z.array(z.object({ calendarId: calendarCanonicalIdSchema, label,
    role: z.enum(['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader']) }).strict()).max(20),
}).strict();
export const calendarOutcomeViewSchema = z.object({ viewVersion: z.literal(1), kind: z.literal('outcome'),
  operationId: idSchema, proposalId: idSchema.nullable(), intentId: idSchema,
  state: operationStateV2Schema,
  retryAction: z.enum(['none', 'resume-reconciliation', 'reconnect', 'clarify', 'blocked-expired']),
  receipt: z.object({ durable: z.literal(true), eventId: z.string().min(5).max(1024),
    htmlLink: safeCalendarLinkSchema.nullable(), calendarLabel: label.nullable(),
    expiresAt: isoDateSchema.nullable() }).strict().nullable(),
}).strict();
export const calendarNoticeViewSchema = z.object({ viewVersion: z.literal(1), kind: z.literal('notice'),
  state: z.enum(['failed', 'unavailable', 'clarification', 'cancelled', 'expired', 'read-completed']),
  message: z.string().min(1).max(1000), proposalId: idSchema.nullable(), intentId: idSchema.nullable(),
  tool: z.enum(['calendar_list_events', 'calendar_get_event', 'calendar_list_calendars',
    'calendar_check_availability']).nullable(),
  coverage: z.enum(['complete', 'incomplete']).nullable(),
  conflict: z.enum(['clear', 'conflict', 'unknown']).nullable(),
  limitations: z.array(z.string().min(1).max(100)).max(8),
}).strict();
export const calendarViewSchema = z.union([calendarAgendaViewSchema, calendarProposalViewSchema,
  calendarOutcomeViewSchema, calendarNoticeViewSchema]).superRefine((v, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (Buffer.byteLength(JSON.stringify(v), 'utf8') > CALENDAR_VIEW_MAX_BYTES) issue('Calendar view exceeds UTF-8 byte limit.');
  if (v.kind === 'agenda') {
    if (v.requested && Date.parse(v.requested.timeMax) <= Date.parse(v.requested.timeMin)) issue('Invalid requested range.');
    if ((v.entriesOmitted > 0 || v.nextPageToken !== null) && !v.truncated) issue('Incomplete agenda must be labelled.');
    if (v.target.calendarLabel !== null && (v.target.labelExpiresAt === null
      || Date.parse(v.target.labelExpiresAt) > Date.parse(v.expiresAt))) issue('Label requires bounded expiry.');
  }
  if (v.kind === 'outcome' && ((v.state === 'succeeded') !== (v.receipt !== null)
    || ((v.receipt?.htmlLink != null || v.receipt?.calendarLabel != null) && v.receipt.expiresAt === null)))
    issue('Receipt requires durable success and bounded expiry.');
});
export type CalendarView = z.infer<typeof calendarViewSchema>;
export type CalendarProposalView = Extract<CalendarView, { kind: 'proposal' }>;
