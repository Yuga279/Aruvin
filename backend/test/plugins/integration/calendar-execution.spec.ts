/**
 * ============================================================================
 * FILE: calendar-execution.spec.ts
 * LOCATION: backend/test/plugins/integration/calendar-execution.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Invoke all five Calendar tools through the direct production executor.
 *
 * ROLE IN PROJECT:
 *    Replaces embedded MCP handshake tests with the same bound CalendarApiTools
 *    path used by assembly, while keeping REST query and identity refusals.
 *
 * KEY COMPONENTS:
 *    - All-five tool invocation
 *    - Exact 31-day list window
 *    - Model-supplied calendar identity refusal
 * ============================================================================
 */

import { expect, it } from 'vitest';
import {
  apiToolsFixture,
  googleEvent,
  googleJson,
  type ApiToolsFixture,
} from '../google-calendar/tools-fixtures.js';

const LIST_STEP = {
  method: 'GET',
  path: '/calendar/v3/calendars/owned/events',
  response: () => googleJson({ timeZone: 'Etc/UTC', items: [googleEvent()] }),
};
const GET_STEP = {
  method: 'GET',
  path: '/calendar/v3/calendars/owned/events/abcde01234',
  response: () => googleJson(googleEvent()),
};

function live(fixture: ApiToolsFixture): ApiToolsFixture {
  fixture.input.binding = {
    ...fixture.input.binding,
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
  };
  return fixture;
}

async function invoke(fixture: ApiToolsFixture) {
  try {
    return await fixture.tools.invoke(fixture.input);
  } finally {
    await fixture.tools.close();
  }
}

it('invokes all five v2 tools through the direct executor', async () => {
  const list = live(apiToolsFixture({
    operation: null,
    steps: [LIST_STEP],
    call: {
      name: 'calendar_list_events',
      arguments: { timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-10-22T00:00:00Z', maxResults: 20 },
    },
  }));
  const got = live(apiToolsFixture({
    operation: null,
    steps: [GET_STEP],
    call: { name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } },
  }));
  const created = live(apiToolsFixture());
  const listCals = live(apiToolsFixture({
    operation: null,
    call: { name: 'calendar_list_calendars', arguments: {} },
    steps: [],
  }));
  const avail = live(apiToolsFixture({
    operation: null,
    steps: [{
      method: 'POST',
      path: '/calendar/v3/freeBusy',
      response: () => googleJson({
        timeMin: '2026-10-21T00:00:00Z',
        timeMax: '2026-10-22T00:00:00Z',
        calendars: { owned: { busy: [] } },
      }),
    }],
    call: {
      name: 'calendar_check_availability',
      arguments: { timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-10-22T00:00:00Z', timeZone: 'Etc/UTC' },
    },
  }));
  expect(await invoke(list)).toMatchObject({ outcome: 'success', result: { tool: 'calendar_list_events' } });
  expect(await invoke(got)).toMatchObject({ outcome: 'success', result: { tool: 'calendar_get_event' } });
  const create = await invoke(created);
  expect(create).toMatchObject({ outcome: 'success', result: { tool: 'calendar_create_event' } });
  if (create.outcome !== 'success') throw new Error('create failed');
  expect(create.receipt?.googleEventId).toBe(created.input.binding.operation?.googleEventId);
  expect(await invoke(listCals)).toMatchObject({ outcome: 'success', result: { tool: 'calendar_list_calendars' } });
  expect(await invoke(avail)).toMatchObject({ outcome: 'success', result: { tool: 'calendar_check_availability' } });
  const post = created.requests[0];
  const url = new URL(post.url);
  expect(post.method).toBe('POST');
  expect(url.pathname).toBe('/calendar/v3/calendars/owned/events');
  expect(url.searchParams.get('sendUpdates')).toBe('none');
  expect(url.searchParams.get('conferenceDataVersion')).toBe('0');
  expect(url.searchParams.get('supportsAttachments')).toBe('false');
  expect(created.requests).toHaveLength(1);
});

it('rejects a 31-day-plus-one-second list before Google and admits the exact 31-day boundary', async () => {
  const over = live(apiToolsFixture({
    operation: null,
    steps: [LIST_STEP],
    call: {
      name: 'calendar_list_events',
      arguments: { timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-11-21T00:00:01Z', maxResults: 20 },
    },
  }));
  expect(await invoke(over)).toMatchObject({ outcome: 'failure' });
  expect(over.requests).toHaveLength(0);
  const edge = live(apiToolsFixture({
    operation: null,
    steps: [LIST_STEP],
    call: {
      name: 'calendar_list_events',
      arguments: { timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-11-21T00:00:00Z', maxResults: 20 },
    },
  }));
  expect(await invoke(edge)).toMatchObject({ outcome: 'success', result: { tool: 'calendar_list_events' } });
  expect(edge.requests).toHaveLength(1);
});

it('rejects a model-supplied calendar identity before any Google request', async () => {
  const fixture = live(apiToolsFixture({
    operation: null,
    steps: [GET_STEP],
    call: {
      name: 'calendar_get_event',
      arguments: { eventId: 'abcde01234', calendarId: 'other-calendar' },
    },
  }));
  expect(await invoke(fixture)).toMatchObject({ outcome: 'failure' });
  expect(fixture.requests).toHaveLength(0);
});
