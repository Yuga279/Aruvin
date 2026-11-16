/**
 * ============================================================================
 * FILE: calendar-multi-policy.spec.ts
 * LOCATION: backend/test/contracts/calendar-multi-policy.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Google Calendar Phase 2 policy, scopes, ceilings, and grant status contracts.
 *
 * ROLE IN PROJECT:
 *    Ensures additive Phase 2 policy constants and ceilings are frozen without certifying old grants.
 *
 * KEY COMPONENTS:
 *    - freezes v2 scopes and all new ceilings without certifying old grants
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { CALENDAR_SCOPES, CALENDAR_SCOPES_V1, CALENDAR_TOOL_REVISION,
  CALENDAR_PROOF_REVISION, CALENDAR_CURSOR_VERSION, CALENDAR_LIMITS,
  calendarLimitsSchema, calendarGrantSchema, calendarGrantStatus,
} from '../../src/contracts/calendar-policy.js';

it('freezes v2 scopes and all new ceilings without certifying old grants', () => {
  expect(CALENDAR_TOOL_REVISION).toBe('google-calendar.v2');
  expect(CALENDAR_PROOF_REVISION).toBe('google-calendar.multi.v2');
  expect(CALENDAR_CURSOR_VERSION).toBe(2);
  expect(CALENDAR_SCOPES).toEqual(['openid', 'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.freebusy']);
  expect(calendarGrantStatus(CALENDAR_SCOPES_V1).state).toBe('reconnect-required');
  expect(calendarGrantStatus(CALENDAR_SCOPES).state).toBe('complete');
  expect(calendarGrantStatus(CALENDAR_SCOPES.slice(0, -1)).missingScopes)
    .toEqual(['https://www.googleapis.com/auth/calendar.freebusy']);
  for (const forbidden of ['calendar', 'calendar.readonly']) {
    expect(calendarGrantSchema.safeParse([
      ...CALENDAR_SCOPES, `https://www.googleapis.com/auth/${forbidden}`]).success).toBe(false);
  }
  const ceilings = { retainedCalendars: 100, calendarsPerPage: 20,
    discoveryPagesInTurn: 2, discoveryPagesOutOfTurn: 10,
    availabilityCalendars: 100, availabilityBatchCalendars: 50,
    availabilityBatches: 2, busyIntervalsIngested: 2000,
    snapshotBytes: 262144, discoveryFreshnessMs: 300000, proposalLifetimeMs: 600000 };
  expect(CALENDAR_LIMITS).toMatchObject(ceilings);
  for (const [key, ceiling] of Object.entries(ceilings)) {
    expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: ceiling }).success).toBe(true);
    expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: ceiling + 1 }).success).toBe(false);
    expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: 0 }).success).toBe(false);
  }
  expect(CALENDAR_LIMITS.resultBytes).toBe(16384);
  expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, retainedCalendars: 3 }).success).toBe(true);
  expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, arbitraryLimit: 1 }).success).toBe(false);
});
