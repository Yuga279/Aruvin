/**
 * ============================================================================
 * FILE: calendar-availability.ts
 * LOCATION: backend/src/contracts/calendar-availability.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define Google Calendar Phase 2 availability, intervals, coverage, and provider contracts.
 *
 * ROLE IN PROJECT:
 *    Enforces honest availability projections (busy/free intervals, coverage status),
 *    computes material conflict fingerprints, and defines provider availability ports.
 *
 * KEY COMPONENTS:
 *    - calendarIntervalSchema / calendarAvailabilityBatchSchema / calendarAvailabilityIngestionSchema
 *    - calendarAvailabilityResultSchema / calendarCheckAvailabilityResultSchema
 *    - calendarAvailabilityFingerprint
 *    - CalendarAvailabilityPort
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { idSchema, isoDateSchema } from './identifiers.js';
import { sha256Schema } from './calendar-connections.js';
import { calendarCanonicalIdSchema, type CalendarDiscoverySnapshot,
  type CalendarProviderContext } from './calendar-discovery.js';

export const calendarIntervalSchema = z.object({ start: isoDateSchema, end: isoDateSchema })
  .strict().refine(v => Date.parse(v.end) > Date.parse(v.start));
export const calendarAvailabilityBatchSchema = z.object({
  calendarIds: z.array(calendarCanonicalIdSchema).min(1).max(50)
    .refine(v => new Set(v).size === v.length),
}).strict();
export const calendarAvailabilityIngestionSchema = z.array(calendarIntervalSchema).max(2000);
export const calendarCoverageReasonSchema = z.enum(['not-found', 'forbidden', 'rate-limit', 'quota',
  'provider-error', 'missing-response', 'unsupported', 'stale']);
export const calendarAvailabilityLimitationSchema = z.enum(['calendar-error', 'discovery-partial',
  'discovery-stale', 'calendar-limit', 'interval-limit', 'byte-limit', 'deadline', 'request-limit']);
export const calendarAvailabilityResultSchema = z.object({ schemaVersion: z.literal(2),
  tool: z.literal('calendar_check_availability'), connectionId: idSchema,
  connectionRevision: z.number().int().positive(), discoveryRevision: z.number().int().positive(),
  availabilityRevision: z.number().int().positive(), calendarSetHash: sha256Schema,
  timeMin: isoDateSchema, timeMax: isoDateSchema, timeZone: z.string().min(1).max(100),
  checkedAt: isoDateSchema, expiresAt: isoDateSchema,
  semantics: z.literal('google-opaque-busy-only'),
  calendars: z.array(z.object({ calendarId: calendarCanonicalIdSchema,
    calendarLabel: z.string().min(1).max(200), status: z.enum(['ok', 'error', 'unsupported', 'stale']),
    reason: calendarCoverageReasonSchema.nullable() }).strict()
    .refine(v => (v.status === 'ok') === (v.reason === null))).max(100),
  busy: z.array(calendarIntervalSchema).max(2000), free: z.array(calendarIntervalSchema).max(2001),
  coverage: z.enum(['complete', 'incomplete']), conflict: z.enum(['clear', 'conflict', 'unknown']),
  truncated: z.boolean(), limitations: z.array(calendarAvailabilityLimitationSchema).max(8),
}).strict().refine(v => {
  const low = Date.parse(v.timeMin), high = Date.parse(v.timeMax);
  const ttl = Date.parse(v.expiresAt) - Date.parse(v.checkedAt);
  const complete = v.coverage === 'complete';
  const ordered = (items: typeof v.busy) => items.every((b, i) => Date.parse(b.start) >= low
    && Date.parse(b.end) <= high && (i === 0 || Date.parse(items[i - 1].end) < Date.parse(b.start)));
  // ponytail: at most 2000 x 2001 comparisons; use a two-pointer scan if these ceilings grow.
  const overlap = v.busy.some(b => v.free.some(f => Date.parse(b.start) < Date.parse(f.end)
    && Date.parse(f.start) < Date.parse(b.end)));
  const partition = [...v.busy, ...v.free].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const fullRange = partition.length > 0 && Date.parse(partition[0].start) === low
    && Date.parse(partition[partition.length - 1].end) === high
    && partition.every((b, i) => i === 0 || Date.parse(partition[i - 1].end) === Date.parse(b.start));
  return high > low && high - low <= 31 * 86400000 && ttl >= 0 && ttl <= 300000
    && Buffer.byteLength(JSON.stringify(v), 'utf8') <= 15360
    && new Set(v.calendars.map(c => c.calendarId)).size === v.calendars.length
    && ordered(v.busy) && ordered(v.free) && !overlap
    && (!complete || (v.calendars.length > 0 && v.calendars.every(c => c.status === 'ok')
      && !v.truncated && v.limitations.length === 0))
    && (complete || (v.free.length === 0 && v.limitations.length > 0))
    && (v.busy.length > 0 ? v.conflict === 'conflict'
      : v.conflict === (complete ? 'clear' : 'unknown'))
    && (!complete || fullRange);
});
export const calendarCheckAvailabilityResultSchema = calendarAvailabilityResultSchema;
export type CalendarAvailabilityResult = z.infer<typeof calendarAvailabilityResultSchema>;
export function calendarAvailabilityFingerprint(v: CalendarAvailabilityResult): string {
  return createHash('sha256').update(JSON.stringify({ connectionId: v.connectionId,
    connectionRevision: v.connectionRevision, calendarSetHash: v.calendarSetHash,
    timeMin: Date.parse(v.timeMin), timeMax: Date.parse(v.timeMax),
    busy: v.busy.map(b => [Date.parse(b.start), Date.parse(b.end)]),
    coverage: v.coverage, truncated: v.truncated,
    limitations: [...v.limitations].sort(),
    calendars: v.calendars.map(c => ({ calendarId: c.calendarId, status: c.status, reason: c.reason }))
      .sort((a, b) => a.calendarId < b.calendarId ? -1 : a.calendarId > b.calendarId ? 1 : 0),
  }), 'utf8').digest('hex');
}
export interface CalendarAvailabilityPort {
  check(input: CalendarProviderContext & { snapshot: CalendarDiscoverySnapshot;
    calendarIds: readonly string[]; timeMin: string; timeMax: string; timeZone: string;
    availabilityRevision: number; purpose: 'availability' | 'preflight';
    limits: { batchCalendars: number; batches: number; busyIntervals: number;
      workingBytes: number; resultBytes: number } }): Promise<CalendarAvailabilityResult>;
}
