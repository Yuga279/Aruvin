import { diagnose, type DiagnosticSink } from '../../chat-runtime/ports.js';
import { calendarFailureSchema, type CalendarFailure } from '../../contracts/calendar-policy.js';
import { CalendarToolFault, toolFault } from './tools-validation.js';

export const CALENDAR_RESPONSE_BYTES = 262144;
export const CALENDAR_ERROR_BYTES = 8192;

const CALENDAR_ORIGIN = 'https://www.googleapis.com';
const CALENDAR_BASE = `${CALENDAR_ORIGIN}/calendar/v3`;
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const GONE_REASONS = new Set(['deleted', 'gone']);

export type CalendarHttpInput = {
  fetcher: typeof fetch;
  path: string;
  method: 'GET' | 'POST';
  query: URLSearchParams;
  accessToken: string;
  signal: AbortSignal;
  deadlineAt: string;
  consumeRequest: () => Promise<void>;
  body?: unknown;
  now?: () => number;
  write?: boolean;
  responseBytes?: number;
  responseByteFailure?: 'CALENDAR_RESPONSE_TOO_LARGE';
  diagnostic?: DiagnosticSink;
  requestKind?: 'list' | 'get' | 'create' | 'readback' | 'availability' | 'preflight' |
    'discovery' | 'capability-recheck';
};

export type CalendarHttpResult = { body: unknown; headers: Headers; fetchedAt: string; bodyBytes: number };

function failure(category: CalendarFailure['category'], code: string,
  retry: CalendarFailure['retry'] = 'none'): never {
  throw toolFault(category, code, retry);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function allowlistedReason(body: unknown): string | null {
  for (const reason of googleErrorReasons(body)) if (RATE_LIMIT_REASONS.has(reason)) return reason;
  return null;
}

function googleErrorReasons(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return [];
  const entries = (error as { errors?: unknown }).errors;
  if (!Array.isArray(entries)) return [];
  const reasons: string[] = [];
  for (const entry of entries.slice(0, 10)) {
    const reason = typeof entry === 'object' && entry !== null
      ? (entry as { reason?: unknown }).reason : undefined;
    if (typeof reason === 'string') reasons.push(reason);
  }
  return reasons;
}

/**
 * A permanently gone resource is only proven by an explicit provider reason; a
 * bare 410 without one is not enough to declare the event absent.
 */
function isGoneResponse(body: unknown): boolean {
  for (const reason of googleErrorReasons(body)) if (GONE_REASONS.has(reason)) return true;
  return false;
}


export function decodeCalendarFailure(status: number, body: unknown, write: boolean): CalendarFailure {
  const rateLimited = allowlistedReason(body) !== null;
  if (status === 401) return calendarFailureSchema.parse({
    category: 'credential', code: 'RECONNECT_REQUIRED', retry: 'none' });
  if (status === 403) {
    if (googleErrorReasons(body).includes('quotaExceeded')) {
      return calendarFailureSchema.parse({ category: 'delivery',
        code: 'CALENDAR_QUOTA_EXCEEDED', retry: 'none' });
    }
    return rateLimited
      ? calendarFailureSchema.parse({ category: 'delivery', code: 'CALENDAR_RATE_LIMITED', retry: 'delivery-same-id' })
      : calendarFailureSchema.parse({ category: 'policy', code: 'CALENDAR_FORBIDDEN', retry: 'none' });
  }
  if (status === 429) return calendarFailureSchema.parse({
    category: 'delivery', code: 'CALENDAR_RATE_LIMITED', retry: 'delivery-same-id' });
  if (status === 404) return calendarFailureSchema.parse({
    category: 'delivery', code: 'EVENT_NOT_FOUND', retry: 'none' });
  if (status === 410) {
    return isGoneResponse(body)
      ? calendarFailureSchema.parse({ category: 'delivery', code: 'EVENT_GONE', retry: 'none' })
      : calendarFailureSchema.parse({ category: 'delivery', code: 'CALENDAR_RESPONSE_INVALID', retry: 'none' });
  }
  if (status === 409) return calendarFailureSchema.parse({
    category: 'uncertain', code: 'EVENT_ID_CONFLICT', retry: 'readback' });
  if (status === 400) {
    const message = typeof body === 'object' && body !== null
      && 'error' in body && typeof body.error === 'object' && body.error !== null
      && 'message' in body.error ? body.error.message : null;
    // A response projection error can follow a committed insert. It rejects
    // our fields selector, not the user's event, so verify the original ID.
    if (write && typeof message === 'string' && /^Invalid field selection\b/iu.test(message)) {
      return calendarFailureSchema.parse({ category: 'uncertain',
        code: 'CALENDAR_RESPONSE_FIELDS_INVALID', retry: 'readback' });
    }
    return calendarFailureSchema.parse({
      category: 'clarification', code: 'CALENDAR_INPUT_REJECTED', retry: 'none' });
  }
  if (status === 408 || status >= 500) {
    return write
      ? calendarFailureSchema.parse({ category: 'uncertain', code: 'WRITE_OUTCOME_UNKNOWN', retry: 'readback' })
      : calendarFailureSchema.parse({ category: 'delivery', code: 'CALENDAR_TEMPORARILY_UNAVAILABLE', retry: 'delivery-same-id' });
  }
  return calendarFailureSchema.parse({
    category: 'delivery', code: 'CALENDAR_RESPONSE_INVALID', retry: 'none' });
}

export function calendarRetryAfter(headers: Headers, now: number): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds)) return null;
    return Math.max(0, seconds) * 1000;
  }
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - now);
}

