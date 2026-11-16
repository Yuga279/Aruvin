/**
 * ============================================================================
 * FILE: calendar-view.fixture.ts
 * LOCATION: backend/test/contracts/calendar-view.fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Supply bounded calendar presentation examples for deterministic tests.
 *
 * ROLE IN PROJECT:
 *    Reuses backend contract boundaries without services or credentials.
 *    Supplies data, never authorization or a second calendar execution path.
 *
 * KEY COMPONENTS:
 *    - agendaFixture: A fresh successful empty-agenda snapshot.
 * ============================================================================
 */

import { calendarViewSchema, type CalendarView } from '../../src/contracts/calendar-view.js';

export function agendaFixture(overrides: Record<string, unknown> = {}): Extract<CalendarView, { kind: 'agenda' }> {
  const view = calendarViewSchema.parse({ viewVersion: 1, kind: 'agenda',
    target: { calendarId: 'primary@example.test', calendarLabel: 'Personal',
      labelExpiresAt: '2026-11-11T10:05:00.000Z' },
    requested: { timeMin: '2026-11-11T00:00:00.000Z', timeMax: '2026-11-12T00:00:00.000Z',
      displayTimeZone: 'Europe/London' },
    entries: [], nextPageToken: null, truncated: false, detailsTrimmed: false,
    entriesOmitted: 0, expiresAt: '2026-11-11T10:05:00.000Z', ...overrides });
  if (view.kind !== 'agenda') throw new Error('Expected an agenda fixture.');
  return view;
}
