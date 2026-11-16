import { describe, expect, it, vi } from 'vitest';
import { calendarHttp } from '../../../src/plugins/google-calendar/calendar-api-http.js';
import { googleJson } from './tools-fixtures.js';

const json = (body: unknown, init?: ResponseInit) => googleJson(body, init);

const context = (overrides: Partial<Parameters<typeof calendarHttp>[0]> = {}) => ({
  fetcher: async () => json({ ok: true }),
  path: '/calendars/owned/events',
  method: 'GET' as const,
  query: new URLSearchParams(),
  accessToken: 'fixture-token',
  signal: new AbortController().signal,
  deadlineAt: new Date(Date.now() + 10000).toISOString(),
  consumeRequest: async () => { /* counted by the caller */ },
  ...overrides,
});

describe('bounded Calendar delivery', () => {
  it.each([true, false])('classifies invalid response fields separately for write=%s', async write => {
    const fault = await calendarHttp(context({ method: write ? 'POST' : 'GET', write,
      fetcher: async () => json({ error: { message: 'Invalid field selection extendedProperties.private' } }, { status: 400 }),
    })).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.code', write ? 'CALENDAR_RESPONSE_FIELDS_INVALID' : 'CALENDAR_INPUT_REJECTED');
    expect(fault).toHaveProperty('failure.category', write ? 'uncertain' : 'clarification');
    expect(String(fault)).not.toContain('extendedProperties.private');
  });
  it('returns rate rejection without waiting when no retry will be dispatched', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async () => json({}, { status: 429,
      headers: { 'retry-after': '3' } }));
    try {
      await expect(calendarHttp(context({ fetcher, signal: abort.signal })))
        .rejects.toMatchObject({ failure: { code: 'CALENDAR_RATE_LIMITED', retry: 'delivery-same-id' } });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { abort.abort(); }
  }, 1500);
  it.each(['malformed-json', 'wrong-content-type', 'oversized', 'cancelled-body'] as const)
    ('keeps a successful write with %s response uncertain, never definitely failed', async kind => {
      const controller = new AbortController();
      const response = new Response(kind === 'malformed-json' ? '{broken' : '{}', { headers: {
          'content-type': kind === 'wrong-content-type' ? 'text/html' : 'application/json',
          ...(kind === 'oversized' ? { 'content-length': '999999' } : {}),
        } });
      // Abort only after fetch dispatched, not during initial request admission.
      const fault = await calendarHttp(context({ method: 'POST', write: true, signal: controller.signal,
        fetcher: async () => { if (kind === 'cancelled-body') controller.abort(); return response; },
      })).catch((error: unknown) => error);
      expect(fault).toHaveProperty('failure.category', 'uncertain');
      expect(fault).toHaveProperty('failure.retry', 'readback');
    });
  it('cancels oversized error bodies without leaking provider content', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new TextEncoder().encode('secret'.repeat(10000))); },
      cancel() { cancelled = true; },
    }), { status: 503, headers: { 'content-type': 'application/json' } });
    let consumed = 0;
    const fault = await calendarHttp(context({
      fetcher: async () => response,
      consumeRequest: async () => { consumed++; },
    })).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.category', 'delivery');
    expect(String(fault)).not.toContain('secret');
    expect(cancelled).toBe(true);
    expect(consumed).toBe(1);
  });

  it('accepts a body at the exact limit and rejects one byte more', async () => {
    const limit = 262144;
    const exactBody = `{"s":"${'x'.repeat(limit - 8)}"}`;
    expect(exactBody.length).toBe(limit);
    const ok = await calendarHttp(context({
      fetcher: async () => new Response(exactBody, { headers: { 'content-type': 'application/json' } }),
    })).catch((error: unknown) => error);
    expect(ok).toHaveProperty('body.s', 'x'.repeat(limit - 8));
    const overBody = `{"s":"${'x'.repeat(limit - 7)}"}`;
    expect(overBody.length).toBe(limit + 1);
    const over = await calendarHttp(context({
      fetcher: async () => new Response(overBody, { headers: { 'content-type': 'application/json' } }),
    })).catch((error: unknown) => error);
    expect(over).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_INVALID');
  });

  it('decodes multibyte UTF-8 split across chunks', async () => {
    const text = 'é✓漢';
    const bytes = new TextEncoder().encode(JSON.stringify(text));
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        controller.enqueue(bytes.slice(1, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    }), { headers: { 'content-type': 'application/json' } });
    const result = await calendarHttp(context({ fetcher: async () => response }));
    expect(result.body).toBe(text);
  });

  it('rejects malformed UTF-8 and malformed JSON without echoing content', async () => {
    const bad = await calendarHttp(context({
      fetcher: async () => new Response(new Uint8Array([0xff, 0xfe, 0xfd]),
        { headers: { 'content-type': 'application/json' } }),
    })).catch((error: unknown) => error);
    expect(bad).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_INVALID');
    const broken = await calendarHttp(context({
      fetcher: async () => new Response('{not json', { headers: { 'content-type': 'application/json' } }),
    })).catch((error: unknown) => error);
    expect(broken).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_INVALID');
    expect(String(broken)).not.toContain('not json');
  });

  it('rejects an empty body and a wrong content type', async () => {
    const empty = await calendarHttp(context({
      fetcher: async () => new Response('', { headers: { 'content-type': 'application/json' } }),
    })).catch((error: unknown) => error);
    expect(empty).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_INVALID');
    const wrong = await calendarHttp(context({
      fetcher: async () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
    })).catch((error: unknown) => error);
    expect(wrong).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_INVALID');
  });

  it('enforces the actual streamed size over a falsely small content length', async () => {
    const response = new Response('x'.repeat(262145), {
      headers: { 'content-type': 'application/json', 'content-length': '10' },
    });
    const fault = await calendarHttp(context({ fetcher: async () => response }))
      .catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_INVALID');
  });

  it('rejects an oversized declared content length before reading', async () => {
    const fault = await calendarHttp(context({
      fetcher: async () => new Response('{}', {
        headers: { 'content-type': 'application/json', 'content-length': '999999' },
      }),
    })).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_INVALID');
  });

  it('never follows a redirect', async () => {
    let seen: Request | undefined;
    const fault = await calendarHttp(context({
      fetcher: async (input, init) => {
        seen = new Request(input as Request, init);
        return new Response('', { status: 302, headers: { location: 'https://evil.example/x' } });
      },
    })).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.category', 'delivery');
    expect(seen?.redirect).toBe('error');
  });

  it('cancels before dispatch when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const fault = await calendarHttp(context({
      signal: controller.signal,
      fetcher: async () => { called = true; return json({}); },
    })).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.code', 'CALENDAR_CANCELLED');
    expect(fault).toHaveProperty('failure.category', 'cancelled');
    expect(called).toBe(false);
  });

  it('treats a timeout as a delivery failure without retrying', async () => {
    let called = 0;
    const fault = await calendarHttp(context({
      deadlineAt: new Date(Date.now() - 1).toISOString(),
      fetcher: async () => { called++; return json({}); },
    })).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.category', 'delivery');
    expect(called).toBe(0);
  });

  it('returns a persistence failure when request admission rejects and sends nothing', async () => {
    let called = false;
    const fault = await calendarHttp(context({
      consumeRequest: async () => { throw new Error('budget exhausted'); },
      fetcher: async () => { called = true; return json({}); },
    })).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.category', 'persistence');
    expect(fault).toHaveProperty('failure.retry', 'none');
    expect(called).toBe(false);
  });

  it('classifies a network rejection as a safe delivery failure', async () => {
    const fault = await calendarHttp(context({
      fetcher: async () => { throw new TypeError('fetch failed'); },
    })).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure.category', 'delivery');
    expect(fault).toHaveProperty('failure.retry', 'delivery-same-id');
    expect(String(fault)).not.toContain('fetch failed');
  });

  it('maps provider statuses to bounded allowlisted failures', async () => {
    const cases: Array<[number, unknown, string, string, string]> = [
      [401, {}, 'credential', 'RECONNECT_REQUIRED', 'none'],
      [403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }, 'policy', 'CALENDAR_FORBIDDEN', 'none'],
      [403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 'delivery', 'CALENDAR_RATE_LIMITED', 'delivery-same-id'],
      [403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 'delivery', 'CALENDAR_RATE_LIMITED', 'delivery-same-id'],
      [429, {}, 'delivery', 'CALENDAR_RATE_LIMITED', 'delivery-same-id'],
      [404, {}, 'delivery', 'EVENT_NOT_FOUND', 'none'],
      [400, {}, 'clarification', 'CALENDAR_INPUT_REJECTED', 'none'],
      [500, {}, 'delivery', 'CALENDAR_TEMPORARILY_UNAVAILABLE', 'delivery-same-id'],
      [503, {}, 'delivery', 'CALENDAR_TEMPORARILY_UNAVAILABLE', 'delivery-same-id'],
      [418, {}, 'delivery', 'CALENDAR_RESPONSE_INVALID', 'none'],
    ];
    for (const [status, body, category, code, retry] of cases) {
      const fault = await calendarHttp(context({
        fetcher: async () => json(body, { status }),
      })).catch((error: unknown) => error);
      expect(fault).toHaveProperty('failure.category', category);
      expect(fault).toHaveProperty('failure.code', code);
      expect(fault).toHaveProperty('failure.retry', retry);
    }
  });

  it('never leaks provider prose into a failure', async () => {
    const fault = await calendarHttp(context({
      fetcher: async () => json({ error: { message: 'Access denied for user jane@example.com',
        domain: 'global', errors: [{ message: 'token ya29.abcdef expired', reason: 'insufficientPermissions' }] } },
        { status: 403 }),
    })).catch((error: unknown) => error);
    const text = String(fault);
    expect(text).not.toContain('jane@example.com');
    expect(text).not.toContain('ya29');
    expect(text).not.toContain('Access denied');
  });

  it('sends one bounded request with fixed origin, method and headers', async () => {
    const requests: Request[] = [];
    await calendarHttp(context({
      method: 'POST',
      query: new URLSearchParams({ sendUpdates: 'none', pageToken: 'a&pageToken=b' }),
      body: { id: 'abc', summary: 'Visit' },
      fetcher: async (input, init) => {
        requests.push(new Request(input as Request, init));
        return json({ id: 'abc' });
      },
    }));
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url.startsWith('https://www.googleapis.com/calendar/v3/')).toBe(true);
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toBe('Bearer fixture-token');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.get('accept')).toBe('application/json');
    const query = new URL(request.url).searchParams;
    expect(query.get('pageToken')).toBe('a&pageToken=b');
    expect(query.getAll('pageToken')).toEqual(['a&pageToken=b']);
    expect(await request.json()).toEqual({ id: 'abc', summary: 'Visit' });
  });

  it('keeps daily quota terminal and distinct from secondary rate limits', async () => {
    let calls = 0;
    const fault = await calendarHttp(context({ fetcher: async () => {
      calls++;
      return json({ error: { message: 'private-provider-prose', errors: [
        { reason: 'quotaExceeded' }, { reason: 'rateLimitExceeded' },
      ] } }, { status: 403 });
    } })).catch((error: unknown) => error);
    expect(fault).toHaveProperty('failure', {
      category: 'delivery', code: 'CALENDAR_QUOTA_EXCEEDED', retry: 'none',
    });
    expect(calls).toBe(1);
    expect(String(fault)).not.toContain('private-provider-prose');
  });

  it('honors a lower response byte allowance without raising the global ceiling', async () => {
    const exact = '{"s":"é"}';
    const bytes = Buffer.byteLength(exact, 'utf8');
    const good = await calendarHttp(context({ responseBytes: bytes,
      fetcher: async () => new Response(exact, { headers: { 'content-type': 'application/json' } }),
    }));
    expect(good.body).toEqual({ s: 'é' });
    expect(good.bodyBytes).toBe(bytes);
    await expect(calendarHttp(context({ responseBytes: bytes - 1,
      fetcher: async () => new Response(exact, { headers: { 'content-type': 'application/json' } }),
    }))).rejects.toThrow('CALENDAR_RESPONSE_INVALID');
    await expect(calendarHttp(context({ responseBytes: 262145,
      fetcher: async () => json({}),
    }))).rejects.toThrow('CALENDAR_RESPONSE_INVALID');
  });

  it('distinguishes an opted-in byte overflow from malformed provider JSON', async () => {
    const over = await calendarHttp(context({ responseBytes: 10,
      responseByteFailure: 'CALENDAR_RESPONSE_TOO_LARGE',
      fetcher: async () => new Response('{"s":"xxxxxxxx"}', { headers: { 'content-type': 'application/json' } }),
    })).catch((error: unknown) => error);
    expect(over).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_TOO_LARGE');
    const malformed = await calendarHttp(context({ responseBytes: 100,
      responseByteFailure: 'CALENDAR_RESPONSE_TOO_LARGE',
      fetcher: async () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    })).catch((error: unknown) => error);
    expect(malformed).toHaveProperty('failure.code', 'CALENDAR_RESPONSE_INVALID');
  });

  it('calculates transport timeout from the deadline remaining after admission', async () => {
    const durations: number[] = [];
    let at = Date.parse('2026-10-22T10:00:00.000Z');
    const end = at + 100;
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      durations.push(ms); return new AbortController().signal;
    });
    try {
      await calendarHttp(context({ now: () => at, deadlineAt: new Date(end).toISOString(),
        consumeRequest: async () => { at += 80; }, fetcher: async () => json({ ok: true }) }));
      expect(durations).toEqual([20]);
    } finally { spy.mockRestore(); }
  });

  it('observes actual attempted and received delivery without leaking errors or changing admission', async () => {
    const facts: Record<string, unknown>[] = [];
    const diagnostic = (f: Readonly<Record<string, unknown>>) => { facts.push({ ...f }); };
    const fetcher = vi.fn<typeof fetch>(async () => json({ error: { message: 'SECRET_BODY' } }, { status: 400 }));
    await expect(calendarHttp(context({ diagnostic, fetcher }))).rejects.toHaveProperty('failure.code', 'CALENDAR_INPUT_REJECTED');
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'provider-request', provider: 'google-calendar', delivery: 'attempted' }),
      expect.objectContaining({ stage: 'provider-response', provider: 'google-calendar', delivery: 'response-received', statusClass: '4xx' }),
      expect.objectContaining({ reason: 'provider-4xx', origin: 'provider', code: 'CALENDAR_INPUT_REJECTED' }),
    ]));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(facts)).not.toContain('SECRET_BODY');
    expect(JSON.stringify(facts)).not.toContain('fixture-token');
    facts.length = 0;
    fetcher.mockClear();
    await expect(calendarHttp(context({ diagnostic, fetcher,
      consumeRequest: async () => { throw new Error('SECRET_ADMISSION'); },
    }))).rejects.toHaveProperty('failure.code', 'CALENDAR_REQUEST_NOT_ADMITTED');
    expect(fetcher).not.toHaveBeenCalled();
    expect(facts.some(f => f.delivery === 'attempted')).toBe(false);
    expect(facts).toContainEqual(expect.objectContaining({ origin: 'local', delivery: 'not-sent' }));
  });
});
