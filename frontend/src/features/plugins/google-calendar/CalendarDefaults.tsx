/**
 * ============================================================================
 * FILE: CalendarDefaults.tsx
 * LOCATION: frontend/src/features/plugins/google-calendar/CalendarDefaults.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Render native accessible paged picker and honest discovery status for default calendar.
 *
 * ROLE IN PROJECT:
 *    Pure presentational component displaying discovered calendars, roles, capabilities,
 *    stale/partial warnings, pagination, and save/reset actions without internal fetch.
 *
 * KEY COMPONENTS:
 *    - CalendarDefaults: Main presentational component.
 *    - roleLabels: Human-readable strings for Calendar roles.
 * ============================================================================
 */

import React, { useId } from 'react';
import type { CalendarRole } from '../../../api/calendar-protocol.ts';
import type { CalendarSetupState } from './calendar-setup-state.ts';

export const roleLabels: Record<CalendarRole, string> = {
  owner: 'Owner',
  writer: 'Shared writer',
  writerWithoutPrivateAccess: 'Shared writer (private details masked)',
  reader: 'Read-only',
  freeBusyReader: 'Free/busy only',
};

export type CalendarDefaultsProps = {
  state: CalendarSetupState;
  disabled: boolean;
  nowMs: number;
  onSelect: (calendarId: string | null) => void;
  onSave: () => void;
  onReset: () => void;
  onRefresh: () => void;
  onNextPage: () => void;
};

