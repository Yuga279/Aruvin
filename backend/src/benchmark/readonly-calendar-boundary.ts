/**
 * ============================================================================
 * FILE: readonly-calendar-boundary.ts
 * LOCATION: backend/src/benchmark/readonly-calendar-boundary.ts
 * PURPOSE: Bound selected Calendar list egress at an explicitly injected fetch.
 * ROLE IN PROJECT: Prepared boundary; not installed in production composition.
 * KEY COMPONENTS: createReadOnlyCalendarBoundary.
 * ============================================================================
 */
import { z } from 'zod';

export const readOnlyCalendarPolicySchema = z.object({
  calendarId: z.string().min(1).max(1024).refine(v => !['.', '..'].includes(v)
    && v.split('').every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)),
  start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }),
  maxResults: z.number().int().min(1).max(20), maxRequests: z.number().int().min(1).max(40),
  maxResponseBytes: z.number().int().min(1).max(262144), deadlineMs: z.number().finite().nonnegative(),
}).strict().refine(v => Date.parse(v.end) > Date.parse(v.start)
  && Date.parse(v.end) - Date.parse(v.start) <= 3600000);
export type ReadOnlyCalendarPolicy = z.infer<typeof readOnlyCalendarPolicySchema>;

/** No default/global fetch: installation at ALL server egress paths remains separate work. */
export function createReadOnlyCalendarBoundary(raw: ReadOnlyCalendarPolicy, upstream: typeof fetch,
  now: () => number = () => performance.now(), parent?: AbortSignal): { fetch: typeof fetch; signal: AbortSignal } {
  const parsed = readOnlyCalendarPolicySchema.safeParse(raw);
  if (!parsed.success) throw new Error('READONLY_BOUNDARY_DENIED');
  const policy = parsed.data;
  let requests = 0, receivedBytes = 0, blocked = false;
  const stop = new AbortController();
  const lifetime = parent ? AbortSignal.any([stop.signal, parent]) : stop.signal;
  function deny(): never { blocked = true; stop.abort(); throw new Error('READONLY_BOUNDARY_DENIED'); }
  const fetcher: typeof fetch = async (input, init) => {
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const remaining = policy.deadlineMs - now();
      if (blocked || lifetime.aborted || !Number.isFinite(remaining) || remaining <= 0 || requests >= policy.maxRequests) deny();
      const request = new Request(input, init), url = new URL(request.url);
      if (request.method !== 'GET' || request.body || url.origin !== 'https://www.googleapis.com'
        || url.username || url.password || url.hash
        || [...request.headers.keys()].some(key => key !== 'accept' && key !== 'authorization')
        || url.pathname !== `/calendar/v3/calendars/${encodeURIComponent(policy.calendarId)}/events`) deny();
      // Exact current CalendarApi list projection; drift is denied, never broadened automatically.
      const expected = new URLSearchParams({ timeMin: policy.start, timeMax: policy.end,
        maxResults: url.searchParams.get('maxResults') ?? '', singleEvents: 'true', showDeleted: 'false',
        orderBy: 'startTime', timeZone: 'Etc/UTC',
        fields: 'timeZone,nextPageToken,items(id,summary,start,end,status,htmlLink,description,location,visibility)' });
      const count = url.searchParams.get('maxResults') ?? '';
      if (!/^[1-9]\d*$/u.test(count) || Number(count) > policy.maxResults
        || [...url.searchParams].length !== [...expected].length
        || [...expected].some(([key, value]) => url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value)) deny();
      requests++; // Reserve synchronously before awaiting: failures/parallel calls cannot reuse budget.
      const signal = AbortSignal.any([request.signal, lifetime, AbortSignal.timeout(Math.ceil(remaining))]);
      const wait = async <T>(work: Promise<T>): Promise<T> => {
        let abort = () => {};
        const cancelled = new Promise<never>((_resolve, reject) => {
          abort = () => reject(new Error('READONLY_BOUNDARY_DENIED'));
          if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
        });
        try { return await Promise.race([work, cancelled]); }
        finally { signal.removeEventListener('abort', abort); }
      };
      response = await wait(upstream(request.url, { method: 'GET', headers: request.headers,
        redirect: 'error', credentials: 'omit', signal }));
      if (blocked || signal.aborted || now() >= policy.deadlineMs || !response.ok || response.redirected || !response.body) deny();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const chunk = await wait(reader.read());
        if (signal.aborted || now() >= policy.deadlineMs) deny();
        if (chunk.done) break;
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > policy.maxResponseBytes) deny();
        chunks.push(chunk.value);
      }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
    } catch {
      // Never echo upstream errors, URLs, tokens or response bodies. A denial poisons the whole boundary.
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
      return deny();
    } finally { reader?.releaseLock(); }
  };
  return { fetch: fetcher, signal: lifetime };
}
