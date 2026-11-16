/**
 * ============================================================================
 * FILE: calendar-event-renderer.tsx
 * LOCATION: frontend/src/features/canvas/renderers/calendar-event-renderer.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Renders a rich, authentic Google Calendar-themed event card inside Canvas.
 *
 * ROLE IN PROJECT:
 *    Visualizes confirmed calendar events in Aurvin's Canvas panel, featuring
 *    a tear-off date sheet, time duration, confirmation badge, mini-schedule,
 *    and a secure 1-click CTA linking to Google Calendar.
 *
 * KEY COMPONENTS:
 *    - CalendarEventRenderer: The main interactive/visual calendar card stage.
 *    - CalendarDateSheet: Tear-off calendar sheet with month and day display.
 *    - CalendarDaySchedulePreview: Mini time-grid slot highlighting the event.
 *    - resolveSafeCalendarLink: URL sanitizer blocking unsafe javascript/data links.
 * ============================================================================
 */

import { useMemo } from 'react';
import { parseCalendarSource, resolveSafeCalendarLink } from '../canvas-artifacts.ts';
import type { CalendarEventModel } from '../canvas-types.ts';

type ParsedDateInfo = {
  monthAbbr: string;
  dayNumber: number | string;
  weekday: string;
  dateStr: string;
  timeRangeText: string;
  durationText: string | null;
  formattedDateTime: string;
  startHour: number | null;
};

function parseEventDates(
  rawStart?: unknown,
  rawEnd?: unknown,
  timeZone?: string,
): ParsedDateInfo {
  let startIso: string | undefined;
  let endIso: string | undefined;

  if (typeof rawStart === 'string') {
    startIso = rawStart;
  } else if (rawStart && typeof rawStart === 'object') {
    const rec = rawStart as Record<string, unknown>;
    startIso = typeof rec.dateTime === 'string' ? rec.dateTime : typeof rec.date === 'string' ? rec.date : undefined;
  }

  if (typeof rawEnd === 'string') {
    endIso = rawEnd;
  } else if (rawEnd && typeof rawEnd === 'object') {
    const rec = rawEnd as Record<string, unknown>;
    endIso = typeof rec.dateTime === 'string' ? rec.dateTime : typeof rec.date === 'string' ? rec.date : undefined;
  }

  const startDate = startIso ? new Date(startIso) : null;
  const isStartValid = startDate !== null && !isNaN(startDate.getTime());

  const endDate = endIso ? new Date(endIso) : null;
  const isEndValid = endDate !== null && !isNaN(endDate.getTime());

  const tzOption: Intl.DateTimeFormatOptions = timeZone ? { timeZone } : {};

  if (!isStartValid) {
    const today = new Date();
    const month = today.toLocaleDateString('en-US', { month: 'short', ...tzOption }).toUpperCase();
    const day = today.getDate();
    return {
      monthAbbr: month,
      dayNumber: day,
      weekday: 'Scheduled',
      dateStr: 'Upcoming Event',
      timeRangeText: 'Time scheduled on Google Calendar',
      durationText: null,
      formattedDateTime: 'Scheduled on Google Calendar',
      startHour: null,
    };
  }

  const validStart = startDate!;
  const monthAbbr = validStart.toLocaleDateString('en-US', { month: 'short', ...tzOption }).toUpperCase();
  const dayNumber = validStart.toLocaleDateString('en-US', { day: 'numeric', ...tzOption });
  const weekday = validStart.toLocaleDateString('en-US', { weekday: 'long', ...tzOption });
  const dateStr = validStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...tzOption });

  const hasTime = startIso?.includes('T') ?? false;

  let timeRangeText = '';
  let durationText: string | null = null;
  let startHour: number | null = null;

  if (hasTime) {
    startHour = validStart.getHours();
    const startTimeStr = validStart.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...tzOption,
    });

    if (isEndValid && endDate) {
      const endTimeStr = endDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        ...tzOption,
      });
      timeRangeText = `${startTimeStr} – ${endTimeStr}`;

      const diffMs = endDate.getTime() - validStart.getTime();
      if (diffMs > 0) {
        const totalMinutes = Math.round(diffMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        if (hours > 0 && mins > 0) {
          durationText = `${hours} hr ${mins} min`;
        } else if (hours > 0) {
          durationText = hours === 1 ? '1 hr' : `${hours} hrs`;
        } else if (mins > 0) {
          durationText = `${mins} min`;
        }
      }
    } else {
      timeRangeText = startTimeStr;
    }
  } else {
    timeRangeText = 'All Day';
  }

  const formattedDateTime = durationText
    ? `${weekday}, ${dateStr} · ${timeRangeText} (${durationText})`
    : `${weekday}, ${dateStr} · ${timeRangeText}`;

  return {
    monthAbbr,
    dayNumber,
    weekday,
    dateStr,
    timeRangeText,
    durationText,
    formattedDateTime,
    startHour,
  };
}

export function CalendarDateSheet({
  month,
  day,
}: {
  month: string;
  day: number | string;
}) {
  return (
    <div className="aurvin-calendar-tearoff-sheet" aria-hidden="true">
      <div className="aurvin-calendar-sheet-header">{month}</div>
      <div className="aurvin-calendar-sheet-body">{day}</div>
    </div>
  );
}