async function readCalendarChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  signal.throwIfAborted();
  let abort = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([reader.read(), stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}

async function readBoundedText(response: Response, limit: number,
  signal: AbortSignal, sizeCode: 'CALENDAR_RESPONSE_INVALID' | 'CALENDAR_RESPONSE_TOO_LARGE' = 'CALENDAR_RESPONSE_INVALID'): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isFinite(size) || size < 0) {
      await response.body?.cancel().catch(() => undefined);
      failure('delivery', 'CALENDAR_RESPONSE_INVALID');
    }
    if (size > limit) {
      await response.body?.cancel().catch(() => undefined);
      failure('delivery', sizeCode);
    }
  }
  const body = response.body;
  if (body === null) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let received = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await readCalendarChunk(reader, signal);
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > limit) {
        await reader.cancel().catch(() => undefined);
        failure('delivery', sizeCode);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof CalendarToolFault && error.failure.code === 'CALENDAR_RESPONSE_TOO_LARGE') throw error;
    if (isAbort(error)) throw error;
    failure('delivery', 'CALENDAR_RESPONSE_INVALID');
  } finally {
    reader.releaseLock();
  }
}

function assertJsonContentType(response: Response): void {
  const type = response.headers.get('content-type') ?? '';
  if (!/^application\/json\b/iu.test(type.trim())) {
    failure('delivery', 'CALENDAR_RESPONSE_INVALID');
  }
}

