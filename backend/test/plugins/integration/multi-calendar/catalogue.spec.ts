/**
 * ============================================================================
 * FILE: catalogue.spec.ts
 * LOCATION: backend/test/plugins/integration/multi-calendar/catalogue.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify five-tool native contracts and target authority through direct execution.
 * ROLE IN PROJECT:
 *    Uses CalendarApiTools with scripted REST. Never substitutes a mocked SDK
 *    client or a public MCP endpoint.
 * KEY COMPONENTS:
 *    - Native catalogue presence for the five supported tools
 *    - Selector authority: Shared writes, read denials and forged-field refusal
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS } from '../../../../src/contracts/calendar-tools.js';
import { calendarExecutionEnvelopeV2Schema } from '../../../../src/contracts/calendar-operations.js';
import { multiTarget, multiToolsFixture } from '../../google-calendar/tools-multi-fixtures.js';
import { googleEvent, googleJson } from '../../google-calendar/tools-fixtures.js';

it('exposes exactly five native tools and lists calendars through the direct executor', async () => {
  expect(CALENDAR_TOOLS.map(tool => tool.name)).toEqual([
    'calendar_list_events', 'calendar_get_event', 'calendar_create_event',
    'calendar_list_calendars', 'calendar_check_availability',
  ]);
  const f = multiToolsFixture({ operation: null, steps: [],
    call: { name: 'calendar_list_calendars', arguments: {} } });
  try {
    const result = await f.tools.invoke(f.input);
    expect(calendarExecutionEnvelopeV2Schema.parse(result))
      .toMatchObject({ outcome: 'success', result: { tool: 'calendar_list_calendars' } });
    expect(f.requests).toHaveLength(0);
  } finally { await f.tools.close(); }
});

it.each(['writer', 'writerWithoutPrivateAccess'] as const)('creates on a shared %s target via direct execution', async role => {
  const f = multiToolsFixture({ target: multiTarget(role, 'shared') });
  try {
    const result = await f.tools.invoke(f.input);
    expect(calendarExecutionEnvelopeV2Schema.parse(result)).toMatchObject({ outcome: 'success',
      receipt: { calendarId: 'shared', googleEventId: f.input.binding.operation!.googleEventId } });
    expect(f.requests).toHaveLength(1);
    const url = new URL(f.requests[0].url);
    expect(url.pathname).toBe('/calendar/v3/calendars/shared/events');
    expect(url.searchParams.get('sendUpdates')).toBe('none');
  } finally { await f.tools.close(); }
});

it.each(['reader', 'freeBusyReader'] as const)('refuses create on %s before Google', async role => {
  const f = multiToolsFixture({ target: multiTarget(role, 'shared'), steps: [] });
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure' });
    expect(f.requests).toHaveLength(0);
  } finally { await f.tools.close(); }
});

it.each(['calendar_list_events', 'calendar_get_event'] as const)('reads a shared reader with %s', async name => {
  const get = name === 'calendar_get_event';
  const f = multiToolsFixture({ target: multiTarget('reader', 'shared'), operation: null,
    call: get ? { name, arguments: { calendarId: 'shared', eventId: 'abcde01234' } }
      : { name, arguments: { calendarId: 'shared', timeMin: '2026-10-21T00:00:00Z',
        timeMax: '2026-10-22T00:00:00Z', maxResults: 20 } },
    steps: [{ method: 'GET', path: `/calendar/v3/calendars/shared/events${get ? '/abcde01234' : ''}`,
      response: () => googleJson(get ? googleEvent({ visibility: 'private' })
        : { timeZone: 'Etc/UTC', items: [googleEvent({ visibility: 'private' })] }) }] });
  try {
    const result = await f.tools.invoke(f.input);
    expect(calendarExecutionEnvelopeV2Schema.parse(result)).toMatchObject({ outcome: 'success',
      result: { tool: name, target: { calendarId: 'shared', privateAccess: false } } });
    expect(JSON.stringify(result)).not.toContain('fixture-private-attendee');
    expect(f.requests).toHaveLength(1);
  } finally { await f.tools.close(); }
});

it.each([
  { calendarId: 'not-discovered' }, { confirmed: true }, { conflictOverride: true },
  { connectionId: 'forged' }, { userId: 'forged' }, { accessToken: 'forged' },
  { attendees: [{ email: 'forged@example.invalid' }] },
])('refuses untrusted create fields %j without a provider effect', async patch => {
  const f = multiToolsFixture({ steps: [] });
  try {
    expect(await f.tools.invoke({ ...f.input, call: { name: 'calendar_create_event',
      arguments: { ...f.input.call.arguments, ...patch } } as never }))
      .toMatchObject({ outcome: 'failure' });
    expect(f.requests).toHaveLength(0);
  } finally { await f.tools.close(); }
});
