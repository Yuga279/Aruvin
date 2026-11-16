/**
 * ============================================================================
 * FILE: calendar-multi-tools.spec.ts
 * LOCATION: backend/test/contracts/calendar-multi-tools.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Google Calendar Phase 2 tool catalogue, strict selectors, and result union contracts.
 *
 * ROLE IN PROJECT:
 *    Ensures all five v2 tools are frozen with strict inputs, selectors admit no model authority,
 *    and repair diagnostics paths cover all new property keys.
 *
 * KEY COMPONENTS:
 *    - CALENDAR_TOOLS / CALENDAR_TOOLS_V1
 *    - calendarInputSchemas / calendarCallSchema
 *    - calendarResultSchema / calendarResultV1Schema / calendarResultV2Schema
 *    - forbiddenCalendarKeys / repairDiagnosticsSchema
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { CALENDAR_TOOLS, CALENDAR_TOOLS_V1, calendarInputSchemas, calendarCallSchema,
  calendarResultSchema, calendarResultV1Schema, forbiddenCalendarKeys,
} from '../../src/contracts/calendar-tools.js';
import { repairDiagnosticsSchema } from '../../src/contracts/calendar-model.js';
import { entry, action, at, until } from './calendar-multi-fixtures.js';

it('freezes five strict v2 tools and admits selectors without model authority', () => {
  expect(CALENDAR_TOOLS.map(t => t.name)).toEqual(['calendar_list_events', 'calendar_get_event',
    'calendar_create_event', 'calendar_list_calendars', 'calendar_check_availability']);
  expect(CALENDAR_TOOLS.every(t => t.revision === 'google-calendar.v2')).toBe(true);
  expect(CALENDAR_TOOLS.find(t => t.name === 'calendar_create_event')?.deliveryRetry).toBe('never');
  expect(CALENDAR_TOOLS.find(t => t.name === 'calendar_create_event')?.annotations.idempotentHint).toBe(false);
  expect(CALENDAR_TOOLS_V1).toHaveLength(3);
  const samples = { calendar_list_events: { calendarId: entry.calendarId, timeMin: at,
    timeMax: until, maxResults: 20 }, calendar_get_event: { calendarId: entry.calendarId, eventId: 'abcde' },
    calendar_create_event: action, calendar_list_calendars: {},
    calendar_check_availability: { timeMin: at, timeMax: until, timeZone: 'Europe/London',
      calendarIds: [entry.calendarId] } };
  for (const definition of CALENDAR_TOOLS) {
    expect(definition.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(definition.inputSchema.properties))
      .toEqual(Object.keys(calendarInputSchemas[definition.name].shape));
    expect(calendarCallSchema.safeParse({ name: definition.name,
      arguments: samples[definition.name] }).success).toBe(true);
    for (const key of ['connectionId', 'targetRevision', 'attendees', 'accessToken', 'userId',
      'confirmed', 'proposalId', 'conflictAccepted', 'defaultSettingRevision']) {
      expect(calendarInputSchemas[definition.name].safeParse({ ...samples[definition.name], [key]: 'forged' }).success).toBe(false);
    }
  }
  expect(forbiddenCalendarKeys).not.toContain('calendarId');
  expect(forbiddenCalendarKeys).toContain('targetRevision');
  expect(calendarInputSchemas.calendar_list_calendars.safeParse({ calendarId: entry.calendarId }).success).toBe(false);
  expect(calendarInputSchemas.calendar_check_availability.safeParse({ ...samples.calendar_check_availability,
    calendarIds: Array.from({ length: 101 }, (_, i) => `c${i}`) }).success).toBe(false);
  for (const path of ['calendarId', 'calendarIds', 'pageToken', 'timeMin', 'timeMax', 'timeZone']) {
    expect(repairDiagnosticsSchema.safeParse([{ path, code: 'wrong-type', expected: 'string' }]).success).toBe(true);
  }
  const page = { schemaVersion: 2, tool: 'calendar_list_calendars', calendars: [entry],
    discoveryRevision: 1, fetchedAt: at, expiresAt: until, complete: true,
    truncated: false, limitations: [], nextPageToken: null };
  expect(calendarResultSchema.safeParse(page).success).toBe(true);
  expect(calendarResultV1Schema.safeParse(page).success).toBe(false);
  expect(calendarResultSchema.safeParse({ ...page, calendars: Array(21).fill(entry) }).success).toBe(false);
});
