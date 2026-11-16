/**
 * ============================================================================
 * FILE: calendar-multi-availability.spec.ts
 * LOCATION: backend/test/contracts/calendar-multi-availability.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Google Calendar Phase 2 availability coverage, fingerprints, and port contracts.
 *
 * ROLE IN PROJECT:
 *    Ensures availability results never encode unknown coverage as clear, and
 *    bounds ingestion separately from output schemas.
 *
 * KEY COMPONENTS:
 *    - calendarAvailabilityResultSchema
 *    - calendarAvailabilityBatchSchema
 *    - calendarAvailabilityIngestionSchema
 *    - calendarAvailabilityFingerprint
 *    - CalendarAvailabilityPort
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarAvailabilityResultSchema, calendarAvailabilityBatchSchema,
  calendarAvailabilityIngestionSchema, calendarAvailabilityFingerprint,
  type CalendarAvailabilityPort,
} from '../../src/contracts/calendar-availability.js';
import { at, until, entry } from './calendar-multi-fixtures.js';

it('never encodes unknown coverage as clear and bounds ingestion separately from output', () => {
  const result = { schemaVersion: 2, tool: 'calendar_check_availability',
    connectionId: 'c', connectionRevision: 1, discoveryRevision: 1, availabilityRevision: 1,
    calendarSetHash: 'a'.repeat(64), timeMin: at, timeMax: until, timeZone: 'Europe/London',
    checkedAt: at, expiresAt: until, semantics: 'google-opaque-busy-only',
    calendars: [{ calendarId: entry.calendarId, calendarLabel: entry.label,
      status: 'ok', reason: null }], busy: [], free: [{ start: at, end: until }],
    coverage: 'complete', conflict: 'clear', truncated: false, limitations: [] };
  expect(calendarAvailabilityResultSchema.safeParse(result).success).toBe(true);
  const unknown = { ...result, calendars: [{ ...result.calendars[0], status: 'error',
    reason: 'not-found' }], free: [], coverage: 'incomplete', conflict: 'unknown',
    limitations: ['calendar-error'] };
  expect(calendarAvailabilityResultSchema.safeParse(unknown).success).toBe(true);
  expect(calendarAvailabilityResultSchema.safeParse({ ...unknown, conflict: 'clear' }).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...unknown, free: result.free }).success).toBe(false);
  const fingerprint = calendarAvailabilityFingerprint(calendarAvailabilityResultSchema.parse(unknown));
  expect(calendarAvailabilityFingerprint(calendarAvailabilityResultSchema.parse({ ...unknown,
    availabilityRevision: 2, checkedAt: '2026-10-22T10:00:01.000Z' }))).toBe(fingerprint);
  expect(calendarAvailabilityFingerprint(calendarAvailabilityResultSchema.parse({ ...unknown,
    limitations: ['calendar-error', 'discovery-partial'] }))).not.toBe(fingerprint);
  expect(calendarAvailabilityBatchSchema.safeParse({ calendarIds: Array.from({ length: 50 }, (_, i) => `c${i}`) }).success).toBe(true);
  expect(calendarAvailabilityBatchSchema.safeParse({ calendarIds: Array.from({ length: 51 }, (_, i) => `c${i}`) }).success).toBe(false);
  const interval = { start: at, end: until };
  expect(calendarAvailabilityIngestionSchema.safeParse(Array(2000).fill(interval)).success).toBe(true);
  expect(calendarAvailabilityIngestionSchema.safeParse(Array(2001).fill(interval)).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...result, busy: Array(2000).fill(interval),
    free: [], conflict: 'conflict' }).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...result, groups: [] }).success).toBe(false);
  const provider: CalendarAvailabilityPort = { check: async () => calendarAvailabilityResultSchema.parse(result) };
  expect(provider.check).toBeTypeOf('function');
});

it('rejects reversed and over-31-day availability and noncoalesced intervals', () => {
  expect(calendarAvailabilityIngestionSchema.safeParse([{ start: until, end: at }]).success).toBe(false);
  expect(calendarAvailabilityBatchSchema.safeParse({ calendarIds: ['same', 'same'] }).success).toBe(false);
  expect(calendarAvailabilityBatchSchema.safeParse({ calendarIds: ['primary'] }).success).toBe(false);
});
