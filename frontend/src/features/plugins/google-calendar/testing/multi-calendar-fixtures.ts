/**
 * ============================================================================
 * FILE: multi-calendar-fixtures.ts
 * LOCATION: frontend/src/features/plugins/google-calendar/testing/multi-calendar-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide deterministic fixtures for Google Calendar multi-calendar protocol and UI testing.
 *
 * ROLE IN PROJECT:
 *    Supplies reusable, valid v2 status, calendar page, discovery entry, and v3 stream
 *    fixtures for unit, reducer, and browser tests without ad-hoc mocks.
 *
 * KEY COMPONENTS:
 *    - calendarEntry: Builds a valid CalendarDiscoveryEntry with optional overrides.
 *    - multiStatus: Builds a valid v2 CalendarPublicStatusV2 with optional overrides.
 *    - calendarPage: Builds a valid CalendarCalendarsResponse with optional overrides.
 * ============================================================================
 */

import type {
  CalendarPublicStatusV2,
  CalendarDiscoveryEntry,
  CalendarCalendarsResponse,
  CalendarTurnStateV2,
  CalendarClarificationEvent,
} from '../../../../api/calendar-protocol.ts';

export function calendarEntry(
  patch: Partial<CalendarDiscoveryEntry> = {},
): CalendarDiscoveryEntry {
  return {
    calendarId: 'team@example.com',
    label: 'Team',
    primary: false,
    accessRole: 'writer',
    privateAccess: true,
    timeZone: 'Europe/London',
    selected: true,
    hidden: false,
    deleted: false,
    capabilities: { readEvents: true, createEvents: true, availability: true },
    ...patch,
  };
}

export function multiStatus(
  patch: Partial<CalendarPublicStatusV2> = {},
): CalendarPublicStatusV2 {
  return {
    protocolVersion: 2,
    state: 'connected',
    enabled: true,
    accountEmail: 'operator@example.com',
    processingDisclosure: {
      policyId: 'policy-local-1',
      processors: 'Google, OpenRouter and the configured model provider',
      dataCollection: 'deny',
    },
    connectionRevision: 3,
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 7 },
    primaryCalendarId: 'primary-canonical@example.com',
    discovery: {
      discoveryRevision: 11,
      fetchedAt: '2026-10-24T10:00:00.000Z',
      expiresAt: '2026-10-24T10:05:00.000Z',
      complete: true,
      truncated: false,
      stale: false,
    },
    missingScopes: [],
    ...patch,
  };
}

export function calendarPage(
  patch: Partial<CalendarCalendarsResponse['page']> = {},
): CalendarCalendarsResponse {
  return {
    protocolVersion: 2,
    page: {
      schemaVersion: 2,
      tool: 'calendar_list_calendars',
      calendars: [calendarEntry()],
      discoveryRevision: 11,
      fetchedAt: '2026-10-24T10:00:00.000Z',
      expiresAt: '2026-10-24T10:05:00.000Z',
      complete: true,
      truncated: false,
      nextPageToken: null,
      limitations: [],
      ...patch,
    },
  };
}

export function createdOperation(): CalendarTurnStateV2 {
  return {
    schemaVersion: 2,
    operationId: 'op-multi-1',
    state: 'succeeded',
    narration: 'failed',
    retryAction: 'none',
    receipt: {
      durable: true,
      eventId: 'event12345',
      htmlLink: 'https://calendar.google.com/calendar/event?eid=event12345',
      expiresAt: '2026-10-24T10:05:00.000Z',
      calendarLabel: 'Original Team',
    },
  };
}

export function clarification(
  patch: Partial<CalendarClarificationEvent> = {},
): CalendarClarificationEvent {
  return {
    type: 'calendar-clarification',
    proposalId: 'proposal-1',
    expiresAt: '2026-10-24T10:10:00.000Z',
    reason: 'conflict',
    message: 'This time overlaps a busy interval. Accept this conflict or choose another time.',
    candidates: [],
    ...patch,
  };
}
