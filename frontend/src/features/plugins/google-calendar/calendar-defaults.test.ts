/**
 * ============================================================================
 * FILE: calendar-defaults.test.ts
 * LOCATION: frontend/src/features/plugins/google-calendar/calendar-defaults.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify static server-rendered output and accessibility of CalendarDefaults picker.
 *
 * ROLE IN PROJECT:
 *    Ensures native accessible fieldset/radio controls, role and capability labels,
 *    truthful partial/stale discovery reporting, and XSS escaping.
 *
 * KEY COMPONENTS:
 *    - setupWithPage: Test helper constructing seeded setup state with discovery page.
 *    - renderDefaults: Renders CalendarDefaults to static markup with stub callbacks.
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CalendarDefaults } from './CalendarDefaults.tsx';
import {
  calendarSetupReducer,
  createInitialCalendarSetupState,
  type CalendarSetupState,
} from './calendar-setup-state.ts';
import {
  calendarEntry,
  calendarPage,
  multiStatus,
} from './testing/multi-calendar-fixtures.ts';

function setupWithPage(response = calendarPage()) {
  let state = createInitialCalendarSetupState(multiStatus());
  state = calendarSetupReducer(state, {
    type: 'requestStarted',
    requestId: 1,
    pending: null,
    listLoading: true,
  });
  return calendarSetupReducer(state, {
    type: 'pageReceived',
    requestId: 1,
    connectionRevision: 3,
    requestedToken: null,
    response,
  });
}

function renderDefaults(state: CalendarSetupState) {
  return renderToStaticMarkup(
    createElement(CalendarDefaults, {
      state,
      disabled: false,
      nowMs: Date.parse('2026-10-24T10:01:00Z'),
      onSelect: vi.fn(),
      onSave: vi.fn(),
      onReset: vi.fn(),
      onRefresh: vi.fn(),
      onNextPage: vi.fn(),
    }),
  );
}

describe('CalendarDefaults component', () => {
  it('labels native choices with roles while refusing read-only creation defaults', () => {
    const html = renderDefaults(
      setupWithPage(
        calendarPage({
          calendars: [
            calendarEntry({ label: '<script>untrusted</script>' }),
            calendarEntry({
              calendarId: 'holidays',
              label: 'Holidays',
              accessRole: 'reader',
              privateAccess: false,
              capabilities: {
                readEvents: true,
                createEvents: false,
                availability: true,
              },
            }),
          ],
        }),
      ),
    );
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend>Default calendar for new events</legend>');
    expect(html).toContain('type="radio"');
    expect(html).toContain('Use primary automatically');
    expect(html).toContain('Read-only');
    expect(html).toContain('Cannot create events');
    expect(html).toContain('&lt;script&gt;untrusted&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('reports partial and stale coverage without silently selecting primary', () => {
    let state = setupWithPage(
      calendarPage({
        complete: false,
        truncated: true,
        limitations: ['calendar-limit', 'primary-missing'],
        nextPageToken: null,
      }),
    );
    state = {
      ...state,
      status: multiStatus({
        defaultSetting: {
          defaultCalendarId: 'missing-from-page',
          defaultSettingRevision: 7,
        },
      }),
      draftCalendarId: 'missing-from-page',
    };
    const html = renderDefaults(state);
    expect(html).toContain('Calendar discovery is incomplete');
    expect(html).toContain('Saved default');
    expect(html).toContain('missing-from-page');
    expect(html).not.toContain('All calendars are available');
    expect(html).not.toMatch(/value=""[^>]*checked/);
  });

  it('renders loading, empty complete discovery, masked writers, stale lists, and pagination continuation', () => {
    // 1. Loading state with aria-busy
    let loadingState = createInitialCalendarSetupState(multiStatus());
    loadingState = calendarSetupReducer(loadingState, {
      type: 'requestStarted',
      requestId: 1,
      pending: null,
      listLoading: true,
    });
    const loadingHtml = renderDefaults(loadingState);
    expect(loadingHtml).toContain('aria-busy="true"');

    // 2. Empty complete discovery
    const emptyCompleteState = setupWithPage(
      calendarPage({
        complete: true,
        nextPageToken: null,
        calendars: [],
      }),
    );
    const emptyHtml = renderDefaults(emptyCompleteState);
    expect(emptyHtml).toContain('No writable calendars were discovered.');

    // 3. Masked writer and continuation button
    const continuationState = setupWithPage(
      calendarPage({
        nextPageToken: 'token-page-2',
        calendars: [
          calendarEntry({
            accessRole: 'writerWithoutPrivateAccess',
            privateAccess: false,
          }),
        ],
      }),
    );
    const continuationHtml = renderDefaults(continuationState);
    expect(continuationHtml).toContain('Shared writer (private details masked)');
    expect(continuationHtml).toContain('Private details are masked');
    expect(continuationHtml).toContain('Load next page');

    // 4. Stale discovery warning
    const staleState = {
      ...setupWithPage(),
      status: multiStatus({
        discovery: {
          discoveryRevision: 11,
          fetchedAt: '2026-10-24T10:00:00.000Z',
          expiresAt: '2026-10-24T10:05:00.000Z',
          complete: true,
          truncated: false,
          stale: true,
        },
      }),
    };
    const staleHtml = renderDefaults(staleState);
    expect(staleHtml).toContain('Cached list is stale; refresh before choosing a calendar.');

    // 5. Dirty selection summary across pages
    let dirtyState = setupWithPage(
      calendarPage({
        calendars: [calendarEntry({ calendarId: 'other-cal@example.com', label: 'Other' })],
      }),
    );
    dirtyState = {
      ...dirtyState,
      draftCalendarId: 'team@example.com', // not on current page, but in known entries
      entries: [
        calendarEntry({ calendarId: 'team@example.com', label: 'Original Team' }),
        calendarEntry({ calendarId: 'other-cal@example.com', label: 'Other' }),
      ],
    };
    const dirtyHtml = renderDefaults(dirtyState);
    expect(dirtyHtml).toContain('Selected for save:');
    expect(dirtyHtml).toContain('Original Team');

    // 6. Reset without known primary (still resets to primary automatically)
    let noPrimaryState = setupWithPage();
    noPrimaryState = {
      ...noPrimaryState,
      status: multiStatus({
        primaryCalendarId: null,
        defaultSetting: {
          defaultCalendarId: 'team@example.com',
          defaultSettingRevision: 7,
        },
      }),
      draftCalendarId: 'team@example.com',
    };
    const noPrimaryHtml = renderDefaults(noPrimaryState);
    expect(noPrimaryHtml).toContain('Reset to primary automatically');
  });
});
