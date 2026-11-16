/**
 * ============================================================================
 * FILE: calendar-discovery-api.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/calendar-discovery-api.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests and regressions for Google Calendar discovery adapter (CalendarDiscoveryApi).
 *
 * ROLE IN PROJECT:
 *    Verifies bounded pagination, canonical primary detection, role mapping,
 *    cache expiry, byte bounds, and honest limitation flags for CalendarDiscoveryPort.
 *
 * KEY COMPONENTS:
 *    - CalendarDiscoveryApi: The discovery adapter under test.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { CalendarDiscoveryApi } from '../../../src/plugins/google-calendar/calendar-discovery-api.js';
import { calendarDiscoverySnapshotSchema, primaryCalendarId }
  from '../../../src/contracts/calendar-discovery.js';
import { CALENDAR_SCOPES_V1 } from '../../../src/contracts/calendar-policy.js';
import { fakeFetch, googleJson } from './tools-fixtures.js';
import { clock, discoveryInput, providerEntry, NOW } from './calendar-discovery-api-fixtures.js';

it('follows a short page token and derives separate shared capabilities', async () => {
  const roles = ['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'];
  const fake = fakeFetch([
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: [providerEntry()], nextPageToken: 'opaque&a=b' }) },
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: roles.map((role, i) => providerEntry(`shared-${i}`, { accessRole: role,
        summaryOverride: `Label ${i}`, selected: false })) }) },
  ]);
  const kinds: string[] = [];
  const api = new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock });
  const result = await api.discover(discoveryInput({ consumeRequest: async kind => { kinds.push(kind); } }));
  expect(calendarDiscoverySnapshotSchema.safeParse(result).success).toBe(true);
  expect(result.complete).toBe(true);
  expect(primaryCalendarId(result)).toBe('canonical-primary');
  expect(kinds).toEqual(['discovery', 'discovery']);
  for (const [i, role] of roles.entries()) {
    expect(result.entries.find(e => e.calendarId === `shared-${i}`)).toMatchObject({
      label: `Label ${i}`, accessRole: role, selected: false,
      privateAccess: role === 'owner' || role === 'writer',
      capabilities: { readEvents: role !== 'freeBusyReader',
        createEvents: ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(role), availability: true },
    });
  }
  expect(fake.requests).toHaveLength(2);
  for (const request of fake.requests) {
    const q = new URL(request.url).searchParams;
    expect(q.get('maxResults')).toBe('100');
    expect(q.has('minAccessRole')).toBe(false);
    expect(q.get('showDeleted')).toBe('false');
    expect(q.get('showHidden')).toBe('false');
    expect(request.headers.get('authorization')).toBe('Bearer fixture-token');
  }
  expect(new URL(fake.requests[1]!.url).searchParams.getAll('pageToken')).toEqual(['opaque&a=b']);
  expect(JSON.stringify(result)).not.toContain('fixture-token');
});

it('does not ingest dataOwner or invent owned flags from manager access', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ kind: 'calendar#calendarList', items: [
      providerEntry('canonical-primary', { primary: true, accessRole: 'owner' }),
      providerEntry('managed-secondary', { primary: false, accessRole: 'owner',
        dataOwner: 'foreign-owner@example.invalid' }),
      providerEntry('shared-writer', { primary: false, accessRole: 'writer' }),
      providerEntry('shared-reader', { primary: false, accessRole: 'reader' }),
    ] }) }]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
  expect(result.entries.find(e => e.calendarId === 'canonical-primary')).toMatchObject({
    primary: true, accessRole: 'owner' });
  expect(result.entries.find(e => e.calendarId === 'managed-secondary')).toMatchObject({
    primary: false, accessRole: 'owner' });
  expect(result.entries.find(e => e.calendarId === 'shared-writer')).toMatchObject({ accessRole: 'writer' });
  expect(result.entries.find(e => e.calendarId === 'shared-reader')).toMatchObject({ accessRole: 'reader' });
  expect(JSON.stringify(result)).not.toContain('dataOwner');
  expect(JSON.stringify(result)).not.toContain('foreign-owner@example.invalid');
  expect(JSON.stringify(result)).not.toContain('"owned"');
});

it('requests the collection kind needed to validate an empty CalendarList response', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ kind: 'calendar#calendarList' }) }]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
  const fields = new URL(fake.requests[0]!.url).searchParams.get('fields')!;
  expect(fields.split(',')[0]).toBe('kind');
  expect(result).toMatchObject({ entries: [], complete: false, limitations: ['primary-missing'] });
  expect(new URL(fake.requests[0]!.url).searchParams.has('pageToken')).toBe(false);
});

it('does not fabricate primary or authorize an old grant', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ items: [providerEntry('renamed@example.com')] }) }]);
  const api = new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock });
  const result = await api.discover(discoveryInput());
  expect(primaryCalendarId(result)).toBeNull();
  expect(result).toMatchObject({ complete: false, nextPageToken: null });
  expect(result.limitations).toContain('primary-missing');
  await expect(api.discover(discoveryInput({ grantedScopes: CALENDAR_SCOPES_V1 })))
    .rejects.toThrow('CALENDAR_RECONNECT_REQUIRED');
  await expect(api.discover(discoveryInput({ policyAllows: false })))
    .rejects.toThrow('CALENDAR_EXECUTION_DENIED');
  expect(fake.requests).toHaveLength(1);
});

it('keeps primary on overflow and never calls a token-bearing short page complete', async () => {
  const fake = fakeFetch([
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: [providerEntry('first')], nextPageToken: 'p2' }) },
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: [providerEntry('second'), providerEntry()], nextPageToken: 'p3' }) },
  ]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(
    discoveryInput({ limits: { retainedCalendars: 2, pageDeliveries: 2, snapshotBytes: 262144, freshnessMs: 300000 } }));
  expect(result.entries).toHaveLength(2);
  expect(primaryCalendarId(result)).toBe('canonical-primary');
  expect(result).toMatchObject({ complete: false, truncated: true, nextPageToken: 'p3' });
  expect(result.limitations).toContain('calendar-limit');
  expect(fake.requests).toHaveLength(2);
});

it('deduplicates identical entries but quarantines conflicting roles and multiple primaries', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
    items: [providerEntry(), providerEntry(), providerEntry('shared', { accessRole: 'writer' }),
      providerEntry('shared', { accessRole: 'reader' }), providerEntry('other-primary', { primary: true }),
      providerEntry('unknown', { accessRole: 'superOwner' }),
      providerEntry('masked', { accessRole: 'writerWithoutPrivateAccess' }),
      providerEntry('hidden', { hidden: true }), providerEntry('deleted', { deleted: true })] }) }]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
  expect(result.complete).toBe(false);
  expect(result.limitations).toEqual(expect.arrayContaining(['unsupported-entry', 'primary-missing']));
  expect(primaryCalendarId(result)).toBeNull();
  expect(result.entries.some(e => ['shared', 'unknown'].includes(e.calendarId))).toBe(false);
  expect(result.entries.find(e => e.calendarId === 'masked')).toMatchObject({ privateAccess: false,
    capabilities: { readEvents: true, createEvents: true, availability: true } });
  for (const id of ['hidden', 'deleted']) expect(result.entries.find(e => e.calendarId === id)?.capabilities)
    .toEqual({ readEvents: false, createEvents: false, availability: false });
});

it('returns bounded partial data on later failure and applies the strictest cache evidence', async () => {
  const fake = fakeFetch([
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
      items: [providerEntry()], nextPageToken: 'p2' }, { headers: { 'cache-control': 'max-age=120', age: '30' } }) },
    { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({}, { status: 503 }) },
  ]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
  expect(result).toMatchObject({ complete: false, expiresAt: '2026-10-22T10:01:30.000Z' });
  expect(result.limitations).toContain('provider-error');
  expect(result.entries).toHaveLength(1);
  expect(fake.requests).toHaveLength(2);
  const noStore = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ items: [providerEntry()] }, { headers: { 'cache-control': 'no-store' } }) }]);
  const volatile = await new CalendarDiscoveryApi({ fetcher: noStore.fetcher, now: clock }).discover(discoveryInput());
  expect(volatile.expiresAt).toBe(volatile.fetchedAt);
  expect(volatile.retentionExpiresAt).toBe(volatile.fetchedAt);
  const googleAntiProxy = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ items: [providerEntry()] }, { headers: {
      'cache-control': 'no-cache, no-store, max-age=0, must-revalidate',
      pragma: 'no-cache',
      expires: 'Mon, 01 Jan 1990 00:00:00 GMT',
    } }) }]);
  const retained = await new CalendarDiscoveryApi({ fetcher: googleAntiProxy.fetcher, now: clock }).discover(discoveryInput());
  expect(Date.parse(retained.expiresAt)).toBeGreaterThan(Date.parse(retained.fetchedAt));
});

it('obeys lower UTF-8 snapshot bytes and refuses to invent a continuation inside a page', async () => {
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({
    items: [providerEntry(), ...Array.from({ length: 8 }, (_, i) => providerEntry(`c${i}`, { summary: '界'.repeat(200) }))] }) }]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput({
    limits: { retainedCalendars: 100, pageDeliveries: 2, snapshotBytes: 5000, freshnessMs: 300000 } }));
  expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(5000);
  expect(result).toMatchObject({ complete: false, truncated: true, nextPageToken: null });
  expect(result.limitations).toContain('byte-limit');
  expect(primaryCalendarId(result)).toBe('canonical-primary');
});

it('bounds token loops, missing primary and malformed metadata without leaking payloads', async () => {
  const cases = [
    [{ items: [], nextPageToken: 'again' }, { items: [], nextPageToken: 'again' }],
    [{ items: [providerEntry('unknown', { accessRole: 'superOwner' })] }],
    [{ items: [providerEntry('bad-zone', { timeZone: 'Invalid/Zone' }), providerEntry()] }],
  ];
  for (const pages of cases) {
    const fake = fakeFetch(pages.map(body => ({ method: 'GET', path: '/calendar/v3/users/me/calendarList',
      response: () => googleJson(body) })));
    const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
    expect(result.complete).toBe(false);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(fake.requests.length).toBeLessThanOrEqual(2);
  }
  for (const body of [{}, { items: {} }, { items: [], nextPageToken: 42 },
    { items: [], nextPageToken: '' }, { items: [], nextPageToken: 'x'.repeat(2049) }]) {
    const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson(body) }]);
    await expect(new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput()))
      .rejects.toThrow('CALENDAR_RESPONSE_INVALID');
  }
});

it('caps ten out-of-turn deliveries and two in-turn deliveries even on empty pages', async () => {
  for (const mode of ['in-turn', 'out-of-turn'] as const) {
    const cap = mode === 'in-turn' ? 2 : 10;
    const fake = fakeFetch(Array.from({ length: 11 }, (_, i) => ({ method: 'GET',
      path: '/calendar/v3/users/me/calendarList', response: () => googleJson({ items: [], nextPageToken: `p${i}` }) })));
    const base = discoveryInput();
    const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover({ ...base,
      mode, limits: { ...base.limits, pageDeliveries: 10 } });
    expect(fake.requests).toHaveLength(cap);
    expect(result).toMatchObject({ complete: false, truncated: true, nextPageToken: `p${cap - 1}` });
    expect(result.limitations).toEqual(expect.arrayContaining(['page-limit', 'primary-missing']));
  }
});

it('retains exactly one hundred entries and marks candidate one hundred one as overflow', async () => {
  for (const count of [100, 101]) {
    const first = Array.from({ length: 99 }, (_, i) => providerEntry(`c${i}`));
    const second = [providerEntry(), ...(count === 101 ? [providerEntry('extra')] : [])];
    const fake = fakeFetch([
      { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({ items: first, nextPageToken: 'p2' }) },
      { method: 'GET', path: '/calendar/v3/users/me/calendarList', response: () => googleJson({ items: second }) },
    ]);
    const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput());
    expect(result.entries).toHaveLength(100);
    expect(primaryCalendarId(result)).toBe('canonical-primary');
    expect(result.complete).toBe(count === 100);
    expect(result.truncated).toBe(count === 101);
    expect(fake.requests).toHaveLength(2);
  }
});

it('bounds hostile metadata and leaves denied caching volatile', async () => {
  const bad = [providerEntry('primary'), providerEntry('bad\nID'), providerEntry('x'.repeat(1025)),
    providerEntry('long-label', { summary: 'x'.repeat(201) }), providerEntry('null-zone', { timeZone: null }),
    providerEntry('unknown-zone', { timeZone: 'Invalid/Zone' }), providerEntry('bad-flag', { hidden: 'false' })];
  const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ items: [providerEntry(), ...bad] }) }]);
  const result = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock }).discover(discoveryInput({ retentionPolicy: null }));
  expect(result.entries).toHaveLength(1);
  expect(result).toMatchObject({ complete: false, retentionPolicyId: null, expiresAt: NOW });
  expect(result.expiresAt).toBe(result.fetchedAt);
  expect(result.limitations).toContain('unsupported-entry');
  const empty = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
    response: () => googleJson({ kind: 'calendar#calendarList' }) }]);
  const emptyResult = await new CalendarDiscoveryApi({ fetcher: empty.fetcher, now: clock }).discover(discoveryInput());
  expect(emptyResult).toMatchObject({ entries: [], complete: false, limitations: ['primary-missing'] });
});

it('surfaces eligible delivery failures and counts caller-authorized retries without resetting budgets', async () => {
  for (const [status, reason] of [[429, 'rateLimitExceeded'], [503, 'backendError'],
    [403, 'rateLimitExceeded'], [403, 'userRateLimitExceeded']] as const) {
    const fake = fakeFetch([0, 1, 2].map(() => ({ method: 'GET', path: '/calendar/v3/users/me/calendarList',
      response: () => googleJson({ error: { errors: [{ reason }] } }, { status }) })));
    const api = new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock });
    let requests = 0;
    const input = discoveryInput({ mode: 'out-of-turn', consumeRequest: async () => { requests++; } });
    let remaining = 2;
    for (;;) {
      const fault = await api.discover(input).catch((error: unknown) => error);
      expect(fault).toHaveProperty('failure.retry', 'delivery-same-id');
      if (remaining-- === 0) break;
    }
    expect(fake.requests).toHaveLength(3);
    expect(requests).toBe(3);
  }
});

it('keeps terminal provider errors terminal and sends no request after abort or denied admission', async () => {
  for (const [status, reason, code] of [[400, 'badRequest', 'CALENDAR_INPUT_REJECTED'],
    [401, 'authError', 'RECONNECT_REQUIRED'], [403, 'insufficientPermissions', 'CALENDAR_FORBIDDEN'],
    [403, 'quotaExceeded', 'CALENDAR_QUOTA_EXCEEDED'], [404, 'notFound', 'EVENT_NOT_FOUND']] as const) {
    const fake = fakeFetch([{ method: 'GET', path: '/calendar/v3/users/me/calendarList',
      response: () => googleJson({ error: { errors: [{ reason }] } }, { status }) }]);
    const fault = await new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock })
      .discover(discoveryInput()).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.code', code);
    expect(fault).toHaveProperty('failure.retry', 'none');
    expect(fake.requests).toHaveLength(1);
  }
  const fake = fakeFetch([]);
  const api = new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock });
  const abort = new AbortController(); abort.abort();
  await expect(api.discover(discoveryInput({ signal: abort.signal }))).rejects.toThrow('CALENDAR_CANCELLED');
  await expect(api.discover(discoveryInput({ consumeRequest: async () => { throw new Error('private-store-detail'); } })))
    .rejects.toThrow('CALENDAR_REQUEST_NOT_ADMITTED');
  expect(fake.requests).toHaveLength(0);
});

it('checks a single target calendar without downloading the full catalogue', async () => {
  const fake = fakeFetch([
    {
      method: 'GET',
      path: '/calendar/v3/users/me/calendarList/shared-team%40example.com',
      response: () => googleJson(providerEntry('shared-team@example.com', {
        accessRole: 'writer', summaryOverride: 'Team Calendar', primary: false,
      })),
    },
    {
      method: 'GET',
      path: '/calendar/v3/users/me/calendarList/missing%40example.com',
      response: () => googleJson({ error: { errors: [{ reason: 'notFound' }] } }, { status: 404 }),
    },
  ]);
  const kinds: string[] = [];
  const api = new CalendarDiscoveryApi({ fetcher: fake.fetcher, now: clock });
  const base = discoveryInput({ consumeRequest: async kind => { kinds.push(kind); } });
  const found = await api.checkTarget({ ...base, calendarId: 'shared-team@example.com' });
  expect(found).toMatchObject({
    calendarId: 'shared-team@example.com',
    label: 'Team Calendar',
    accessRole: 'writer',
    capabilities: { readEvents: true, createEvents: true, availability: true },
  });
  const missing = await api.checkTarget({ ...base, calendarId: 'missing@example.com' });
  expect(missing).toBeNull();
  expect(kinds).toEqual(['capability-recheck', 'capability-recheck']);
  expect(fake.requests).toHaveLength(2);
  await expect(api.checkTarget({ ...base, calendarId: 'primary' })).rejects.toThrow('CALENDAR_INPUT_REJECTED');
});
