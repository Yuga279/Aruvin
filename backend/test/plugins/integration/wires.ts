/**
 * ============================================================================
 * FILE: wires.ts
 * LOCATION: backend/test/plugins/integration/wires.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide stable native model wires for plugin integration regressions.
 *
 * ROLE IN PROJECT:
 *    Keeps malformed, forbidden, and unknown stable call_tool cases distinct
 *    from valid Calendar argument failures.
 *
 * KEY COMPONENTS:
 *    - VISIT / APPROVED_CREATE: Canonical event and accepted request fixtures.
 *    - malformedCreateWire / forbiddenCreateWire / unknownToolWire.
 * ============================================================================
 */

import { calendarInputSchemas, type CalendarCreateInput } from '../../../src/contracts/calendar-tools.js';
import { skillWire } from '../../model/calendar-fixtures.js';

export const VISIT: CalendarCreateInput = calendarInputSchemas.calendar_create_event.parse({
  summary: 'Visit',
  start: '2026-10-21T10:00:00Z',
  end: '2026-10-21T11:00:00Z',
  timeZone: 'Etc/UTC',
});

/**
 * The accepted user scheduling request in the natural language the v2 intent
 * layer reads. The v2 runtime authorises a create from the accepted user
 * message and the matching model decision, never from a canonical JSON form.
 */
export const APPROVED_CREATE = 'Schedule Visit on 2026-10-21 from 10:00 to 11:00 Etc/UTC.';

export function malformedCreateWire(): string {
  return skillWire('call_tool',
    '{"plugin":"google-calendar","tool":"calendar_create_event","arguments":{"summary":');
}

export function forbiddenCreateWire(): string {
  return skillWire('call_tool', JSON.stringify({
    plugin: 'google-calendar', tool: 'calendar_create_event',
    arguments: { ...VISIT, attendees: ['person@example.com'] },
  }));
}

export function unknownToolWire(): string {
  return skillWire('call_tool', JSON.stringify({
    plugin: 'google-calendar', tool: 'calendar_delete_event', arguments: {},
  }));
}
