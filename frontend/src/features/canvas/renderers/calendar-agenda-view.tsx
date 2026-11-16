/**
 * ============================================================================
 * FILE: calendar-agenda-view.tsx
 * LOCATION: frontend/src/features/canvas/renderers/calendar-agenda-view.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Render a day-grouped, accessible Calendar agenda from a structured view.
 *
 * ROLE IN PROJECT:
 *    Provides the readable Calendar Canvas body: date-only exclusive ends,
 *    full multi-day intervals, Intl zone/DST labels, native disclosure details,
 *    and expiring safe links. It displays only P1-validated facts.
 *
 * KEY COMPONENTS:
 *    - calendarDay: Calendar day key for grouping in the display time zone.
 *    - calendarInterval: All-day or timed interval label (never duplicated per day).
 *    - CalendarAgendaView: Grouped agenda with evidence, empty, and expiry states.
 * ============================================================================
 */

import {useMemo} from 'react';
import type {CalendarView,CalendarViewEntry} from '../../../api/calendar-protocol.ts';
import {resolveSafeCalendarLink} from '../canvas-artifacts.ts';
type Agenda=Extract<CalendarView,{kind:'agenda'}>;
const dayLabel=(day:string)=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})
  .format(new Date(`${day}T12:00:00Z`));
export function calendarDay(entry:CalendarViewEntry,zone:string):string {
  if (entry.allDay) return entry.start;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(entry.start));
  const part=(name:string)=>parts.find(p=>p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function calendarInterval(entry:Pick<CalendarViewEntry,'start'|'end'|'allDay'>,zone:string):string {
  if (entry.allDay) {
    const last=new Date(Date.parse(`${entry.end}T00:00:00Z`)-86_400_000).toISOString().slice(0,10);
    return `All day · ${dayLabel(entry.start)}${last === entry.start ? '' : ` – ${dayLabel(last)}`}`;
  }
  try {
    const fmt=new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',year:'numeric',
      hour:'numeric',minute:'2-digit',timeZoneName:'short'});
    return `${fmt.format(new Date(entry.start))} – ${fmt.format(new Date(entry.end))}`;
  } catch { return `${entry.start} – ${entry.end} (${zone})`; }
}
export function CalendarAgendaView({view,nowMs=Date.now()}:{view:Agenda;nowMs?:number}) {
  const zone=view.requested?.displayTimeZone ?? view.entries.find(e=>e.timeZone)?.timeZone ?? 'Etc/UTC';
  const groups=useMemo(()=>{
    const map=new Map<string,CalendarViewEntry[]>();
    for (const entry of view.entries) {
      const day=calendarDay(entry,zone);const list=map.get(day) ?? [];list.push(entry);map.set(day,list);
    }
    return [...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([day,entries])=>({day,
      entries:entries.toSorted((a,b)=>Number(b.allDay)-Number(a.allDay) ||
        (a.allDay && b.allDay ? a.start.localeCompare(b.start) : Date.parse(a.start)-Date.parse(b.start)))}));
  },[view,zone]);
  const fresh=Date.parse(view.expiresAt)>nowMs;
  const label=fresh && view.target.labelExpiresAt && Date.parse(view.target.labelExpiresAt)>nowMs ? view.target.calendarLabel : null;
  const incomplete=view.truncated || view.nextPageToken !== null || view.entriesOmitted>0;
  return <section className="aurvin-calendar-agenda" aria-label="Calendar agenda">
    <header><h2>Calendar agenda</h2>{label ? <p>Calendar: {label}</p> : null}
      <p>{view.requested ? calendarInterval({start:view.requested.timeMin,end:view.requested.timeMax,allDay:false},zone) : 'Returned event details'}</p>
      <p>Time zone: {zone}</p></header>
    {incomplete ? <p role="status">{view.nextPageToken ? 'More results are available. Ask Aurvin to continue this lookup.' : 'Only part of the requested results is shown.'}</p> : null}
    {view.entriesOmitted>0 ? <p>{view.entriesOmitted} events omitted by the display limit.</p> : null}
    {view.detailsTrimmed ? <p>Some details were shortened to fit this result.</p> : null}
    {!view.entries.length && !incomplete ? <p>{view.requested ? 'No events in this range.' : 'No event details returned.'}</p> : null}
    <p className="aurvin-calendar-caption">Grouped by start day. Multi-day events appear once with their full interval.</p>
    {groups.map(group=><section className="aurvin-calendar-day" key={group.day} aria-label={dayLabel(group.day)}>
      <h3><time dateTime={group.day}>{dayLabel(group.day)}</time></h3>
      <ul>{group.entries.map((entry,index)=>{
        const link=fresh ? resolveSafeCalendarLink(entry.htmlLink) : null;
        return <li className="aurvin-calendar-agenda-entry" key={`${entry.eventId}:${index}`}>
          <h4>{entry.summary || 'Untitled event'}</h4><p>{calendarInterval(entry,zone)}</p>
          <p>{entry.allDay ? 'All-day' : 'Timed'} · {entry.status}</p>
          <details><summary>Event details: {entry.summary || 'Untitled event'}</summary>
            {entry.location ? <p>Location: {entry.location}</p> : null}
            {entry.description ? <p className="aurvin-calendar-description">{entry.description}</p> : null}
            <p>Event ID: {entry.eventId}</p>
            {link ? <a href={link} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a> : null}
          </details>
        </li>;
      })}</ul>
    </section>)}
  </section>;
}