export async function calendarHttp(input: CalendarHttpInput): Promise<CalendarHttpResult> {
  const clock = input.now ?? (() => Date.now());
  const responseBytes = input.responseBytes ?? CALENDAR_RESPONSE_BYTES;
  if (!Number.isInteger(responseBytes) || responseBytes < 1
    || responseBytes > CALENDAR_RESPONSE_BYTES) failure('delivery', 'CALENDAR_RESPONSE_INVALID');
  const deadlineAt = Date.parse(input.deadlineAt);
  if (!Number.isFinite(deadlineAt)) failure('delivery', 'CALENDAR_RESPONSE_INVALID');
  const remaining = deadlineAt - clock();
  const local = (code: string): void => {
    diagnose(input.diagnostic, { origin: 'local', delivery: 'not-sent', code });
  };
  if (remaining <= 0) {
    local('CALENDAR_TEMPORARILY_UNAVAILABLE');
    failure('delivery', 'CALENDAR_TEMPORARILY_UNAVAILABLE', 'delivery-same-id');
  }
  if (input.signal.aborted) {
    local('CALENDAR_CANCELLED');
    failure('cancelled', 'CALENDAR_CANCELLED');
  }

  try {
    await input.consumeRequest();
  } catch {
    local('CALENDAR_REQUEST_NOT_ADMITTED');
    failure('persistence', 'CALENDAR_REQUEST_NOT_ADMITTED');
  }
  if (input.signal.aborted) {
    local('CALENDAR_CANCELLED');
    failure('cancelled', 'CALENDAR_CANCELLED');
  }

  const afterAdmission = deadlineAt - clock();
  if (afterAdmission <= 0) {
    local('CALENDAR_TEMPORARILY_UNAVAILABLE');
    failure('delivery', 'CALENDAR_TEMPORARILY_UNAVAILABLE', 'delivery-same-id');
  }

  const url = new URL(`${CALENDAR_BASE}${input.path}`);
  for (const [key, value] of input.query) url.searchParams.append(key, value);
  const headers = new Headers({ accept: 'application/json', authorization: `Bearer ${input.accessToken}` });
  const init: RequestInit = { method: input.method, headers, redirect: 'error', signal: input.signal };
  if (input.method === 'POST') {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(input.body ?? {});
  }

  const timeout = AbortSignal.timeout(afterAdmission);
  const signal = AbortSignal.any([input.signal, timeout]);
  let response: Response;
  let dispatched = false;
  const startedAt = performance.now();
  try {
    dispatched = true;
    diagnose(input.diagnostic, { stage: 'provider-request', state: 'start', provider: 'google-calendar',
      requestKind: input.requestKind, origin: 'provider', delivery: 'attempted' });
    response = await input.fetcher(url.toString(), { ...init, signal });
  } catch (error) {
    diagnose(input.diagnostic, { stage: 'provider-request', state: 'error', provider: 'google-calendar',
      requestKind: input.requestKind, origin: 'provider', delivery: 'attempted',
      reason: 'provider-error', durationMs: performance.now() - startedAt });
    if (input.write === true && dispatched) failure('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback');
    if (isAbort(error) || input.signal.aborted) failure('cancelled', 'CALENDAR_CANCELLED');
    failure('delivery', 'CALENDAR_TEMPORARILY_UNAVAILABLE', 'delivery-same-id');
  }
  diagnose(input.diagnostic, { stage: 'provider-response', state: response.ok ? 'ok' : 'error',
    provider: 'google-calendar', requestKind: input.requestKind, origin: 'provider',
    delivery: 'response-received', durationMs: performance.now() - startedAt,
    statusClass: response.status >= 500 ? '5xx' : response.status >= 400 ? '4xx'
      : response.status >= 300 ? '3xx' : response.status >= 200 ? '2xx' : 'other' });
  const fetchedAt = new Date(clock()).toISOString();
  if (!response.ok) {
    let body: unknown = null;
    try {
      const text = await readBoundedText(response, CALENDAR_ERROR_BYTES, signal);
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const decoded = decodeCalendarFailure(response.status, body, input.write === true);
    diagnose(input.diagnostic, {
      stage: 'provider-response',
      reason: response.status >= 500 ? 'provider-5xx' : 'provider-4xx',
      origin: 'provider', delivery: 'response-received', code: decoded.code,
      provider: 'google-calendar', requestKind: input.requestKind,
    });
    // This transport does not own retries. Do not sleep without an admitted
    // subsequent request (especially never replay a possibly dispatched write).
    failure(decoded.category, decoded.code, decoded.retry);
  }

  try {
    assertJsonContentType(response);
    const text = await readBoundedText(response, responseBytes, signal, input.responseByteFailure);
    return {
      body: JSON.parse(text) as unknown,
      headers: response.headers,
      fetchedAt,
      bodyBytes: Buffer.byteLength(text, 'utf8'),
    };
  } catch (error) {
    // A 2xx write may already exist even when its receipt cannot be decoded.
    if (input.write === true) failure('uncertain', 'WRITE_OUTCOME_UNKNOWN', 'readback');
    if (error instanceof CalendarToolFault && error.failure.code === 'CALENDAR_RESPONSE_TOO_LARGE') throw error;
    if (isAbort(error) || input.signal.aborted) failure('cancelled', 'CALENDAR_CANCELLED');
    failure('delivery', 'CALENDAR_RESPONSE_INVALID');
  }
}
