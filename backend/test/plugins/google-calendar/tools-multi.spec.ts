/**
 * ============================================================================
 * FILE: tools-multi.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/tools-multi.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Test v2 multi-calendar tool execution, fresh capability checks, and account fencing.
 *
 * ROLE IN PROJECT:
 *    Ensures CalendarApiTools enforces capability gates across owner, writer, reader,
 *    and free-busy roles, and guards against stale permissions or disabled accounts.
 *
 * KEY COMPONENTS:
 *    - Role capability matrix tests for event read and create
 *    - Revoked permission and masked access rejection tests
 *    - Account fencing and non-recursive capability tests
 *    - Snapshot pagination for list_calendars
 *    - Honest availability verification with multi-calendar selectors
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { calendarAvailabilityResultSchema, type CalendarAvailabilityPort }
  from '../../../src/contracts/calendar-availability.js';
import { calendarExecutionEnvelopeV2Schema } from '../../../src/contracts/calendar-operations.js';
import { CALENDAR_LIMITS } from '../../../src/contracts/calendar-policy.js';
import { multiTarget, multiOperation, multiToolsFixture } from './tools-multi-fixtures.js';
import { googleJson, googleEvent } from './tools-fixtures.js';

it.each(['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'] as const)
  ('intersects current %s capabilities with each event operation', async role => {
    const target = multiTarget(role);
    const f = multiToolsFixture({ target, operation: null, call: {
      name: 'calendar_get_event', arguments: { calendarId: 'shared', eventId: 'abcde01234' } },
      steps: [{ method: 'GET', path: '/calendar/v3/calendars/shared/events/abcde01234',
        response: () => googleJson(googleEvent()) }] });
    const result = await f.tools.invoke(f.input);
    expect(result.outcome).toBe(role === 'freeBusyReader' ? 'failure' : 'success');
    expect(f.requests).toHaveLength(role === 'freeBusyReader' ? 0 : 1);
    await f.tools.close();
  });

it.each(['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'] as const)
  ('creates only when current %s capability permits non-private events', async role => {
    const target = multiTarget(role);
    const f = multiToolsFixture({ target, operation: multiOperation(target) });
    const result = await f.tools.invoke(f.input);
    const writable = ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(role);
    expect(result.outcome).toBe(writable ? 'success' : 'failure');
    expect(f.requests).toHaveLength(writable ? 1 : 0);
    if (!writable) expect(result).toMatchObject({ failure: { retry: 'none' } });
    await f.tools.close();
  });

it('does not use a cached writer binding after current rights have been removed', async () => {
  const f = multiToolsFixture();
  f.snapshot.entries[0]!.capabilities.createEvents = false;
  expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: { retry: 'none' } });
  expect(f.requests).toHaveLength(0);
});

it('keeps a created event with an invalid projected receipt uncertain', async () => {
  const target = multiTarget('owner');
  const operation = multiOperation(target);
  const f = multiToolsFixture({ target, operation, steps: [{ method: 'POST',
    path: `/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events`,
    response: () => googleJson({ ...googleEvent({ start: { dateTime: 'invalid' } }), id: operation.googleEventId,
      extendedProperties: { private: { aurvinOperationId: operation.operationId,
        aurvinRequestHash: operation.requestHash } } }),
  }] });
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
      category: 'uncertain', retry: 'readback',
    } });
    expect(f.requests).toHaveLength(1);
  } finally { await f.tools.close(); }
});

it('rejects an old full-private-access binding when the current writer becomes masked', async () => {
  const f = multiToolsFixture({ operation: null, steps: [], call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } } });
  f.snapshot.entries[0]!.accessRole = 'writerWithoutPrivateAccess';
  f.snapshot.entries[0]!.privateAccess = false;
  expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: { retry: 'none' } });
  expect(f.requests).toHaveLength(0);
});

it('denies unknown selectors and stale account bindings before event delivery', async () => {
  const f = multiToolsFixture({ operation: null, steps: [], call: {
    name: 'calendar_get_event', arguments: { calendarId: 'other-calendar', eventId: 'abcde01234' } } });
  f.input.binding = { ...f.input.binding, target: null };
  expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
    category: 'clarification', code: 'CALENDAR_TARGET_UNKNOWN', retry: 'none' } });
  expect(f.requests).toHaveLength(0);
  expect(f.counts.credential).toBe(0);
  f.gate.revision(2);
  expect(await f.tools.invoke({ ...f.input, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } } })).toMatchObject({ outcome: 'failure' });
  expect(f.requests).toHaveLength(0);
});

it('fences a disable during durable request admission without recursive capability HTTP', async () => {
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [] });
  expect(await f.tools.invoke({ ...f.input, consumeRequest: async () => { f.gate.disable(); } }))
    .toMatchObject({ outcome: 'failure' });
  expect(f.requests).toHaveLength(0);
  expect(f.counts.capability).toBeLessThanOrEqual(2);
});

it('pages a stable authorized snapshot without exposing Google continuation tokens', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 21,
    call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  const first = await f.tools.invoke(f.input);
  expect(first).toMatchObject({ outcome: 'success', result: {
    schemaVersion: 2, tool: 'calendar_list_calendars', complete: true } });
  if (first.outcome !== 'success' || first.result.tool !== 'calendar_list_calendars') throw new Error('wrong result');
  expect(first.result.calendars).toHaveLength(20);
  expect(first.result.nextPageToken).toEqual(expect.any(String));
  const second = await f.tools.invoke({ ...f.input, call: { name: 'calendar_list_calendars',
    arguments: { pageToken: first.result.nextPageToken! } } });
  expect(second).toMatchObject({ outcome: 'success', result: { calendars: [expect.any(Object)], nextPageToken: null } });
  expect(JSON.stringify(first)).not.toContain('raw-google-continuation');
  expect(f.requests).toHaveLength(0);
});

it('uses only the authorized discovery set for availability and preserves incomplete coverage', async () => {
  const seen: Array<Parameters<CalendarAvailabilityPort['check']>[0]> = [];
  const f = multiToolsFixture({ operation: null, calendarCount: 2,
    call: { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-10-21T10:00:00Z', timeMax: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' } },
    availability: { check: async input => {
      seen.push(input);
      await input.consumeRequest('availability');
      return calendarAvailabilityResultSchema.parse({ schemaVersion: 2,
        tool: 'calendar_check_availability', connectionId: 'c', connectionRevision: 1,
        discoveryRevision: input.snapshot.discoveryRevision, availabilityRevision: input.availabilityRevision,
        calendarSetHash: createHash('sha256').update(JSON.stringify([...input.calendarIds].sort())).digest('hex'),
        timeMin: input.timeMin, timeMax: input.timeMax, timeZone: input.timeZone,
        checkedAt: input.now, expiresAt: input.now, semantics: 'google-opaque-busy-only',
        calendars: input.calendarIds.map(id => ({ calendarId: id,
          calendarLabel: input.snapshot.entries.find(e => e.calendarId === id)!.label,
          status: 'error', reason: 'not-found' })), busy: [], free: [],
        coverage: 'incomplete', conflict: 'unknown', truncated: false, limitations: ['calendar-error'] });
    } }, steps: [] });
  expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'success', result: {
    coverage: 'incomplete', conflict: 'unknown', free: [] }, receipt: null });
  expect(seen[0]!.calendarIds).toEqual(f.snapshot.entries.map(e => e.calendarId));
  expect(seen[0]!.purpose).toBe('availability');
  expect(f.counts.kinds).toEqual(['availability']);
  expect(await f.tools.invoke({ ...f.input, call: { name: 'calendar_check_availability', arguments: {
    ...f.input.call.arguments, calendarIds: ['not-discovered'] } } as never }))
    .toMatchObject({ outcome: 'failure', failure: { retry: 'none' } });
  expect(seen).toHaveLength(1);
});

it('pages 100 calendars across 5 distinct pages', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 100,
    call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  let token: string | null = null;
  let total = 0;
  for (let page = 0; page < 5; page++) {
    const res = await f.tools.invoke({ ...f.input, call: {
      name: 'calendar_list_calendars',
      arguments: token ? { pageToken: token } : {},
    } });
    expect(res).toMatchObject({ outcome: 'success', result: { tool: 'calendar_list_calendars' } });
    if (res.outcome !== 'success' || res.result.tool !== 'calendar_list_calendars') break;
    total += res.result.calendars.length;
    token = res.result.nextPageToken;
    if (page < 4) expect(token).toEqual(expect.any(String));
    else expect(token).toBeNull();
  }
  expect(total).toBe(100);
});

it('shrinks list-calendars page when byte-limited and sets byte-limit limitation', async () => {
  const f = multiToolsFixture({
    operation: null,
    calendarCount: 10,
    limits: { ...CALENDAR_LIMITS, resultBytes: 2500 },
    call: { name: 'calendar_list_calendars', arguments: {} },
    steps: [],
  });
  const res = await f.tools.invoke(f.input);
  expect(res).toMatchObject({
    outcome: 'success',
    result: {
      tool: 'calendar_list_calendars',
      truncated: true,
      limitations: expect.arrayContaining(['byte-limit']),
    },
  });
});

it.each([1000, 1400, 1800])('never returns an empty non-advancing calendar page at %s bytes', async resultBytes => {
  const f = multiToolsFixture({ operation: null, calendarCount: 10,
    limits: { ...CALENDAR_LIMITS, resultBytes },
    call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  try {
    const res = await f.tools.invoke(f.input);
    if (res.outcome === 'success' && res.result.tool === 'calendar_list_calendars') {
      expect(res.result.calendars.length).toBeGreaterThan(0);
    } else expect(res).toMatchObject({ outcome: 'failure', failure: { code: 'CALENDAR_RESULT_TOO_LARGE' } });
  } finally { await f.tools.close(); }
});

it('rejects an invalid or tampered pageToken for list_calendars with clarification', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 5,
    call: { name: 'calendar_list_calendars', arguments: { pageToken: 'invalid.token' } }, steps: [] });
  const res = await f.tools.invoke(f.input);
  expect(res).toMatchObject({ outcome: 'failure', failure: {
    category: 'clarification', code: 'CALENDAR_INPUT_REJECTED',
  } });
});

it('canonicalizes primary selector to primary calendar in availability check', async () => {
  const seen: Array<Parameters<CalendarAvailabilityPort['check']>[0]> = [];
  const f = multiToolsFixture({ operation: null, calendarCount: 3,
    call: { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-10-21T10:00:00Z', timeMax: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC',
      calendarIds: ['primary'] } },
    availability: { check: async input => {
      seen.push(input);
      return calendarAvailabilityResultSchema.parse({
        schemaVersion: 2, tool: 'calendar_check_availability', connectionId: 'c', connectionRevision: 1,
        discoveryRevision: input.snapshot.discoveryRevision, availabilityRevision: input.availabilityRevision,
        calendarSetHash: createHash('sha256').update(JSON.stringify(input.calendarIds)).digest('hex'),
        timeMin: input.timeMin, timeMax: input.timeMax, timeZone: input.timeZone,
        checkedAt: input.now, expiresAt: input.now, semantics: 'google-opaque-busy-only',
        calendars: input.calendarIds.map(id => ({ calendarId: id,
          calendarLabel: 'primary', status: 'ok', reason: null })), busy: [], free: [{ start: input.timeMin, end: input.timeMax }],
        coverage: 'complete', conflict: 'clear', truncated: false, limitations: [] });
    } }, steps: [] });
  const res = await f.tools.invoke(f.input);
  expect(res).toMatchObject({ outcome: 'success' });
  expect(seen[0]!.calendarIds).toEqual([f.snapshot.entries[0]!.calendarId]);
});

it('rejects duplicate selectors after canonicalization in check_availability', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 3,
    call: { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-10-21T10:00:00Z', timeMax: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC',
      calendarIds: ['primary', 'shared'] } }, steps: [] });
  const res = await f.tools.invoke(f.input);
  expect(res).toMatchObject({ outcome: 'failure', failure: {
    category: 'clarification', code: 'CALENDAR_INPUT_REJECTED',
  } });
});

it('rejects primary selector when primary calendar is missing in snapshot', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 3,
    call: { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-10-21T10:00:00Z', timeMax: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC',
      calendarIds: ['primary'] } }, steps: [] });
  for (const entry of f.snapshot.entries) entry.primary = false;
  const res = await f.tools.invoke(f.input);
  expect(res).toMatchObject({ outcome: 'failure', failure: {
    category: 'clarification', code: 'CALENDAR_TARGET_UNKNOWN',
  } });
});

it('allows freeBusyReader for check_availability', async () => {
  const target = multiTarget('freeBusyReader');
  const f = multiToolsFixture({ target, operation: null,
    call: { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-10-21T10:00:00Z', timeMax: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' } },
    availability: { check: async input => {
      return calendarAvailabilityResultSchema.parse({
        schemaVersion: 2, tool: 'calendar_check_availability', connectionId: 'c', connectionRevision: 1,
        discoveryRevision: input.snapshot.discoveryRevision, availabilityRevision: input.availabilityRevision,
        calendarSetHash: createHash('sha256').update(JSON.stringify(input.calendarIds)).digest('hex'),
        timeMin: input.timeMin, timeMax: input.timeMax, timeZone: input.timeZone,
        checkedAt: input.now, expiresAt: input.now, semantics: 'google-opaque-busy-only',
        calendars: input.calendarIds.map(id => ({ calendarId: id,
          calendarLabel: 'busy', status: 'ok', reason: null })), busy: [], free: [{ start: input.timeMin, end: input.timeMax }],
        coverage: 'complete', conflict: 'clear', truncated: false, limitations: [] });
    } }, steps: [] });
  const res = await f.tools.invoke(f.input);
  expect(res.outcome).toBe('success');
});

it('preserves partial provider snapshot limitations on list_calendars', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 5,
    call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  f.snapshot.complete = false;
  f.snapshot.truncated = true;
  f.snapshot.limitations = ['page-limit'];
  const res = await f.tools.invoke(f.input);
  expect(res).toMatchObject({
    outcome: 'success',
    result: {
      tool: 'calendar_list_calendars',
      complete: false,
      truncated: true,
      limitations: ['page-limit'],
    },
  });
});

it('rejects a cursor from a changed discovery revision', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 25,
    call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  const first = await f.tools.invoke(f.input);
  if (first.outcome !== 'success' || first.result.tool !== 'calendar_list_calendars' || !first.result.nextPageToken) {
    throw new Error('failed first page');
  }
  f.snapshot.discoveryRevision = 2;
  const second = await f.tools.invoke({ ...f.input, call: {
    name: 'calendar_list_calendars',
    arguments: { pageToken: first.result.nextPageToken },
  } });
  expect(second).toMatchObject({ outcome: 'failure', failure: {
    category: 'clarification', code: 'CALENDAR_INPUT_REJECTED',
  } });
});

it('denies execution when granted scopes are insufficient', async () => {
  const f = multiToolsFixture({ operation: null,
    call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  f.record.grantedScopes = ['https://www.googleapis.com/auth/userinfo.email'];
  const res = await f.tools.invoke(f.input);
  expect(res).toMatchObject({ outcome: 'failure', failure: { category: 'policy' } });
});

it('limits batch deliveries under a credential replay in check_availability', async () => {
  let attempts = 0;
  const f = multiToolsFixture({ operation: null, calendarCount: 2,
    call: { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-10-21T10:00:00Z', timeMax: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' } },
    availability: { check: async input => {
      attempts++;
      await input.consumeRequest('availability');
      return calendarAvailabilityResultSchema.parse({
        schemaVersion: 2, tool: 'calendar_check_availability', connectionId: 'c', connectionRevision: 1,
        discoveryRevision: input.snapshot.discoveryRevision, availabilityRevision: input.availabilityRevision,
        calendarSetHash: createHash('sha256').update(JSON.stringify([...input.calendarIds].sort())).digest('hex'),
        timeMin: input.timeMin, timeMax: input.timeMax, timeZone: input.timeZone,
        checkedAt: input.now, expiresAt: input.now, semantics: 'google-opaque-busy-only',
        calendars: input.calendarIds.map(id => ({ calendarId: id,
          calendarLabel: 'cal', status: 'ok', reason: null })), busy: [], free: [{ start: input.timeMin, end: input.timeMax }],
        coverage: 'complete', conflict: 'clear', truncated: false, limitations: [] });
    } }, steps: [] });

  const originalWithAccessToken = f.credentials.withAccessToken;
  let replayed = false;
  f.credentials.withAccessToken = async (input, action) => {
    return originalWithAccessToken(input, async (token) => {
      if (!replayed) {
        replayed = true;
        await input.consumeRefreshRequest();
      }
      return action(token);
    });
  };

  const res = await f.tools.invoke(f.input);
  expect(res.outcome).toBe('success');
  expect(attempts).toBe(1);
  expect(f.counts.refresh).toBe(1);
  expect(f.counts.calendar).toBe(1);
});

it('keeps source and receipt on the durable operation target after a default change', async () => {
  const target = multiTarget('writer', 'shared');
  const operation = multiOperation(target);
  const f = multiToolsFixture({ target, operation });
  f.record.defaultSetting = { defaultCalendarId: 'different-default', defaultSettingRevision: 9 };
  const value = await f.tools.invoke(f.input);
  expect(value).toMatchObject({ outcome: 'success', result: { target: { calendarId: 'shared' } },
    source: { schemaVersion: 2, operationIds: ['op_1'], toolCallIds: ['tc'],
      targets: [{ calendarId: 'shared', calendarLabel: null }] },
    receipt: { schemaVersion: 2, calendarId: 'shared', googleEventId: operation.googleEventId,
      calendarLabel: null, labelExpiresAt: null } });
  expect(JSON.stringify(value)).not.toContain('different-default');
});

it('does not call an unrelated read a create receipt and binds multi-calendar provenance', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 2,
    call: { name: 'calendar_list_calendars', arguments: {} }, steps: [] });
  const value = await f.tools.invoke(f.input);
  expect(value).toMatchObject({ outcome: 'success', receipt: null, source: {
    schemaVersion: 2, operationIds: [], toolCallIds: ['tc'], availabilityRevision: null,
    calendarSetHash: null, discoveryRevision: 1 } });
  if (value.outcome !== 'success') throw new Error('expected discovery');
  expect(value.source.targets.map(t => t.calendarId)).toEqual(f.snapshot.entries.map(t => t.calendarId));
  expect(calendarExecutionEnvelopeV2Schema.safeParse(value).success).toBe(true);
});

it('binds the direct result to the requested event even when an adapter returns a valid wrong event', async () => {
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [] });
  vi.spyOn(f.api, 'get').mockResolvedValue({ headers: new Headers(), fetchedAt: f.input.binding.trustedNow,
    result: { schemaVersion: 2, tool: 'calendar_get_event', target: {
      calendarId: f.input.binding.target!.calendarId, calendarLabel: f.input.binding.target!.calendarLabel,
      discoveryRevision: f.input.binding.target!.discoveryRevision, privateAccess: f.input.binding.target!.privateAccess,
    }, event: { eventId: 'different-event', summary: 'Fixture', start: '2026-11-03T10:00:00Z',
      end: '2026-11-03T11:00:00Z', timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null } } });
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
      code: 'CALENDAR_RESPONSE_INVALID', retry: 'none' } });
  } finally { await f.tools.close(); }
});

it('rejects a valid-shaped wrong-calendar adapter result', async () => {
  const f = multiToolsFixture({ operation: null, call: {
    name: 'calendar_get_event', arguments: { eventId: 'abcde01234' } }, steps: [] });
  vi.spyOn(f.api, 'get').mockResolvedValue({ headers: new Headers(), fetchedAt: f.input.binding.trustedNow,
    result: { schemaVersion: 2, tool: 'calendar_get_event', target: {
      calendarId: 'different-authorized-calendar', calendarLabel: f.input.binding.target!.calendarLabel,
      discoveryRevision: f.input.binding.target!.discoveryRevision, privateAccess: f.input.binding.target!.privateAccess,
    }, event: { eventId: 'abcde01234', summary: 'Fixture', start: '2026-11-03T10:00:00Z',
      end: '2026-11-03T11:00:00Z', timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null } } });
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
      code: 'CALENDAR_RESPONSE_INVALID', retry: 'none' } });
  } finally { await f.tools.close(); }
});

it('keeps a malformed create adapter result uncertain instead of repeating the POST', async () => {
  const f = multiToolsFixture();
  const create = vi.spyOn(f.api, 'create').mockResolvedValue({
    headers: new Headers(), fetchedAt: f.input.binding.trustedNow,
    result: { schemaVersion: 2, tool: 'calendar_create_event', target: {
      calendarId: f.input.binding.target!.calendarId, calendarLabel: f.input.binding.target!.calendarLabel,
      discoveryRevision: f.input.binding.target!.discoveryRevision, privateAccess: f.input.binding.target!.privateAccess,
    }, event: { eventId: 'ffffffffffff', summary: 'Fixture', start: '2026-10-21T10:00:00Z',
      end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null } },
  });
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
      category: 'uncertain', code: 'WRITE_OUTCOME_UNKNOWN', retry: 'readback' } });
    expect(create).toHaveBeenCalledTimes(1);
  } finally { await f.tools.close(); }
});

it('rejects availability results that include calendars outside the expected set', async () => {
  const f = multiToolsFixture({ operation: null, calendarCount: 1,
    call: { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-10-21T10:00:00Z', timeMax: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' } },
    availability: { check: async input => calendarAvailabilityResultSchema.parse({
      schemaVersion: 2, tool: 'calendar_check_availability', connectionId: 'c', connectionRevision: 1,
      discoveryRevision: input.snapshot.discoveryRevision, availabilityRevision: input.availabilityRevision,
      calendarSetHash: createHash('sha256').update(JSON.stringify([...input.calendarIds, 'other-cal'].sort())).digest('hex'),
      timeMin: input.timeMin, timeMax: input.timeMax, timeZone: input.timeZone,
      checkedAt: input.now, expiresAt: input.now, semantics: 'google-opaque-busy-only',
      calendars: [...input.calendarIds, 'other-cal'].map(id => ({ calendarId: id,
        calendarLabel: 'cal', status: 'ok', reason: null })), busy: [],
      free: [{ start: input.timeMin, end: input.timeMax }],
      coverage: 'complete', conflict: 'clear', truncated: false, limitations: [] }) }, steps: [] });
  try {
    expect(await f.tools.invoke(f.input)).toMatchObject({ outcome: 'failure', failure: {
      code: 'CALENDAR_RESPONSE_INVALID', retry: 'none' } });
  } finally { await f.tools.close(); }
});