export function CalendarDaySchedulePreview({
  summary,
  startHour,
  timeRangeText,
}: {
  summary: string;
  startHour: number | null;
  timeRangeText: string;
}) {
  const centerHour = startHour !== null ? startHour : 10;
  const hoursToShow = [
    Math.max(0, centerHour - 2),
    Math.max(0, centerHour - 1),
    centerHour,
    Math.min(23, centerHour + 1),
    Math.min(23, centerHour + 2),
  ];

  const formatHourLabel = (h: number): string => {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    if (h < 12) return `${h} AM`;
    return `${h - 12} PM`;
  };

  return (
    <div className="aurvin-calendar-schedule-preview" aria-label="Day schedule context">
      <div className="aurvin-calendar-schedule-header">
        <span className="aurvin-calendar-schedule-label">Day Schedule Context</span>
      </div>
      <div className="aurvin-calendar-schedule-grid">
        {hoursToShow.map((hour) => {
          const isEventSlot = hour === centerHour;
          return (
            <div
              key={hour}
              className={`aurvin-calendar-grid-row${isEventSlot ? ' aurvin-calendar-grid-row-active' : ''}`}
            >
              <span className="aurvin-calendar-grid-time">{formatHourLabel(hour)}</span>
              <div className="aurvin-calendar-grid-slot">
                {isEventSlot ? (
                  <div className="aurvin-calendar-grid-pill">
                    <span className="aurvin-calendar-grid-pill-accent" />
                    <div className="aurvin-calendar-grid-pill-content">
                      <span className="aurvin-calendar-grid-pill-title">{summary}</span>
                      <span className="aurvin-calendar-grid-pill-time">{timeRangeText}</span>
                    </div>
                  </div>
                ) : (
                  <div className="aurvin-calendar-grid-line" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type CalendarEventRendererProps = {
  source: string;
  title?: string;
  model?: CalendarEventModel | null;
};

export function CalendarEventRenderer({
  source,
  title,
  model: modelProp,
}: CalendarEventRendererProps) {
  const eventModel = useMemo(() => {
    return modelProp ?? parseCalendarSource(source, title);
  }, [modelProp, source, title]);

  const summary = eventModel?.summary || title || 'Google Calendar Event';
  const calendarLabel = eventModel?.calendarLabel || 'Personal Calendar';
  const timeZone = eventModel?.timeZone || undefined;

  const dateInfo = useMemo(() => {
    return parseEventDates(eventModel?.start, eventModel?.end, timeZone);
  }, [eventModel?.start, eventModel?.end, timeZone]);

  const safeLink = useMemo(() => {
    return resolveSafeCalendarLink(eventModel?.htmlLink);
  }, [eventModel?.htmlLink]);

  return (
    <div
      className="aurvin-calendar-canvas-card"
      role="region"
      aria-label={`Calendar event: ${summary}`}
    >
      {/* Top Banner with Accent Strip */}
      <div className="aurvin-calendar-accent-strip" aria-hidden="true" />

      {/* Main Event Header Row */}
      <div className="aurvin-calendar-card-header-row">
        <CalendarDateSheet month={dateInfo.monthAbbr} day={dateInfo.dayNumber} />

        <div className="aurvin-calendar-header-details">
          <div className="aurvin-calendar-status-badge">
            <span className="aurvin-calendar-status-dot" aria-hidden="true" />
            <span>Confirmed on Google Calendar</span>
          </div>

          <h1 className="aurvin-calendar-event-title">{summary}</h1>

          <div className="aurvin-calendar-meta-pills">
            <span className="aurvin-calendar-target-pill" title="Target Calendar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {calendarLabel}
            </span>
            {timeZone ? (
              <span className="aurvin-calendar-tz-pill" title="Timezone">
                {timeZone}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Formatted Date & Time Row */}
      <div className="aurvin-calendar-time-row">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="aurvin-calendar-time-text">{dateInfo.formattedDateTime}</span>
      </div>

      {/* Location Details if Present */}
      {eventModel?.location ? (
        <div className="aurvin-calendar-detail-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span className="aurvin-calendar-detail-text">{eventModel.location}</span>
        </div>
      ) : null}

      {/* Description Details if Present */}
      {eventModel?.description ? (
        <div className="aurvin-calendar-description-box">
          <span className="aurvin-calendar-description-title">Details</span>
          <p className="aurvin-calendar-description-text">{eventModel.description}</p>
        </div>
      ) : null}

      {/* Mini Day-Schedule Slot Preview */}
      <CalendarDaySchedulePreview
        summary={summary}
        startHour={dateInfo.startHour}
        timeRangeText={dateInfo.timeRangeText}
      />

      {/* Event ID Tag if present */}
      {eventModel?.eventId ? (
        <div className="aurvin-calendar-event-id-row">
          <span className="aurvin-calendar-id-label">Event ID:</span>
          <code className="aurvin-calendar-id-code">{eventModel.eventId}</code>
        </div>
      ) : null}

      {/* Prominent 1-Click CTA Button */}
      <div className="aurvin-calendar-cta-container">
        {safeLink ? (
          <a
            href={safeLink}
            target="_blank"
            rel="noopener noreferrer"
            className="aurvin-calendar-canvas-btn"
          >
            Open in Google Calendar ↗
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="aurvin-calendar-canvas-btn aurvin-calendar-canvas-btn-disabled"
            title="Google Calendar link is unavailable or unverified"
          >
            Open in Google Calendar ↗
          </button>
        )}
      </div>
    </div>
  );
}
