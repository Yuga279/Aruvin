/**
 * ============================================================================
 * FILE: credential-validation.ts
 * LOCATION: backend/src/admin-config/credential-validation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Recognize provider credentials with one bounded, non-billable HTTPS GET.
 *
 * ROLE IN PROJECT:
 *    Confirms OpenRouter and Deepgram keys against fixed allowlisted hosts
 *    without generating text/speech, following redirects, or returning JSON.
 *
 * KEY COMPONENTS:
 *    - DESTINATIONS: Provider/region hosts only; no user URLs or fallback.
 *    - Bounded reader: 10s abort, 64 KiB, fatal UTF-8, closed success predicates.
 * ============================================================================
 */

import { credentialUpdateRequestSchema } from '../contracts/admin-config.js';
import type { CredentialProvider, ManageableSettings } from '../contracts/admin-config-wire.js';
import { AdminConfigFault } from './errors.js';

const DESTINATIONS = {
  openrouter: 'https://openrouter.ai/api/v1/key',
  deepgram: {
    us: 'https://api.deepgram.com/v1/auth/token',
    eu: 'https://api.eu.deepgram.com/v1/auth/token',
  },
} as const;

const MAX_RESPONSE_BYTES = 65_536;
const TIMEOUT_MS = 10_000;
const DEEPGRAM_ERROR_MARKERS = ['error', 'err_code', 'err_msg', 'category', 'message'] as const;

export class CredentialValidator {
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async validate(
    provider: CredentialProvider,
    candidate: string,
    region: ManageableSettings['deepgram']['region'],
  ): Promise<void> {
    this.assertCandidate(candidate);
    if (!isAsciiHeaderValue(candidate)) {
      throw new AdminConfigFault('CREDENTIAL_REJECTED');
    }
    const url = destination(provider, region);
    const authorization = provider === 'openrouter' ? `Bearer ${candidate}` : `Token ${candidate}`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          redirect: 'manual',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            Authorization: authorization,
          },
          signal: controller.signal,
        });
      } catch (error) {
        throw classifyFetchFailure(error, timedOut);
      }
      await this.inspect(provider, response, controller, () => timedOut);
    } finally {
      clearTimeout(timer);
    }
  }

  private async inspect(
    provider: CredentialProvider,
    response: Response,
    controller: AbortController,
    timedOut: () => boolean,
  ): Promise<void> {
    const status = response.status;
    if (status >= 300 && status < 400) {
      await discardBody(response);
      throw new AdminConfigFault('CREDENTIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (status === 401 || status === 403) {
      await discardBody(response);
      throw new AdminConfigFault('CREDENTIAL_REJECTED');
    }
    if (status === 429) {
      await discardBody(response);
      throw new AdminConfigFault('CREDENTIAL_PROVIDER_RATE_LIMITED');
    }
    if (status !== 200) {
      await discardBody(response);
      if (status === 204 || status === 206) {
        throw new AdminConfigFault('CREDENTIAL_PROVIDER_RESPONSE_INVALID');
      }
      throw new AdminConfigFault('CREDENTIAL_PROVIDER_UNAVAILABLE');
    }
    if (!isJsonContentType(response.headers.get('content-type'))) {
      await discardBody(response);
      throw new AdminConfigFault('CREDENTIAL_PROVIDER_RESPONSE_INVALID');
    }
    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader !== null) {
      const length = Number(lengthHeader);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
        await discardBody(response);
        throw new AdminConfigFault('CREDENTIAL_PROVIDER_RESPONSE_INVALID');
      }
    }
    if (!response.body) {
      throw new AdminConfigFault('CREDENTIAL_PROVIDER_RESPONSE_INVALID');
    }
    const bytes = await readBounded(response.body, controller, timedOut);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new AdminConfigFault('CREDENTIAL_PROVIDER_RESPONSE_INVALID');
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AdminConfigFault('CREDENTIAL_PROVIDER_RESPONSE_INVALID');
    }
    if (!isRecognized(provider, json)) {
      throw new AdminConfigFault('CREDENTIAL_PROVIDER_RESPONSE_INVALID');
    }
  }

  private assertCandidate(candidate: string): void {
    const parsed = credentialUpdateRequestSchema.safeParse({
      protocolVersion: 1,
      expectedRevision: 1,
      action: 'replace',
      candidate,
    });
    if (!parsed.success || parsed.data.action !== 'replace') {
      throw new AdminConfigFault('INVALID_CONFIG_REQUEST');
    }
  }
}

function destination(
  provider: CredentialProvider,
  region: ManageableSettings['deepgram']['region'],
): string {
  if (region !== 'us' && region !== 'eu') {
    throw new AdminConfigFault('INVALID_CONFIG_REQUEST');
  }
  if (provider === 'openrouter') return DESTINATIONS.openrouter;
  if (provider === 'deepgram') return DESTINATIONS.deepgram[region];
  throw new AdminConfigFault('INVALID_CONFIG_REQUEST');
}

function isAsciiHeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) return false;
  }
  return true;
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const media = value.split(';', 1)[0]?.trim().toLowerCase();
  return media === 'application/json';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRecognized(provider: CredentialProvider, json: unknown): boolean {
  if (!isRecord(json) || Object.keys(json).length === 0) return false;
  if (provider === 'openrouter') {
    if ('error' in json) return false;
    const data = json.data;
    if (!isRecord(data)) return false;
    if (typeof data.label !== 'string') return false;
    if (typeof data.usage !== 'number' || !Number.isFinite(data.usage) || data.usage < 0) return false;
    if (!(data.limit === null || (typeof data.limit === 'number' && Number.isFinite(data.limit)))) {
      return false;
    }
    return typeof data.is_free_tier === 'boolean';
  }
  if (DEEPGRAM_ERROR_MARKERS.some((marker) => marker in json)) return false;
  const keys = Object.keys(json);
  return !(keys.length === 1 && keys[0] === 'request_id');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function classifyFetchFailure(error: unknown, timedOut: boolean): AdminConfigFault {
  if (error instanceof AdminConfigFault) return error;
  if (timedOut || isAbortError(error)) return new AdminConfigFault('CREDENTIAL_VALIDATION_TIMEOUT');
  return new AdminConfigFault('CREDENTIAL_PROVIDER_UNAVAILABLE');
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* ignore */
  }
}

async function readBounded(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
  timedOut: () => boolean,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        controller.abort();
        throw new AdminConfigFault('CREDENTIAL_PROVIDER_RESPONSE_INVALID');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    if (error instanceof AdminConfigFault) throw error;
    if (timedOut() || isAbortError(error)) {
      throw new AdminConfigFault('CREDENTIAL_VALIDATION_TIMEOUT');
    }
    throw new AdminConfigFault('CREDENTIAL_PROVIDER_UNAVAILABLE');
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}