export function CalendarDefaults({
  state,
  disabled,
  nowMs,
  onSelect,
  onSave,
  onReset,
  onRefresh,
  onNextPage,
}: CalendarDefaultsProps): React.JSX.Element {
  const ids = useId();
  const status = state.status;
  const isV2 = status?.protocolVersion === 2;
  const discovery = isV2 ? status.discovery : null;

  const fresh = Boolean(
    discovery &&
      Number.isFinite(Date.parse(discovery.expiresAt)) &&
      Date.parse(discovery.expiresAt) > nowMs &&
      !discovery.stale,
  );

  const isExpired = Boolean(
    discovery &&
      Number.isFinite(Date.parse(discovery.expiresAt)) &&
      Date.parse(discovery.expiresAt) <= nowMs,
  );

  const canChoose = Boolean(
    isV2 &&
      status.enabled &&
      status.state === 'connected' &&
      status.missingScopes.length === 0 &&
      status.connectionRevision !== null &&
      status.defaultSetting !== null,
  );

  const confirmedDefault = isV2 ? status.defaultSetting?.defaultCalendarId ?? null : null;
  const page = state.page;
  const calendars = page?.calendars ?? [];

  const draftOnCurrentPage =
    state.draftCalendarId !== null && calendars.some((c) => c.calendarId === state.draftCalendarId);
  const draftKnownAnywhere =
    state.draftCalendarId !== null && state.entries.some((c) => c.calendarId === state.draftCalendarId);

  const draftEntry = draftKnownAnywhere
    ? state.entries.find((c) => c.calendarId === state.draftCalendarId)
    : null;

  const isDraftWritable =
    state.draftCalendarId === null || (draftEntry ? draftEntry.capabilities.createEvents : true);

  const isDirty = state.draftCalendarId !== confirmedDefault;
  const isPending = Boolean(state.pending);

  const allPagesComplete = Boolean(page?.complete && page.nextPageToken === null);
  const hasNoWritableEntries =
    allPagesComplete && !state.entries.some((e) => e.capabilities.createEvents && !e.hidden && !e.deleted);

  const savedDefaultUnavailable =
    confirmedDefault !== null &&
    ((allPagesComplete && !state.entries.some((e) => e.calendarId === confirmedDefault)) ||
      (draftEntry && !draftEntry.capabilities.createEvents));

  const canSave =
    !disabled &&
    canChoose &&
    fresh &&
    isDirty &&
    isDraftWritable &&
    !isPending &&
    !state.settingsUnconfirmed;

  const canReset =
    !disabled &&
    canChoose &&
    !isPending &&
    confirmedDefault !== null;

  return (
    <fieldset
      className="aurvin-calendar-defaults"
      aria-busy={state.listPhase === 'loading'}
      aria-describedby={`${ids}-status`}
    >
      <legend>Default calendar for new events</legend>

      {/* Discovery metadata and diagnostics */}
      <div id={`${ids}-status`} className="aurvin-calendar-choice-meta" role="status">
        {discovery ? (
          <div>
            <span>
              Fetched: <time dateTime={discovery.fetchedAt}>{discovery.fetchedAt}</time> · Expires:{' '}
              <time dateTime={discovery.expiresAt}>{discovery.expiresAt}</time>
            </span>
          </div>
        ) : null}

        {discovery?.stale ? (
          <p role="alert">Cached list is stale; refresh before choosing a calendar.</p>
        ) : null}

        {isExpired ? (
          <p role="alert">Cached calendar list expired. Refresh to view calendars.</p>
        ) : null}

        {page && !page.complete ? (
          <p role="alert">
            Calendar discovery is incomplete
            {page.limitations.length > 0 ? ` (${page.limitations.join(', ')})` : ''}.
          </p>
        ) : null}

        {page?.limitations.includes('primary-missing') ? (
          <p role="alert">Primary calendar could not be established.</p>
        ) : null}

        {state.listError ? <p role="alert">{state.listError}</p> : null}

        {state.settingsUnconfirmed ? (
          <p role="alert">
            Default save could not be confirmed. Reload before saving again.
          </p>
        ) : null}
      </div>

      {/* Saved default display when off-page */}
      {confirmedDefault !== null ? (
        <div className="aurvin-calendar-choice-meta">
          <strong>Saved default:</strong> <span>{confirmedDefault}</span>
          {!draftOnCurrentPage && page ? (
            <span> · Saved default is not on this page; its current access is unverified.</span>
          ) : null}
          {savedDefaultUnavailable ? (
            <p role="alert">
              Saved default is unavailable or no longer writable. Choose another calendar or reset it.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Selected for save indicator when draft is on another page */}
      {isDirty && state.draftCalendarId !== null && !draftOnCurrentPage ? (
        <div className="aurvin-calendar-choice-meta">
          <strong>Selected for save:</strong>{' '}
          <span>{draftEntry ? draftEntry.label : state.draftCalendarId}</span>
        </div>
      ) : null}

      {/* Automatic primary radio */}
      <label className="aurvin-calendar-choice">
        <input
          type="radio"
          name={`${ids}-default`}
          value=""
          checked={state.draftCalendarId === null}
          disabled={disabled || !canChoose || isPending}
          onChange={() => onSelect(null)}
        />
        <span>
          <strong>Use primary automatically</strong>
          <span className="aurvin-calendar-choice-meta">
            Events will be created in your primary calendar unless an explicit calendar is requested.
          </span>
        </span>
      </label>

      {/* Entry rows: shown only if fresh / not expired */}
      {!isExpired && page ? (
        <div className="aurvin-calendar-entries-list">
          {calendars.length === 0 ? (
            <p className="aurvin-calendar-choice-meta">
              {hasNoWritableEntries
                ? 'No writable calendars were discovered.'
                : 'No writable calendars on this page.'}
              {!page.complete ? ' Discovery is incomplete; other calendars may be missing.' : ''}
            </p>
          ) : (
            calendars.map((entry) => {
              const cannotCreate = !entry.capabilities.createEvents;
              const isMasked = !entry.privateAccess;
              const isEntryDisabled =
                disabled ||
                !fresh ||
                !canChoose ||
                cannotCreate ||
                entry.hidden ||
                entry.deleted;

              return (
                <label className="aurvin-calendar-choice" key={entry.calendarId}>
                  <input
                    type="radio"
                    name={`${ids}-default`}
                    value={entry.calendarId}
                    checked={state.draftCalendarId === entry.calendarId}
                    disabled={isEntryDisabled}
                    onChange={() => onSelect(entry.calendarId)}
                  />
                  <span>
                    <strong>{entry.label}</strong>
                    {entry.primary ? ' · Primary' : ''}
                    <span className="aurvin-calendar-choice-meta">{entry.calendarId}</span>
                    <span>{roleLabels[entry.accessRole]}</span>
                    {cannotCreate ? <span> · Cannot create events</span> : null}
                    {isMasked ? <span> · Private details are masked</span> : null}
                  </span>
                </label>
              );
            })
          )}
        </div>
      ) : null}

      {/* Action buttons */}
      <div className="aurvin-calendar-actions">
        <button
          type="button"
          disabled={!canSave}
          onClick={onSave}
          className="aurvin-calendar-save-btn"
        >
          Save default calendar
        </button>

        <button
          type="button"
          disabled={!canReset}
          onClick={onReset}
          className="aurvin-calendar-reset-btn"
        >
          {confirmedDefault === null
            ? 'Use primary automatically'
            : 'Reset to primary automatically'}
        </button>

        <button
          type="button"
          disabled={disabled || !canChoose || state.pending === 'refresh'}
          onClick={onRefresh}
          className="aurvin-calendar-refresh-btn"
        >
          {state.pending === 'refresh' ? 'Refreshing calendars...' : 'Refresh calendar list'}
        </button>

        {page?.nextPageToken ? (
          <button
            type="button"
            disabled={disabled || state.listPhase === 'loading'}
            onClick={onNextPage}
            className="aurvin-calendar-next-btn"
          >
            {state.listPhase === 'loading' ? 'Loading page...' : 'Load next page'}
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}
