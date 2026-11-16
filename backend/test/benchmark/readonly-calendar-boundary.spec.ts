/**
 * ============================================================================
 * FILE: readonly-calendar-boundary.spec.ts
 * LOCATION: backend/test/benchmark/readonly-calendar-boundary.spec.ts
 * PURPOSE: Verify injected Calendar egress denial without any real transport.
 * ROLE IN PROJECT: Offline I4 safety checks, not live permission or acceptance.
 * KEY COMPONENTS: Method/target/query/budget/deadline/response denial checks.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { createReadOnlyCalendarBoundary } from '../../src/benchmark/readonly-calendar-boundary.js';
import { CalendarApi } from '../../src/plugins/google-calendar/calendar-api.js';
import { multiBinding, multiContext, multiOperation, multiTarget } from '../plugins/google-calendar/tools-multi-fixtures.js';

const policy = () => ({ calendarId: 'owned', start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z',
  maxResults: 20, maxRequests: 2, maxResponseBytes: 1024, deadlineMs: 1000 });
function url() {
  const p = policy();
  const u = new URL('https://www.googleapis.com/calendar/v3/calendars/owned/events');
  u.search = new URLSearchParams({ timeMin: p.start, timeMax: p.end, maxResults: '20',
    singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime', timeZone: 'Etc/UTC',
    fields: 'timeZone,nextPageToken,items(id,summary,start,end,status,htmlLink,description,location,visibility)' }).toString();
  return u;
}
const response = () => new Response('{"timeZone":"Etc/UTC","items":[]}', { headers: { 'content-type': 'application/json' } });

it('allows the actual production list projection only through the injected boundary', async () => {
  const upstream = vi.fn<typeof fetch>(async () => response());
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 0);
  const api = new CalendarApi({ fetcher: boundary.fetch });
  const result = await api.list(multiContext(multiTarget('owner', 'owned')),
    { timeMin: policy().start, timeMax: policy().end, maxResults: 20 });
  expect(result.result).toMatchObject({ tool: 'calendar_list_events', events: [] });
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(upstream.mock.calls[0][1]?.redirect).toBe('error');
});

it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])('denies %s before transport, then latches closed', async method => {
  const upstream = vi.fn<typeof fetch>(async () => response());
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 0);
  await expect(boundary.fetch(url(), { method })).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  await expect(boundary.fetch(url())).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).not.toHaveBeenCalled();
});

it('denies production create before the injected upstream', async () => {
  const upstream = vi.fn<typeof fetch>(async () => response());
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 0);
  const api = new CalendarApi({ fetcher: boundary.fetch });
  const target = multiTarget('owner', 'owned'), operation = multiOperation(target);
  const context = { ...multiContext(target), binding: multiBinding(target, operation) };
  await expect(api.create(context, operation)).rejects.toBeDefined();
  await expect(boundary.fetch(url())).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).not.toHaveBeenCalled();
});

it.each([
  (u: URL) => { u.hostname = 'example.com'; },
  (u: URL) => { u.pathname = '/calendar/v3/calendars/other/events'; },
  (u: URL) => { u.pathname = '/calendar/v3/users/me/calendarList'; },
  (u: URL) => { u.searchParams.set('timeMin', '2026-01-01T00:00:00Z'); },
  (u: URL) => { u.searchParams.set('maxResults', '21'); },
  (u: URL) => { u.searchParams.set('pageToken', 'private'); },
  (u: URL) => { u.searchParams.set('fields', '*'); },
  (u: URL) => { u.searchParams.append('timeMin', policy().start); },
  (u: URL) => { u.hash = 'private'; },
])('denies an out-of-scope request before transport %#', async change => {
  const upstream = vi.fn<typeof fetch>(async () => response());
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 0);
  const u = url(); change(u);
  await expect(boundary.fetch(u)).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).not.toHaveBeenCalled();
});

it('normalizes native Request method', async () => {
  const upstream = vi.fn<typeof fetch>(async () => response());
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 0);
  await expect(boundary.fetch(new Request(url(), { method: 'POST' }))).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).not.toHaveBeenCalled();
});

it('reserves request count before concurrent dispatch and counts failed requests', async () => {
  const upstream = vi.fn<typeof fetch>(async () => { throw new Error('PRIVATE'); });
  const boundary = createReadOnlyCalendarBoundary({ ...policy(), maxRequests: 1 }, upstream, () => 0);
  const settled = await Promise.allSettled([boundary.fetch(url()), boundary.fetch(url())]);
  expect(settled.every(v => v.status === 'rejected')).toBe(true);
  expect(upstream).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(settled)).not.toContain('PRIVATE');
});

it('rejects expired/invalid policy without transport', async () => {
  const upstream = vi.fn<typeof fetch>(async () => response());
  expect(() => createReadOnlyCalendarBoundary({ ...policy(), maxRequests: 0 }, upstream)).toThrow();
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 1000);
  await expect(boundary.fetch(url())).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).not.toHaveBeenCalled();
});

it.each([
  () => new Response('too big'.repeat(200)),
  () => new Response(null, { status: 302, headers: { location: 'https://example.com' } }),
  () => new Response('private', { status: 500 }),
])('stops on oversized/error/redirect response %#', async makeResponse => {
  const upstream = vi.fn<typeof fetch>(async () => makeResponse());
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 0);
  await expect(boundary.fetch(url())).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  await expect(boundary.fetch(url())).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).toHaveBeenCalledTimes(1);
});

it('aborts stalled synthetic transport at the remaining deadline with no retry', async () => {
  const upstream = vi.fn<typeof fetch>(async () => new Promise<Response>(() => {}));
  const boundary = createReadOnlyCalendarBoundary({ ...policy(), deadlineMs: 10 }, upstream, () => 0);
  await expect(boundary.fetch(url())).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).toHaveBeenCalledTimes(1);
});

it('parent shutdown revokes even a retained boundary and prevents new reads', async () => {
  const upstream = vi.fn<typeof fetch>(async () => response()), stop = new AbortController();
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 0, stop.signal);
  stop.abort();
  await expect(boundary.fetch(url())).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).not.toHaveBeenCalled();
});

it('bounds a stalled response body, not just response headers', async () => {
  let cancelled = false;
  const upstream = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
  })));
  const boundary = createReadOnlyCalendarBoundary({ ...policy(), deadlineMs: 10 }, upstream, () => 0);
  await expect(boundary.fetch(url())).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(cancelled).toBe(true);
});

it('copies policy at construction and forces redirects off without changing caller options', async () => {
  const upstream = vi.fn<typeof fetch>(async () => response()), p = policy();
  const boundary = createReadOnlyCalendarBoundary(p, upstream, () => 0);
  p.calendarId = 'other';
  const init: RequestInit = { redirect: 'follow' };
  await boundary.fetch(url(), init);
  expect(init.redirect).toBe('follow');
  expect(upstream.mock.calls[0][1]?.redirect).toBe('error');
});

it('denies method-override headers before egress', async () => {
  const upstream = vi.fn<typeof fetch>(async () => response());
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 0);
  await expect(boundary.fetch(url(), { headers: { 'x-http-method-override': 'POST' } })).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).not.toHaveBeenCalled();
});

it('caps cumulative response bytes across allowed reads, not only each response', async () => {
  const upstream = vi.fn<typeof fetch>(async () => new Response('x'.repeat(600)));
  const boundary = createReadOnlyCalendarBoundary(policy(), upstream, () => 0);
  await boundary.fetch(url());
  await expect(boundary.fetch(url())).rejects.toThrow('READONLY_BOUNDARY_DENIED');
  expect(upstream).toHaveBeenCalledTimes(2);
});
