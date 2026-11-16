/**
 * ============================================================================
 * FILE: calendar-client.ts
 * LOCATION: frontend/src/api/calendar-client.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide bounded HTTP client for Google Calendar setup, discovery, and settings.
 *
 * ROLE IN PROJECT:
 *    Interacts with backend Calendar endpoints enforcing CSRF, no-store,
 *    timeout/abort bounds, cached pagination, and safe error message mapping.
 *
 * KEY COMPONENTS:
 *    - CalendarClient / CalendarMultiClient: Type contracts for plugin operations.
 *    - createCalendarClient: Factory returning wired client instance.
 *    - CalendarClientError: Structured error preserving status, retryable, and uncertain flags.
 * ============================================================================
 */

import {
  CALENDAR_API_ROUTES,
  CALENDAR_CSRF_HEADER,
  CALENDAR_CSRF_VALUE,
  isCalendarCalendarsResponse,
  isCalendarDisconnectRequest,
  isCalendarDisconnectResponse,
  isCalendarOAuthStartResponse,
  isCalendarPublicStatus,
  isCalendarRefreshRequest,
  isCalendarSettingsRequest,
  type CalendarCalendarsResponse,
  type CalendarDisconnectRequest,
  type CalendarDisconnectResponse,
  type CalendarOAuthStartResponse,
  type CalendarPublicStatus,
  type CalendarRefreshRequest,
  type CalendarSettingsRequest,
} from './calendar-protocol.ts';
import { assertNoClientOverrides } from './protocol.ts';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 16_384;
const DEFAULT_ERROR_MESSAGE = 'Calendar setup request could not be completed.';

export class CalendarClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly uncertain: boolean;

  constructor(options: {
    code: string;
    message?: string;
    status?: number;
    retryable?: boolean;
    uncertain?: boolean;
  }) {
    super(options.message ?? DEFAULT_ERROR_MESSAGE);
    this.name = 'CalendarClientError';
    this.code = options.code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
    this.uncertain = options.uncertain ?? false;
  }
}

export type CalendarClient = {
  getStatus(signal?: AbortSignal): Promise<CalendarPublicStatus>;
  updateSettings(
    request: CalendarSettingsRequest,
    signal?: AbortSignal,
  ): Promise<CalendarPublicStatus>;
  startOAuth(signal?: AbortSignal): Promise<CalendarOAuthStartResponse>;
  disconnect(
    request: CalendarDisconnectRequest,
    signal?: AbortSignal,
  ): Promise<CalendarDisconnectResponse>;
  listCalendars?(
    query?: { pageToken?: string },
    signal?: AbortSignal,
  ): Promise<CalendarCalendarsResponse>;
  refreshCalendars?(
    request: CalendarRefreshRequest,
    signal?: AbortSignal,
  ): Promise<CalendarCalendarsResponse>;
};

export type CalendarMultiClient = CalendarClient &
  Required<Pick<CalendarClient, 'listCalendars' | 'refreshCalendars'>>;

