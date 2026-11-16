import { AppError } from '../../platform/errors/app-error.js';
import { scanJsonObject } from '../../model/strict-json.js';
import { GOOGLE_OAUTH_ENDPOINTS } from './options.js';

export type OAuthEndpoint = 'token' | 'revoke' | 'discovery' | 'jwks';

const URLS: Record<OAuthEndpoint, string> = {
  token: GOOGLE_OAUTH_ENDPOINTS.token,
  revoke: GOOGLE_OAUTH_ENDPOINTS.revoke,
  discovery: GOOGLE_OAUTH_ENDPOINTS.discovery,
  jwks: GOOGLE_OAUTH_ENDPOINTS.jwks,
};

const SUCCESS_CAPS: Record<OAuthEndpoint, number> = {
  token: 32 * 1024,
  revoke: 4 * 1024,
  discovery: 64 * 1024,
  jwks: 64 * 1024,
};

const ERROR_CAP = 4 * 1024;

function timeout(): never {
  throw new AppError('TIMEOUT', 'Calendar setup timed out.', false);
}

function cancelled(): never {
  throw new AppError('CANCELLED', 'Calendar setup was cancelled.', false);
}

function provider(): never {
  throw new AppError('PROVIDER_ERROR', 'Calendar setup could not be completed.', false);
}

function tooLarge(): never {
  throw new AppError('INPUT_TOO_LARGE', 'Calendar setup could not be completed.', false);
}

function boundSignal(signal: AbortSignal, deadlineAt: string, now: () => number): AbortSignal {
  if (signal.aborted) cancelled();
  const remaining = Date.parse(deadlineAt) - now();
  if (!Number.isFinite(remaining) || remaining <= 0) timeout();
  return AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
}

async function readBounded(
  response: Response,
  cap: number,
  signal: AbortSignal,
): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => { void reader.cancel(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel();
        cancelled();
      }
      const { done, value } = await reader.read();
      if (signal.aborted) cancelled();
      if (done) break;
      if (value === undefined) continue;
      if (total + value.byteLength > cap) {
        await reader.cancel();
        tooLarge();
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal.aborted) cancelled();
    provider();
  } finally {
    signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    provider();
  }
}

function jsonMedia(contentType: string | null): boolean {
  const media = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return media === 'application/json';
}

export async function oauthRequest(input: {
  endpoint: OAuthEndpoint;
  method: 'GET' | 'POST';
  body?: URLSearchParams;
  signal: AbortSignal;
  deadlineAt: string;
  fetch?: typeof fetch;
  now?: () => number;
}): Promise<{ status: number; json: unknown; text: string }> {
  const now = input.now ?? Date.now;
  const signal = boundSignal(input.signal, input.deadlineAt, now);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (input.body) headers['content-type'] = 'application/x-www-form-urlencoded';
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(URLS[input.endpoint], {
      method: input.method,
      headers,
      body: input.body?.toString(),
      redirect: 'error',
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal.aborted || input.signal.aborted) {
      if (Date.parse(input.deadlineAt) <= now()) timeout();
      cancelled();
    }
    provider();
  }
  if (response.status >= 300 && response.status < 400) provider();
  const cap = response.ok ? SUCCESS_CAPS[input.endpoint] : ERROR_CAP;
  const text = await readBounded(response, cap, signal);
  if (input.endpoint === 'revoke' && response.ok && text.trim() === '') {
    return { status: response.status, json: null, text };
  }
  if (!jsonMedia(response.headers.get('content-type'))) provider();
  const scan = scanJsonObject(text, { argumentBytes: 64 * 1024, jsonDepth: 8 });
  if (scan.code !== null) provider();
  try {
    return { status: response.status, json: JSON.parse(text) as unknown, text };
  } catch {
    provider();
  }
}
