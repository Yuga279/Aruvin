/**
 * ============================================================================
 * FILE: calendar-agenda-view.test.ts
 * LOCATION: frontend/src/features/canvas/renderers/calendar-agenda-view.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verifies the day-grouped accessible Calendar agenda renderer.
 *
 * ROLE IN PROJECT:
 *    Pins date-only/Intl formatting, partial/trimmed/empty/expired states, and
 *    safe external links so structured Calendar facts cannot drift or invent data.
 *
 * KEY COMPONENTS:
 *    - calendarDay / calendarInterval: exclusive date-only ends and DST labels.
 *    - CalendarAgendaView: escaped details, evidence notices, expiring labels/links.
 * ============================================================================
 */

import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {CalendarAgendaView,calendarDay,calendarInterval} from './calendar-agenda-view.tsx';
import {agenda,NOW} from '../testing/calendar-view-fixtures.ts';

it('keeps date-only exclusive ends and shows full cross-day timed intervals',()=>{
  const allDay={...agenda().entries[0],allDay:true,start:'2026-11-11',end:'2026-11-14',timeZone:null};
  expect(calendarDay(allDay,'America/Los_Angeles')).toBe('2026-11-11');
  expect(calendarInterval(allDay,'America/Los_Angeles')).toContain('Nov 13');
  expect(calendarInterval(allDay,'America/Los_Angeles')).not.toContain('Nov 14');
  const timed={...agenda().entries[0],start:'2026-11-11T23:30:00Z',end:'2026-11-12T01:00:00Z'};
  expect(calendarInterval(timed,'Etc/UTC')).toContain('Nov 11');
  expect(calendarInterval(timed,'Etc/UTC')).toContain('Nov 12');
  const dst={...timed,start:'2026-11-01T05:30:00Z',end:'2026-11-01T06:30:00Z'};
  expect(calendarInterval(dst,'America/New_York')).toContain('EDT');
  expect(calendarInterval(dst,'America/New_York')).toContain('EST');
});
it('distinguishes empty, partial and trimmed results and escapes details',()=>{
  const view=agenda();
  const html=renderToStaticMarkup(createElement(CalendarAgendaView,{view,nowMs:NOW}));
  expect(html).toContain('Design sync');expect(html).toContain('Europe/London');
  expect(html).toContain('<details');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
  expect(html).toContain('rel="noopener noreferrer"');
  const partial=renderToStaticMarkup(createElement(CalendarAgendaView,{view:{...view,entries:[],truncated:true,
    nextPageToken:'opaque',detailsTrimmed:true,entriesOmitted:2},nowMs:NOW}));
  expect(partial).toContain('More results are available');
  expect(partial).toContain('2 events omitted');expect(partial).toContain('Some details were shortened');
  expect(partial).not.toContain('No events in this range');
  const empty=renderToStaticMarkup(createElement(CalendarAgendaView,{view:{...view,entries:[]},nowMs:NOW}));
  expect(empty).toContain('No events in this range');
  const expired=renderToStaticMarkup(createElement(CalendarAgendaView,{view,nowMs:NOW+600_000}));
  expect(expired).not.toContain('href=');expect(expired).not.toContain('Calendar: Team');
  expect(expired).toContain('Design sync');
});
it('handles get-event and omitted fields without inventing attendees or a requested range',()=>{
  const view=agenda();view.requested=null;
  delete view.entries[0].location;delete view.entries[0].description;view.entries[0].status='cancelled';
  const html=renderToStaticMarkup(createElement(CalendarAgendaView,{view,nowMs:NOW}));
  expect(html).toContain('Returned event details');expect(html).toContain('cancelled');
  expect(html).not.toContain('Location:');expect(html).not.toContain('Attendees');expect(html).not.toContain('No events');
});