function readViteApiBase(): string | undefined {
  try {
    const env = import.meta.env as { VITE_API_BASE?: string } | undefined;
    return env?.VITE_API_BASE;
  } catch {
    return undefined;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) {
    return response.json();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new CalendarClientError({
        code: 'INVALID_CALENDAR_RESPONSE',
        status: response.status,
      });
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(merged);
  return JSON.parse(text) as unknown;
}

function mapSafeError(
  status: number,
  code: string,
  mutation: boolean,
): { message: string; retryable: boolean; uncertain: boolean } {
  if (status === 409 || code === 'CONFLICT_ACTIVE_TURN') {
    return {
      message: 'Another Calendar setup change is already in progress.',
      retryable: false,
      uncertain: false,
    };
  }
  if (status === 400 || code === 'INVALID_REQUEST') {
    return {
      message: 'Calendar request was invalid or unavailable.',
      retryable: false,
      uncertain: false,
    };
  }
  if (status === 429) {
    return {
      message: 'Too many requests. Please wait before retrying.',
      retryable: !mutation,
      uncertain: false,
    };
  }
  if (status === 503) {
    return {
      message: 'Calendar setup is temporarily unavailable.',
      retryable: !mutation,
      uncertain: false,
    };
  }
  if (status === 504) {
    return {
      message: 'Calendar setup timed out.',
      retryable: !mutation,
      uncertain: mutation,
    };
  }
  if (code === 'PERSISTENCE_ERROR') {
    return {
      message: 'Calendar settings could not be confirmed.',
      retryable: false,
      uncertain: mutation,
    };
  }
  return {
    message: DEFAULT_ERROR_MESSAGE,
    retryable: !mutation && status >= 500,
    uncertain: mutation && status >= 500,
  };
}

export function createCalendarClient(options?: {
  baseUrl?: string;
  fetch?: typeof fetch;
}): CalendarMultiClient {
  const baseUrl = (options?.baseUrl ?? readViteApiBase() ?? '/api').replace(/\/+$/, '');
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);

  async function send<T>(
    method: 'GET' | 'PATCH' | 'POST',
    path: string,
    body: unknown,
    validate: (payload: unknown) => payload is T,
    signal?: AbortSignal,
  ): Promise<T> {
    const mutation = method !== 'GET';
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (mutation) {
        headers['Content-Type'] = 'application/json';
        headers[CALENDAR_CSRF_HEADER] = CALENDAR_CSRF_VALUE;
      }

      if (combined.aborted) {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const response = await fetcher(`${baseUrl}${path}`, {
        method,
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
        headers,
        body: mutation ? JSON.stringify(body ?? {}) : undefined,
        signal: combined,
      });

      let payload: unknown;
      try {
        payload = await readBoundedJson(response);
      } catch {
        throw new CalendarClientError({
          code: 'INVALID_CALENDAR_RESPONSE',
          status: response.status,
          uncertain: mutation,
        });
      }

      if (!response.ok) {
        const record =
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>)
            : null;
        const code = typeof record?.code === 'string' ? record.code : `HTTP_${response.status}`;
        const safe = mapSafeError(response.status, code, mutation);
        throw new CalendarClientError({
          code,
          message: safe.message,
          status: response.status,
          retryable: safe.retryable,
          uncertain: safe.uncertain,
        });
      }

      if (!validate(payload)) {
        throw new CalendarClientError({
          code: 'INVALID_CALENDAR_RESPONSE',
          status: response.status,
          uncertain: mutation,
        });
      }

      return payload;
    } catch (err: unknown) {
      if (err instanceof CalendarClientError) {
        throw err;
      }
      const isAbort =
        combined.aborted ||
        (err instanceof Error && err.name === 'AbortError');
      if (isAbort && signal?.aborted && !timeout.signal.aborted) {
        throw new CalendarClientError({
          code: 'ABORTED',
          message: 'Calendar request was cancelled.',
          retryable: false,
          uncertain: mutation,
        });
      }
      if (isAbort && timeout.signal.aborted) {
        throw new CalendarClientError({
          code: 'TIMEOUT',
          message: 'Calendar setup timed out.',
          retryable: !mutation,
          uncertain: mutation,
        });
      }
      throw new CalendarClientError({
        code: 'NETWORK_ERROR',
        message: 'Calendar setup request failed.',
        retryable: !mutation,
        uncertain: mutation,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getStatus(signal) {
      return send('GET', CALENDAR_API_ROUTES.status, undefined, isCalendarPublicStatus, signal);
    },
    async updateSettings(request, signal) {
      assertNoClientOverrides(request);
      if (!isCalendarSettingsRequest(request)) {
        throw new CalendarClientError({ code: 'INVALID_REQUEST' });
      }
      const isPreferenceMutation = Object.hasOwn(request, 'defaultSetting');
      const validate = (payload: unknown): payload is CalendarPublicStatus => {
        if (!isCalendarPublicStatus(payload)) return false;
        if (isPreferenceMutation && payload.protocolVersion !== 2) return false;
        return true;
      };
      return send('PATCH', CALENDAR_API_ROUTES.settings, request, validate, signal);
    },
    async startOAuth(signal) {
      return send(
        'POST',
        CALENDAR_API_ROUTES.oauthStart,
        {},
        isCalendarOAuthStartResponse,
        signal,
      );
    },
    async disconnect(request, signal) {
      assertNoClientOverrides(request);
      if (!isCalendarDisconnectRequest(request)) {
        throw new CalendarClientError({ code: 'INVALID_REQUEST' });
      }
      return send(
        'POST',
        CALENDAR_API_ROUTES.disconnect,
        request,
        isCalendarDisconnectResponse,
        signal,
      );
    },
    async listCalendars(query = {}, signal) {
      if (
        Object.keys(query).some((key) => key !== 'pageToken') ||
        (Object.hasOwn(query, 'pageToken') &&
          (typeof query.pageToken !== 'string' ||
            query.pageToken.length < 1 ||
            query.pageToken.length > 2048))
      ) {
        throw new CalendarClientError({ code: 'INVALID_REQUEST' });
      }
      const search =
        query.pageToken === undefined
          ? ''
          : `?${new URLSearchParams({ pageToken: query.pageToken })}`;
      return send(
        'GET',
        `${CALENDAR_API_ROUTES.calendars}${search}`,
        undefined,
        isCalendarCalendarsResponse,
        signal,
      );
    },
    async refreshCalendars(request, signal) {
      if (!isCalendarRefreshRequest(request)) {
        throw new CalendarClientError({ code: 'INVALID_REQUEST' });
      }
      return send(
        'POST',
        CALENDAR_API_ROUTES.calendarsRefresh,
        request,
        isCalendarCalendarsResponse,
        signal,
      );
    },
  };
}
