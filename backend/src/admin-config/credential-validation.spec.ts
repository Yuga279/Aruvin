/**
 * ============================================================================
 * FILE: credential-validation.spec.ts
 * LOCATION: backend/src/admin-config/credential-validation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify bounded, non-billable, allowlisted provider credential checks.
 *
 * ROLE IN PROJECT:
 *    Ensures OpenRouter and Deepgram recognition use injected fetch, fixed
 *    HTTPS hosts, and closed faults without leaking candidates or provider JSON.
 *
 * KEY COMPONENTS:
 *    - Destination tests: One GET per provider/region, discarded bodies.
 *    - Fault matrix: Status, body, timeout, and stream failures stay closed.
 * ============================================================================
 */

import { describe, expect, it, vi } from 'vitest';
import { CredentialValidator } from './credential-validation.js';

const candidate = 'fixture-key';

function openRouterOk() {
  return Response.json({
    data: { label: 'must-not-leak', limit: null, usage: 0, is_free_tier: true },
  });
}

function trackedBody(status: number, body: string, headers: HeadersInit = { 'content-type': 'application/json' }) {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, { status, headers }),
    cancelled: () => cancelled,
  };
}

async function expectCode(
  fetchImpl: typeof fetch,
  code: string,
  provider: 'openrouter' | 'deepgram' = 'openrouter',
  region: 'us' | 'eu' = 'us',
) {
  try {
    await new CredentialValidator(fetchImpl).validate(provider, candidate, region);
    expect.fail('expected validator fault');
  } catch (error) {
    expect(error).toMatchObject({ code });
    const text = `${String(error)}\n${JSON.stringify(error)}\n${(error as Error).message}`;
    expect(text).not.toContain(candidate);
    expect(text).not.toContain('must-not-leak');
  }
}

describe('credential validator', () => {
  it('checks only the OpenRouter key endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => openRouterOk());
    await new CredentialValidator(fetchImpl).validate('openrouter', 'fixture-key', 'us');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: expect.objectContaining({ Authorization: 'Bearer fixture-key' }),
    }));
  });

  it('checks only the Deepgram US auth token endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ details: { recognized: true } }));
    const result = await new CredentialValidator(fetchImpl).validate('deepgram', 'fixture-key', 'us');
    expect(result).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.deepgram.com/v1/auth/token', expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
      headers: expect.objectContaining({ Authorization: 'Token fixture-key' }),
    }));
  });

  it('checks only the Deepgram EU auth token endpoint', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ details: { recognized: true } }));
    await new CredentialValidator(fetchImpl).validate('deepgram', 'fixture-key', 'eu');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.eu.deepgram.com/v1/auth/token', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Token fixture-key' }),
    }));
  });

  it('rejects 401 and 403 without retrying', async () => {
    for (const status of [401, 403]) {
      const tracked = trackedBody(status, JSON.stringify({ error: candidate }));
      const fetchImpl = vi.fn<typeof fetch>(async () => tracked.response);
      await expectCode(fetchImpl, 'CREDENTIAL_REJECTED');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(tracked.cancelled()).toBe(true);
    }
  });

  it('maps 429 without echoing Retry-After', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('slow', {
      status: 429,
      headers: { 'content-type': 'application/json', 'Retry-After': '999' },
    }));
    try {
      await new CredentialValidator(fetchImpl).validate('openrouter', candidate, 'us');
      expect.fail('expected rate limit');
    } catch (error) {
      expect(error).toMatchObject({ code: 'CREDENTIAL_PROVIDER_RATE_LIMITED' });
      expect(JSON.stringify(error)).not.toContain('999');
      expect(String(error)).not.toContain('slow');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps provider outages and unexpected client errors as unavailable', async () => {
    for (const status of [500, 502, 503, 402, 400, 418]) {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('nope', { status }));
      await expectCode(fetchImpl, 'CREDENTIAL_PROVIDER_UNAVAILABLE');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects redirects without a second fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 302,
      headers: { Location: `https://evil.example/steal?k=${candidate}` },
    }));
    await expectCode(fetchImpl, 'CREDENTIAL_PROVIDER_RESPONSE_INVALID');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects empty, null, array, and invalid OpenRouter payloads', async () => {
    const payloads = [
      {},
      null,
      [],
      { error: { message: 'nope' } },
      { data: { label: 'x', limit: null, usage: 0 } },
      { data: { label: 'x', limit: null, usage: -1, is_free_tier: true } },
      { data: { label: 1, limit: null, usage: 0, is_free_tier: true } },
    ];
    for (const body of payloads) {
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
      await expectCode(fetchImpl, 'CREDENTIAL_PROVIDER_RESPONSE_INVALID');
    }
  });

  it('rejects invalid JSON, UTF-8, HTML, absent body, and oversize replies', async () => {
    const cases: Array<() => Response> = [
      () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
      () => new Response(new Uint8Array([0xff, 0xfe]), { status: 200, headers: { 'content-type': 'application/json' } }),
      () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => new Response(null, { status: 200, headers: { 'content-type': 'application/json' } }),
      () => new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '65537' },
      }),
      () => new Response(new Uint8Array(65_537), { status: 200, headers: { 'content-type': 'application/json' } }),
    ];
    for (const make of cases) {
      const fetchImpl = vi.fn<typeof fetch>(async () => make());
      await expectCode(fetchImpl, 'CREDENTIAL_PROVIDER_RESPONSE_INVALID');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('times out hanging headers after 10000 ms', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('fixture', 'AbortError')), { once: true });
    }));
    const promise = new CredentialValidator(fetchImpl).validate('openrouter', 'fixture-key', 'us');
    const rejected = expect(promise).rejects.toMatchObject({ code: 'CREDENTIAL_VALIDATION_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('times out hanging bodies after 10000 ms', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('fixture', 'AbortError'));
          }, { once: true });
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const promise = new CredentialValidator(fetchImpl).validate('openrouter', 'fixture-key', 'us');
    const rejected = expect(promise).rejects.toMatchObject({ code: 'CREDENTIAL_VALIDATION_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    vi.useRealTimers();
  });

  it('maps network failures containing the candidate without leaking it', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error(`TLS handshake failed for ${candidate}`);
    });
    await expectCode(fetchImpl, 'CREDENTIAL_PROVIDER_UNAVAILABLE');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
