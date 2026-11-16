/**
 * ============================================================================
 * FILE: calendar-availability-api.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/calendar-availability-api.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests and regressions for Google Calendar availability adapter (CalendarAvailabilityApi).
 *
 * ROLE IN PROJECT:
 *    Verifies cross-calendar free/busy batching, interval projection, DST handling,
 *    coverage honesty, error isolation, and byte/interval bounds.
 *
 * KEY COMPONENTS:
 *    - CalendarAvailabilityApi: The availability adapter under test.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { CalendarAvailabilityApi } from '../../../src/plugins/google-calendar/calendar-availability-api.js';
import { calendarAvailabilityResultSchema, calendarAvailabilityFingerprint }
  from '../../../src/contracts/calendar-availability.js';
import { fakeFetch, googleJson } from './tools-fixtures.js';
import { availabilityInput, snapshot, clock, NOW } from './calendar-discovery-api-fixtures.js';

it('batches one hundred authorized calendars into two counted requests without groups', async () => {
  const snap = snapshot(100);
  const fake = fakeFetch([0, 50].map(offset => ({ method: 'POST', path: '/calendar/v3/freeBusy',
    response: () => googleJson({ timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z',
      calendars: Object.fromEntries(snap.entries.slice(offset, offset + 50).map(e => [e.calendarId, { busy: [] }])) }) })));
  const kinds: string[] = [];
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
    snapshot: snap, calendarIds: snap.entries.map(e => e.calendarId),
    consumeRequest: async kind => { kinds.push(kind); } }));
  expect(result).toMatchObject({ coverage: 'complete', conflict: 'clear', semantics: 'google-opaque-busy-only',
    free: [{ start: '2026-10-22T11:00:00.000Z', end: '2026-10-22T12:00:00.000Z' }] });
  expect(result.calendars).toHaveLength(100);
  expect(kinds).toEqual(['availability', 'availability']);
  expect(fake.requests).toHaveLength(2);
  const ids: string[] = [];
  for (const request of fake.requests) {
    const body = await request.clone().json();
    expect(body.items).toHaveLength(50);
    expect(body.calendarExpansionMax).toBe(50);
    expect(body).not.toHaveProperty('groupExpansionMax');
    expect(body).not.toHaveProperty('groups');
    expect(body.timeZone).toBe('Europe/London');
    ids.push(...body.items.map((item: { id: string }) => item.id));
  }
  expect(new Set(ids).size).toBe(100);
  expect(result.calendarSetHash).toBe(createHash('sha256')
    .update(JSON.stringify([...ids].sort()), 'utf8').digest('hex'));
});

it('rejects forged authority, unknown IDs and invalid ranges before network admission', async () => {
  const fake = fakeFetch([]);
  const api = new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock });
  const base = availabilityInput();
  for (const patch of [{ calendarIds: ['not-discovered'] }, { calendarIds: ['primary'] },
    { calendarIds: ['c0', 'c0'] }, { timeZone: 'Invalid/Zone' },
    { timeMin: '2026-02-30T10:00:00Z' }, { timeMin: base.timeMax },
    { timeMax: '2026-11-22T11:00:00.001Z' }]) {
    await expect(api.check(availabilityInput(patch))).rejects.toThrow('CALENDAR_INPUT_REJECTED');
  }
  await expect(api.check(availabilityInput({ snapshot: { ...base.snapshot, connectionRevision: 2 } })))
    .rejects.toThrow('CALENDAR_EXECUTION_DENIED');
  expect(fake.requests).toHaveLength(0);
});

it('isolates HTTP-200 per-calendar errors and never turns missing busy data into free', async () => {
  const entries = snapshot(3);
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: {
      c0: { busy: [] }, c1: { busy: [], errors: [{ domain: 'global', reason: 'notFound', message: 'private-detail' }] },
    } }) }]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
    snapshot: entries, calendarIds: ['c0', 'c1', 'c2'] }));
  expect(result.calendars).toEqual([
    { calendarId: 'c0', calendarLabel: 'Calendar 0', status: 'ok', reason: null },
    { calendarId: 'c1', calendarLabel: 'Calendar 1', status: 'error', reason: 'not-found' },
    { calendarId: 'c2', calendarLabel: 'Calendar 2', status: 'error', reason: 'missing-response' },
  ]);
  expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [] });
  expect(result.limitations).toContain('calendar-error');
  expect(JSON.stringify(result)).not.toContain('private-detail');
  expect(fake.requests).toHaveLength(1); // No OAuth, disconnect, or alternate-calendar delivery.
});

it('retains known conflicts after a failed batch and never certifies stale or partial discovery', async () => {
  const snap = snapshot(51);
  const fake = fakeFetch([
    { method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z',
      calendars: Object.fromEntries(snap.entries.slice(0, 50).map(e => [e.calendarId,
        { busy: e.calendarId === 'c0' ? [{ start: '2026-10-22T11:15:00Z', end: '2026-10-22T11:30:00Z' }] : [] }])) }) },
    { method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({}, { status: 503 }) },
  ]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
    snapshot: snap, calendarIds: snap.entries.map(e => e.calendarId), purpose: 'preflight' }));
  expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'conflict', free: [] });
  expect(result.calendars.find(e => e.calendarId === 'c50')).toMatchObject({ status: 'error', reason: 'provider-error' });
  expect(result.busy).toHaveLength(1);
  const staleFake = fakeFetch([]);
  const stale = await new CalendarAvailabilityApi({ fetcher: staleFake.fetcher, now: clock }).check(availabilityInput({
    now: '2026-10-22T10:05:00.000Z' }));
  expect(stale).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [] });
  expect(stale.limitations).toContain('discovery-stale');
  expect(staleFake.requests).toHaveLength(0);
});

it('maps per-calendar quota and unsupported errors without automatic retries', async () => {
  const reasons = ['insufficientPermissions', 'rateLimitExceeded', 'userRateLimitExceeded',
    'quotaExceeded', 'tooManyCalendarsRequested', 'unknown-private-provider-reason'];
  const expected = ['forbidden', 'rate-limit', 'rate-limit', 'quota', 'unsupported', 'provider-error'];
  for (const [i, reason] of reasons.entries()) {
    const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z',
      calendars: { c0: { busy: [], errors: [{ reason }] } } }) }]);
    const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput());
    expect(result.calendars[0]).toMatchObject({ status: 'error', reason: expected[i] });
    expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [] });
    expect(fake.requests).toHaveLength(1);
  }
});

it('keeps a fresh partial calendar set unknown and fingerprints coverage changes', async () => {
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy: [] } } }) }]);
  const partial = { ...snapshot(), complete: false, truncated: true, nextPageToken: 'unvisited',
    limitations: ['page-limit' as const] };
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({ snapshot: partial }));
  expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [] });
  expect(result.limitations).toContain('discovery-partial');
  const fingerprint = calendarAvailabilityFingerprint(result);
  expect(calendarAvailabilityFingerprint({ ...result, availabilityRevision: 2,
    checkedAt: '2026-10-22T10:00:01.000Z' })).toBe(fingerprint);
  expect(calendarAvailabilityFingerprint({ ...result, calendars: result.calendars.map(c => ({ ...c,
    status: 'error', reason: 'not-found' })), limitations: ['discovery-partial', 'calendar-error'] }))
    .not.toBe(fingerprint);
});

it('coalesces opaque all-day recurring tentative focus and private busy projections across DST', async () => {
  // Google already expanded recurrence and converted opaque all-day boundaries.
  // These names describe fixture provenance only, not event fields sent to P3.
  const opaqueAllDay = { start: '2026-11-01T00:00:00-04:00', end: '2026-11-02T00:00:00-05:00' };
  const recurring = { start: '2026-11-01T01:15:00-04:00', end: '2026-11-01T01:45:00-04:00' };
  const tentative = { start: '2026-11-01T01:30:00-05:00', end: '2026-11-01T02:00:00-05:00' };
  const outOfOffice = { start: '2026-11-02T00:00:00-05:00', end: '2026-11-02T01:00:00-05:00' };
  const focusPrivate = { start: '2026-11-02T00:30:00-05:00', end: '2026-11-02T01:30:00-05:00' };
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-11-01T04:00:00Z', timeMax: '2026-11-02T07:00:00Z',
    calendars: { c0: { busy: [focusPrivate, tentative, opaqueAllDay, recurring, outOfOffice],
      summary: 'must-not-escape', attendees: ['private@example.invalid'] } } }) }]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
    timeMin: '2026-11-01T04:00:00Z', timeMax: '2026-11-02T07:00:00Z', timeZone: 'America/New_York' }));
  expect(result.busy).toEqual([{ start: '2026-11-01T04:00:00.000Z', end: '2026-11-02T06:30:00.000Z' }]);
  expect(result.free).toEqual([{ start: '2026-11-02T06:30:00.000Z', end: '2026-11-02T07:00:00.000Z' }]);
  expect(result).toMatchObject({ coverage: 'complete', conflict: 'conflict', semantics: 'google-opaque-busy-only' });
  expect(JSON.stringify(result)).not.toMatch(/must-not-escape|private@example/);
});

it('clips half-open intervals and does not invent busy for transparent events or working hours', async () => {
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy: [
      { start: '2026-10-22T10:00:00Z', end: '2026-10-22T11:00:00Z' },
      { start: '2026-10-22T12:00:00Z', end: '2026-10-22T13:00:00Z' },
    ] } } }) }]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput());
  expect(result.busy).toEqual([]);
  expect(result.free).toEqual([{ start: '2026-10-22T11:00:00.000Z', end: '2026-10-22T12:00:00.000Z' }]);
  expect(result.semantics).toBe('google-opaque-busy-only');
  expect(fake.requests.every(r => new URL(r.url).pathname === '/calendar/v3/freeBusy')).toBe(true);
});

it('preserves twenty-three and twenty-five elapsed hour all-day blocks for freeBusyReader', async () => {
  for (const [start, end, hours] of [
    ['2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', 23],
    ['2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25],
  ] as const) {
    const snap = snapshot();
    snap.entries[0] = { ...snap.entries[0]!, accessRole: 'freeBusyReader', privateAccess: false,
      capabilities: { readEvents: false, createEvents: false, availability: true } };
    const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: start, timeMax: end, calendars: { c0: { busy: [{ start, end }] } } }) }]);
    const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput({
      snapshot: snap, timeMin: start, timeMax: end, timeZone: 'America/New_York' }));
    expect(result).toMatchObject({ coverage: 'complete', conflict: 'conflict', free: [] });
    expect(result.busy).toHaveLength(1);
    expect(Date.parse(result.busy[0]!.end) - Date.parse(result.busy[0]!.start)).toBe(hours * 3600000);
    expect(fake.requests).toHaveLength(1);
  }
});

it('merges equivalent offsets nested duplicates and adjacent clipped intervals', async () => {
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy: [
      { start: '2026-10-22T10:45:00Z', end: '2026-10-22T11:15:00Z' },
      { start: '2026-10-22T12:00:00+01:00', end: '2026-10-22T12:15:00+01:00' },
      { start: '2026-10-22T11:15:00Z', end: '2026-10-22T12:30:00Z' },
    ] } } }) }]);
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput());
  expect(result.busy).toEqual([{ start: '2026-10-22T11:00:00.000Z', end: '2026-10-22T12:00:00.000Z' }]);
  expect(result.free).toEqual([]);
  expect(result.conflict).toBe('conflict');
});

it('bounds two thousand ingested intervals separately from coalesced output', async () => {
  for (const count of [2000, 2001]) {
    const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
      timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy:
        Array.from({ length: count }, () => ({ start: '2026-10-22T11:15:00Z', end: '2026-10-22T11:30:00Z' })) } } }) }]);
    const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check(availabilityInput());
    expect(result.busy).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(15360);
    expect(result.coverage).toBe(count === 2000 ? 'complete' : 'incomplete');
    if (count === 2001) {
      expect(result).toMatchObject({ truncated: true, free: [], conflict: 'conflict' });
      expect(result.limitations).toContain('interval-limit');
    }
  }
});

it('truncates disjoint results to lower bytes without returning free windows', async () => {
  const start = Date.parse('2026-10-22T11:00:00Z');
  const fake = fakeFetch([{ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { c0: { busy:
      Array.from({ length: 120 }, (_, i) => ({ start: new Date(start + i * 20000).toISOString(),
        end: new Date(start + i * 20000 + 10000).toISOString() })) } } }) }]);
  const input = availabilityInput();
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check({
    ...input, limits: { ...input.limits, resultBytes: 3000 } });
  expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(3000);
  expect(result).toMatchObject({ coverage: 'incomplete', truncated: true, free: [], conflict: 'conflict' });
  expect(result.limitations).toContain('byte-limit');
  expect(result.busy.length).toBeGreaterThan(0);
  expect(result.busy.length).toBeLessThan(120);
});

it('does not exceed lower batch limits and accounts preflight separately from logical tools', async () => {
  const snap = snapshot(3);
  const fake = fakeFetch([0, 1].map(i => ({ method: 'POST', path: '/calendar/v3/freeBusy', response: () => googleJson({
    timeMin: '2026-10-22T11:00:00Z', timeMax: '2026-10-22T12:00:00Z', calendars: { [`c${i}`]: { busy: [] } } }) })));
  const input = availabilityInput();
  const kinds: string[] = [];
  const result = await new CalendarAvailabilityApi({ fetcher: fake.fetcher, now: clock }).check({ ...input,
    snapshot: snap, calendarIds: ['c0', 'c1', 'c2'], purpose: 'preflight',
    consumeRequest: async kind => { kinds.push(kind); }, limits: { ...input.limits, batchCalendars: 1 } });
  expect(kinds).toEqual(['preflight', 'preflight']);
  expect(fake.requests).toHaveLength(2);
  expect(result).toMatchObject({ coverage: 'incomplete', conflict: 'unknown', free: [], truncated: true });
  expect(result.limitations).toContain('calendar-limit');
});
