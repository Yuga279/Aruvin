import { describe, expect, it, vi } from 'vitest';
import { CalendarClientError, createCalendarClient } from './calendar-client.ts';
import { CALENDAR_CSRF_HEADER, CALENDAR_CSRF_VALUE } from './calendar-protocol.ts';
import {
  calendarPage,
  multiStatus,
} from '../features/plugins/google-calendar/testing/multi-calendar-fixtures.ts';

const validStatus = {
  protocolVersion: 1 as const,
  state: 'connected' as const,
  enabled: true,
  accountEmail: 'operator@example.com',
  targetCalendarId: 'disposable-cal-1@group.calendar.google.com',
  processingDisclosure: {
    policyId: 'policy-1',
    processors: 'Google, OpenRouter and the configured model provider' as const,
    dataCollection: 'deny' as const,
  },
};

describe('CalendarClient', () => {
  it('reads status with no-store and no query string', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(validStatus));
    const client = createCalendarClient({ baseUrl: '/api', fetch: fetcher });

    const status = await client.getStatus();
    expect(status).toEqual(validStatus);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/plugins/google-calendar/status',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
      }),
    );
  });

  it('sends CSRF header and strict JSON body on settings, oauthStart, and disconnect', async () => {
    const oauthUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Fplugins%2Fgoogle-calendar%2Foauth%2Fcallback&response_type=code&state=s1';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...validStatus, enabled: false, state: 'disabled' }))
      .mockResolvedValueOnce(Response.json({ authorizationUrl: oauthUrl }))
      .mockResolvedValueOnce(
        Response.json({ disconnected: true, remoteRevocation: 'confirmed' }),
      );

    const client = createCalendarClient({ baseUrl: '/api', fetch: fetcher });

    const updated = await client.updateSettings({ enabled: false });
    expect(updated.enabled).toBe(false);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/plugins/google-calendar/settings',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [CALENDAR_CSRF_HEADER]: CALENDAR_CSRF_VALUE,
        }),
        body: JSON.stringify({ enabled: false }),
      }),
    );

    const started = await client.startOAuth();
    expect(started.authorizationUrl).toBe(oauthUrl);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/plugins/google-calendar/oauth/start',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [CALENDAR_CSRF_HEADER]: CALENDAR_CSRF_VALUE,
        }),
        body: '{}',
      }),
    );

    const disconnected = await client.disconnect({
      mode: 'revoke-google-grant',
      acknowledgeProjectWideRevocation: true,
    });
    expect(disconnected).toEqual({ disconnected: true, remoteRevocation: 'confirmed' });
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      '/api/plugins/google-calendar/disconnect',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [CALENDAR_CSRF_HEADER]: CALENDAR_CSRF_VALUE,
        }),
        body: JSON.stringify({
          mode: 'revoke-google-grant',
          acknowledgeProjectWideRevocation: true,
        }),
      }),
    );
  });

  it('rejects unsafe OAuth URLs and maps server errors to safe CalendarClientError instances', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ authorizationUrl: 'https://evil.example.com/o/oauth2/v2/auth' }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            code: 'CONFLICT_ACTIVE_TURN',
            message: 'Another Calendar setup change is already in progress.',
            retryable: false,
          },
          { status: 409 },
        ),
      );

    const client = createCalendarClient({ baseUrl: '/api', fetch: fetcher });

    await expect(client.startOAuth()).rejects.toBeInstanceOf(CalendarClientError);
    await expect(client.updateSettings({ enabled: true })).rejects.toMatchObject({
      name: 'CalendarClientError',
      code: 'CONFLICT_ACTIVE_TURN',
      status: 409,
    });
  });

  it('encodes one calendar page token and keeps preference saves independent', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(calendarPage()))
      .mockResolvedValueOnce(Response.json(multiStatus()))
      .mockResolvedValueOnce(Response.json(calendarPage()));
    const client = createCalendarClient({ baseUrl: '/api', fetch: fetcher });
    await client.listCalendars({ pageToken: 'a+b/c= d' });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      '/api/plugins/google-calendar/calendars?pageToken=a%2Bb%2Fc%3D+d',
    );
    await client.updateSettings({
      defaultSetting: {
        calendarId: null,
        expectedRevision: 7,
        expectedConnectionRevision: 3,
      },
    });
    const settings = fetcher.mock.calls[1]?.[1];
    expect(JSON.parse(String(settings?.body))).toEqual({
      defaultSetting: {
        calendarId: null,
        expectedRevision: 7,
        expectedConnectionRevision: 3,
      },
    });
    expect(settings?.headers).toEqual(
      expect.objectContaining({
        [CALENDAR_CSRF_HEADER]: CALENDAR_CSRF_VALUE,
      }),
    );
    await client.refreshCalendars({ expectedConnectionRevision: 3 });
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      body: '{"expectedConnectionRevision":3}',
    });
  });

  it('returns a conflict without retrying or echoing an untrusted server message', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          code: 'CONFLICT_ACTIVE_TURN',
          message: 'provider secret payload',
          retryable: true,
        },
        { status: 409 },
      ),
    );
    const client = createCalendarClient({ fetch: fetcher });
    await expect(
      client.updateSettings({
        defaultSetting: {
          calendarId: 'team@example.com',
          expectedRevision: 7,
          expectedConnectionRevision: 3,
        },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT_ACTIVE_TURN',
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.getStatus().catch((error: CalendarClientError) => {
      expect(error.message).not.toContain('secret payload');
    });
  });

  it('rejects invalid query tokens, overlong tokens, unknown query keys, and missing revisions before fetch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createCalendarClient({ fetch: fetcher });

    // Empty token
    await expect(client.listCalendars({ pageToken: '' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    // Overlong token > 2048
    await expect(client.listCalendars({ pageToken: 'a'.repeat(2049) })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    // Unknown query key
    await expect(
      client.listCalendars({ pageToken: 'tok', unexpected: true } as any),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetcher).not.toHaveBeenCalled();

    // Invalid refresh revisions
    await expect(client.refreshCalendars({ expectedConnectionRevision: 0 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(client.refreshCalendars({ expectedConnectionRevision: -5 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetcher).not.toHaveBeenCalled();

    // Forbidden client overrides
    await expect(
      client.updateSettings({ enabled: true, userId: 'spoofed' } as any),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('handles abort, timeout, oversize payloads, and rejects v1 acknowledgement for preference save', async () => {
    // Aborted signal
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(multiStatus()));
    const client = createCalendarClient({ fetch: fetcher });

    await expect(client.getStatus(controller.signal)).rejects.toMatchObject({
      code: 'ABORTED',
      uncertain: false,
    });

    // Timeout with fake timers
    vi.useFakeTimers();
    try {
      const slowFetcher = vi.fn<typeof fetch>((_url, init) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });
      const slowClient = createCalendarClient({ fetch: slowFetcher });
      const promise = slowClient.getStatus();
      vi.advanceTimersByTime(21_000);
      await expect(promise).rejects.toMatchObject({
        code: 'TIMEOUT',
        retryable: true,
      });
    } finally {
      vi.useRealTimers();
    }

    // Oversize response payload > 16384 bytes
    const hugeFetcher = vi.fn<typeof fetch>(async () =>
      new Response('{"data":"' + 'x'.repeat(17000) + '"}', {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const hugeClient = createCalendarClient({ fetch: hugeFetcher });
    await expect(hugeClient.getStatus()).rejects.toMatchObject({
      code: 'INVALID_CALENDAR_RESPONSE',
    });

    // Preference save rejecting v1 status acknowledgement as uncertain
    const v1Fetcher = vi.fn<typeof fetch>(async () => Response.json(validStatus));
    const v1Client = createCalendarClient({ fetch: v1Fetcher });
    await expect(
      v1Client.updateSettings({
        defaultSetting: {
          calendarId: 'team@example.com',
          expectedRevision: 7,
          expectedConnectionRevision: 3,
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CALENDAR_RESPONSE',
      uncertain: true,
    });
  });
});
