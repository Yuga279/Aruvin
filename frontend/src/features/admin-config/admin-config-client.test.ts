/**
 * ============================================================================
 * FILE: admin-config-client.test.ts
 * LOCATION: frontend/src/features/admin-config/admin-config-client.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bounded admin HTTP client transport, redaction, and request-guard tests.
 *
 * ROLE IN PROJECT:
 *    Locks P5 client routing, no-store fetches, closed errors, and no retries
 *    against the committed public admin protocol without live providers.
 *
 * KEY COMPONENTS:
 *    - Credential POST isolation and exact request bodies
 *    - GET/PUT routes, conflicts, timeouts, and oversized responses
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import {
  ADMIN_CONFIG_ERROR_CODES,
  isAdminConfigError,
  isPublicAdminConfig,
  type CredentialUpdateRequest,
  type PublicAdminConfig,
  type SaveSettingsRequest,
} from '../../api/admin-config-protocol.ts';
import {
  AdminConfigClientError,
  createAdminConfigClient,
} from '../../api/admin-config-client.ts';
import { adminFailure, publicConfig } from './testing/fixtures.ts';

const replaceRequest: CredentialUpdateRequest = {
  protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'fixture-only-key',
};
const saveRequest: SaveSettingsRequest = {
  protocolVersion: 1, expectedRevision: 1, settings: publicConfig().settings,
};

function missingConfig(): PublicAdminConfig {
  const config = publicConfig(1);
  config.revision = 0;
  config.activeRevision = null;
  config.state = 'missing';
  config.activation = 'unconfigured';
  config.credentials.openrouter = { configured: false, validatedAt: null };
  config.credentials.deepgram = { configured: false, validatedAt: null };
  return config;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hangingFetch(): typeof fetch {
  return vi.fn<typeof fetch>((_url, init) => new Promise((_, reject) => {
    const fail = () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
    };
    const signal = init?.signal;
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('accepts the redacted public fixture', () => {
  expect(isPublicAdminConfig(publicConfig())).toBe(true);
  expect(isPublicAdminConfig(missingConfig())).toBe(true);
  expect(isAdminConfigError(adminFailure('CONFIG_CONFLICT', 2))).toBe(true);
  expect(isPublicAdminConfig({
    ...publicConfig(),
    roleAssumption: {
      role: 'super-admin',
      authentication: 'session',
      source: 'local-account',
    },
  })).toBe(true);
});

it('posts a credential once without saving unrelated settings', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(publicConfig(2)));
  const client = createAdminConfigClient({ baseUrl: '/api/', fetch: fetcher });
  await client.updateCredential('openrouter', {
    protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: 'fixture-only-key',
  });
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('/api/admin/config/credentials/openrouter');
  expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
  expect(JSON.parse(String(init?.body))).toEqual({ protocolVersion: 1,
    expectedRevision: 1, action: 'replace', candidate: 'fixture-only-key' });
});

it('gets stored configuration without query parameters', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(publicConfig()));
  const client = createAdminConfigClient({ baseUrl: '/api/', fetch: fetcher });
  await expect(client.read()).resolves.toEqual(publicConfig());
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('/api/admin/config');
  expect(String(url)).not.toContain('?');
  expect(init).toMatchObject({
    method: 'GET', cache: 'no-store', redirect: 'error', credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  expect(init?.body).toBeUndefined();
});

it('puts settings once on the config route', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(publicConfig(2)));
  const client = createAdminConfigClient({ baseUrl: '/api', fetch: fetcher });
  await client.saveSettings(saveRequest);
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('/api/admin/config');
  expect(init).toMatchObject({ method: 'PUT', cache: 'no-store', redirect: 'error' });
  expect(JSON.parse(String(init?.body))).toEqual(saveRequest);
});

it('accepts revision zero for a missing document', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(missingConfig()));
  const client = createAdminConfigClient({ fetch: fetcher });
  await expect(client.read()).resolves.toMatchObject({ revision: 0, state: 'missing' });
});

it('posts an exact credential removal body', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(publicConfig(2)));
  const client = createAdminConfigClient({ fetch: fetcher });
  await client.updateCredential('deepgram', {
    protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: true,
  });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
    protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: true,
  });
  expect(fetcher.mock.calls[0][0]).toBe('/api/admin/config/credentials/deepgram');
});

it('surfaces a nested 409 conflict without retrying', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(adminFailure('CONFIG_CONFLICT', 4), 409));
  const client = createAdminConfigClient({ fetch: fetcher });
  await expect(client.saveSettings(saveRequest)).rejects.toMatchObject({
    code: 'CONFIG_CONFLICT', status: 409, currentRevision: 4, retryable: false, uncertain: false,
  });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(ADMIN_CONFIG_ERROR_CODES)('maps protocol error %s from the nested envelope', async (code) => {
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(adminFailure(code, 3), 400));
  const client = createAdminConfigClient({ fetch: fetcher });
  const error = await client.read().catch((caught) => caught);
  expect(error).toBeInstanceOf(AdminConfigClientError);
  expect(error).toMatchObject({ code, currentRevision: 3, message: 'Configuration could not be completed.' });
  expect(JSON.stringify(error)).not.toMatch(/exception-secret|fixture-only-key|sk-/);
});

it('redacts raw bodies and thrown exception text', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error('exception-secret sk-live-key');
  });
  const client = createAdminConfigClient({ fetch: fetcher });
  const error = await client.saveSettings(saveRequest).catch((caught) => caught) as AdminConfigClientError;
  expect(error).toBeInstanceOf(AdminConfigClientError);
  expect(error.code).toBe('NETWORK_ERROR');
  expect(error.uncertain).toBe(true);
  expect(error.message).toBe('Configuration could not be completed.');
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify(error)).not.toMatch(/exception-secret|sk-live-key|fixture-only-key/);
});

it('rejects malformed JSON rather than casting it', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{not-json', { status: 200 }));
  const client = createAdminConfigClient({ fetch: fetcher });
  await expect(client.read()).rejects.toMatchObject({ code: 'INVALID_ADMIN_RESPONSE', uncertain: false });
});

it('rejects secret-bearing extra response fields', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({
    ...publicConfig(), apiKey: 'sk-secret', candidate: 'fixture-only-key',
  }));
  const client = createAdminConfigClient({ fetch: fetcher });
  const error = await client.read().catch((caught) => caught) as AdminConfigClientError;
  expect(error.code).toBe('INVALID_ADMIN_RESPONSE');
  expect(JSON.stringify(error)).not.toMatch(/sk-secret|fixture-only-key/);
});

it('rejects invalid and oversized requests before fetch', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(publicConfig()));
  const client = createAdminConfigClient({ fetch: fetcher });
  await expect(client.updateCredential('openai' as 'openrouter', replaceRequest))
    .rejects.toMatchObject({ code: 'INVALID_ADMIN_REQUEST', uncertain: false });
  await expect(client.updateCredential('openrouter', {
    ...replaceRequest, extra: true,
  } as CredentialUpdateRequest)).rejects.toMatchObject({ code: 'INVALID_ADMIN_REQUEST' });
  await expect(client.updateCredential('openrouter', {
    protocolVersion: 1, expectedRevision: -1, action: 'replace', candidate: 'fixture-only-key',
  })).rejects.toMatchObject({ code: 'INVALID_ADMIN_REQUEST' });
  await expect(client.updateCredential('openrouter', {
    protocolVersion: 1, expectedRevision: 1, action: 'remove', confirm: true, extra: 1,
  } as CredentialUpdateRequest)).rejects.toMatchObject({ code: 'INVALID_ADMIN_REQUEST' });
  await expect(client.saveSettings({
    ...saveRequest, expectedRevision: 1.5,
  })).rejects.toMatchObject({ code: 'INVALID_ADMIN_REQUEST' });
  const oversized = 'k'.repeat(4_097);
  await expect(client.updateCredential('openrouter', {
    protocolVersion: 1, expectedRevision: 1, action: 'replace', candidate: oversized,
  })).rejects.toMatchObject({ code: 'INVALID_ADMIN_REQUEST' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects oversized responses while reading bytes', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('x'.repeat(65_537), { status: 200 }));
  const client = createAdminConfigClient({ fetch: fetcher });
  await expect(client.saveSettings(saveRequest)).rejects.toMatchObject({
    code: 'INVALID_ADMIN_RESPONSE', uncertain: true,
  });
});

it('does not retry a network mutation failure', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new TypeError('Failed to fetch');
  });
  const client = createAdminConfigClient({ fetch: fetcher });
  await expect(client.updateCredential('openrouter', replaceRequest))
    .rejects.toMatchObject({ code: 'NETWORK_ERROR', uncertain: true });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('times out with fake timers and restores them', async () => {
  vi.useFakeTimers();
  const fetcher = hangingFetch();
  const client = createAdminConfigClient({ fetch: fetcher });
  const pending = client.saveSettings(saveRequest);
  const expectation = expect(pending).rejects.toMatchObject({
    code: 'ADMIN_REQUEST_TIMEOUT', uncertain: true,
  });
  await vi.advanceTimersByTimeAsync(30_000);
  await expectation;
  expect(fetcher).toHaveBeenCalledOnce();
});

it('classifies caller abort after a mutation is dispatched as uncertain', async () => {
  const abort = new AbortController();
  const fetcher = hangingFetch();
  const client = createAdminConfigClient({ fetch: fetcher });
  const pending = client.updateCredential('openrouter', replaceRequest, abort.signal);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: 'ABORTED', uncertain: true });
});

it('does not write cache or web storage', async () => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { setItem, getItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('sessionStorage', { setItem, getItem: vi.fn(), removeItem: vi.fn() });
  const fetcher = vi.fn<typeof fetch>(async () => jsonResponse(publicConfig()));
  const client = createAdminConfigClient({ fetch: fetcher });
  await client.read();
  await client.saveSettings(saveRequest);
  expect(setItem).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([, init]) => init?.cache === 'no-store')).toBe(true);
});
