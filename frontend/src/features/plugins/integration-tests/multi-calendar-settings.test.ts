/**
 * ============================================================================
 * FILE: multi-calendar-settings.test.ts
 * LOCATION: frontend/src/features/plugins/integration-tests/multi-calendar-settings.test.ts
 * ============================================================================
 * PURPOSE:
 *    Exercise the multi-calendar HTTP client through reducer and safe SSR output.
 * ROLE IN PROJECT:
 *    Checks parsed protocol, independent default updates and rollback in Node.
 *    Does not assert browser focus, screen-reader behavior or Google service ACLs.
 * KEY COMPONENTS:
 *    - Client/settings: CSRF and confirmed-only preference state.
 *    - Picker: Native semantics, partial coverage and inaccessible defaults.
 * ============================================================================
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { createCalendarClient, CalendarClientError } from '../../../api/calendar-client.ts';
import { CalendarDefaults } from '../google-calendar/CalendarDefaults.tsx';
import { GoogleCalendarPanel } from '../google-calendar/GoogleCalendarPanel.tsx';
import { calendarSetupReducer, createInitialCalendarSetupState } from '../google-calendar/calendar-setup-state.ts';
import { calendarEntry, calendarPage, multiStatus } from '../google-calendar/testing/multi-calendar-fixtures.ts';

it('renders no-ID Connect and composes parsed cached pages with accessible truthful picker state', async () => {
  expect(typeof document).toBe('undefined');
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(calendarPage({ complete: false,
    truncated: true, limitations: ['calendar-limit', 'primary-missing'], calendars: [
      calendarEntry({ label: '<script>unsafe</script>' }),
      calendarEntry({ calendarId: 'reader', label: 'Reading', accessRole: 'reader', privateAccess: false,
        capabilities: { readEvents: true, createEvents: false, availability: true } }),
    ] })));
  const client = createCalendarClient({ fetch: fetcher });
  const status = multiStatus({ defaultSetting: { defaultCalendarId: 'lost-default', defaultSettingRevision: 7 } });
  let state = createInitialCalendarSetupState(status);
  state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 1, pending: null, listLoading: true });
  const response = await client.listCalendars({});
  state = calendarSetupReducer(state, { type: 'pageReceived', requestId: 1,
    connectionRevision: 3, requestedToken: null, response });
  const html = renderToStaticMarkup(createElement(CalendarDefaults, { state, disabled: false,
    nowMs: Date.parse('2026-10-24T10:01:00Z'), onSelect: vi.fn(), onSave: vi.fn(), onReset: vi.fn(),
    onRefresh: vi.fn(), onNextPage: vi.fn() }));
  expect(html).toContain('<fieldset');
  expect(html).toContain('<legend>Default calendar for new events</legend>');
  expect(html).toContain('Calendar discovery is incomplete');
  expect(html).toContain('lost-default');
  expect(html).toContain('Cannot create events');
  expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(state.draftCalendarId).toBe('lost-default');
  const panel = renderToStaticMarkup(createElement(GoogleCalendarPanel, { client,
    initialStatus: multiStatus({ state: 'setup-required', enabled: true,
      connectionRevision: null, defaultSetting: null, discovery: null, primaryCalendarId: null }) }));
  expect(panel).toContain('Connect Google Calendar');
  expect(panel).not.toContain('targetCalendarId');
});

it('rolls a failed default save back to confirmed state without toggling enablement or leaking errors', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code: 'CONFLICT',
    message: 'internal secret provider detail' }, { status: 409 }));
  const client = createCalendarClient({ fetch: fetcher });
  let state = createInitialCalendarSetupState(multiStatus());
  state = calendarSetupReducer(state, { type: 'selectDefault', calendarId: 'team@example.com' });
  state = calendarSetupReducer(state, { type: 'requestStarted', requestId: 1, pending: 'save-default' });
  const error = await client.updateSettings({ defaultSetting: { calendarId: state.draftCalendarId,
    expectedRevision: 7, expectedConnectionRevision: 3 } }).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(CalendarClientError);
  if (!(error instanceof CalendarClientError)) throw new Error('Expected the safe client error.');
  state = calendarSetupReducer(state, { type: 'requestFailed', requestId: 1,
    message: error.message, resetDraft: true });
  expect(state.draftCalendarId).toBeNull();
  expect(state.status?.enabled).toBe(true);
  expect(state.error).not.toContain('internal secret');
  const init = fetcher.mock.calls[0][1]!;
  expect(new Headers(init.headers).get('X-Aurvin-Calendar-CSRF')).toBe('1');
  expect(JSON.parse(String(init.body))).toEqual({ defaultSetting: { calendarId: 'team@example.com',
    expectedRevision: 7, expectedConnectionRevision: 3 } });
});
