import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';
import type { GoogleIdentityPort } from '../../../src/contracts/calendar-connections.js';
import { parseCalendarSetupOptions, type CalendarSetupOptions } from '../../../src/plugins/google-calendar/options.js';
import { GoogleCalendarOAuthClient } from '../../../src/plugins/google-calendar/oauth-client.js';
import { GoogleCalendarIdentity } from '../../../src/plugins/google-calendar/oauth-identity.js';
import { GoogleCalendarOAuthService } from '../../../src/plugins/google-calendar/oauth.js';
import { GOOGLE_OAUTH_ENDPOINTS } from '../../../src/plugins/google-calendar/options.js';
import { connectionFixture } from './connection-fixtures.js';

const ALLOWED = new Map<string, Set<string>>([
  ['https://oauth2.googleapis.com', new Set(['/token', '/revoke'])],
  ['https://accounts.google.com', new Set(['/.well-known/openid-configuration'])],
  ['https://www.googleapis.com', new Set(['/oauth2/v3/certs'])],
]);

export type ScriptedOAuthStep = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Uint8Array;
  redirect?: string;
  fail?: boolean;
  stream?: ReadableStream<Uint8Array>;
};

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function scriptedOAuthFetch(steps: ScriptedOAuthStep[]) {
  const requests: Request[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const paths = ALLOWED.get(url.origin);
    if (!paths || !paths.has(url.pathname) || url.search || url.hash || url.username || url.password) {
      throw new Error(`unlisted OAuth request ${request.method} ${request.url}`);
    }
    const step = steps[index];
    index += 1;
    if (!step) throw new Error(`unlisted OAuth request ${request.method} ${request.url}`);
    requests.push(request);
    if (step.fail) throw new Error('lost OAuth response');
    if (step.redirect) {
      return new Response(null, { status: 302, headers: { location: step.redirect } });
    }
    const headers = { 'content-type': 'application/json', ...step.headers };
    if (step.stream) return new Response(step.stream, { status: step.status ?? 200, headers });
    if (step.raw) return new Response(step.raw, { status: step.status ?? 200, headers });
    return jsonResponse(step.body ?? {}, step.status ?? 200, headers);
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

export function fixtureOAuthOptions(): CalendarSetupOptions {
  return parseCalendarSetupOptions({
    initial: { enabled: true, processingPolicyId: 'fixture-policy' },
    realDataPolicyApproved: true,
    evidence: 'fixture',
    frontendOrigin: 'http://127.0.0.1:5173',
    backendOrigin: 'http://127.0.0.1:3000',
    oauth: {
      clientId: 'fixture-client-id',
      clientSecret: 'fixture-client-secret',
      redirectUri: 'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
      targetCalendarId: 'owned-a',
    },
  });
}

export function oauthHttpFixture(steps: ScriptedOAuthStep[]) {
  const clock = (() => {
    let current = Date.parse('2026-10-21T10:00:00.000Z');
    return {
      now: () => current,
      advance: (ms: number) => { current += ms; },
    };
  })();
  const scripted = scriptedOAuthFetch(steps);
  const options = fixtureOAuthOptions();
  const client = new GoogleCalendarOAuthClient({
    options,
    fetch: scripted.fetch,
    now: () => clock.now(),
  });
  return {
    client,
    requests: scripted.requests,
    options,
    clock,
    deadlineAt: new Date(clock.now() + 10_000).toISOString(),
  };
}

export function identityFixture(overrides: {
  discovery?: unknown;
  jwks?: unknown;
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-kid', use: 'sig', alg: 'RS256' };
  const nowMs = Date.parse('2026-10-21T10:00:00.000Z');
  const nowSeconds = Math.floor(nowMs / 1000);
  const nonce = 'n'.repeat(43);
  const expectedNonceHash = createHash('sha256').update(nonce, 'utf8').digest('hex');
  const clientId = 'fixture-client-id';
  const defaultClaims = {
    iss: 'https://accounts.google.com',
    aud: clientId,
    sub: 'fixture-sub',
    email: 'fixture@example.invalid',
    email_verified: true,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
    nonce,
  };
  const signToken = (claimOverrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}) => {
    const header = { alg: 'RS256', kid: 'fixture-kid', typ: 'JWT', ...headerOverrides };
    const payload = { ...defaultClaims, ...claimOverrides };
    const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    const signature = sign('RSA-SHA256', Buffer.from(signingInput, 'ascii'), privateKey);
    return `${signingInput}.${signature.toString('base64url')}`;
  };
  const discovery = overrides.discovery ?? {
    issuer: 'https://accounts.google.com',
    authorization_endpoint: GOOGLE_OAUTH_ENDPOINTS.authorization,
    token_endpoint: GOOGLE_OAUTH_ENDPOINTS.token,
    jwks_uri: GOOGLE_OAUTH_ENDPOINTS.jwks,
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
  };
  const jwks = overrides.jwks ?? { keys: [jwk] };
  const requests: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url === GOOGLE_OAUTH_ENDPOINTS.discovery) {
      return jsonResponse(discovery);
    }
    if (request.url === GOOGLE_OAUTH_ENDPOINTS.jwks) {
      return jsonResponse(jwks);
    }
    throw new Error(`unlisted OAuth request ${request.method} ${request.url}`);
  }) as typeof fetch;
  const identity = new GoogleCalendarIdentity({ fetch: fetchImpl, now: () => nowMs });
  const idToken = signToken();
  return {
    identity,
    requests,
    nonce,
    now: new Date(nowMs).toISOString(),
    nowMs,
    jwk,
    privateKey,
    signToken,
    input: {
      idToken,
      clientId,
      expectedNonceHash,
      now: new Date(nowMs).toISOString(),
      signal: new AbortController().signal,
    },
  };
}

export function oauthFixture() {
  const base = connectionFixture({ configured: true, enabled: true });
  const exchange = vi.fn(async () => ({
    accessToken: 'fixture-access',
    refreshToken: 'fixture-refresh',
    idToken: 'fixture-id-token',
    expiresAt: new Date(base.clock.now() + 3600_000).toISOString(),
    scopes: [...CALENDAR_SCOPES],
  }));
  const identityVerify = vi.fn(async () => ({
    subject: 'fixture-sub', email: 'fixture@example.invalid',
  }));
  const targetVerify = vi.mocked(base.target.verifyOwnedTarget);
  const googleIdentity: GoogleIdentityPort = { verify: identityVerify };
  const client = { ...base.client, exchange, refresh: base.client.refresh, revoke: base.client.revoke };
  const dependencies = {
    connections: base.service,
    store: base.store,
    cipher: base.cipher,
    options: base.options,
    client,
    googleIdentity,
    now: () => base.clock.now(),
  };
  const create = () => new GoogleCalendarOAuthService(dependencies);
  let oauth = create();
  const start = async () => {
    const result = await oauth.start(new AbortController().signal, 'sid_fixture');
    return { authorizationUrl: result.authorizationUrl, cookie: result.browserCookie };
  };
  const callback = async (input: { state: string; code?: string; cookie: string; error?: string }) => {
    const query = new URLSearchParams();
    query.set('state', input.state);
    if (input.code !== undefined) query.set('code', input.code);
    if (input.error !== undefined) query.set('error', input.error);
    return oauth.callback({
      rawQuery: query.toString(),
      cookieHeader: `aurvin_gcal_oauth=${input.cookie}`,
    }, new AbortController().signal, 'sid_fixture');
  };
  return {
    oauth,
    service: base.service,
    store: base.store,
    clock: base.clock,
    exchange,
    identityVerify,
    targetVerify,
    start,
    callback,
    readState: async () => [...base.store.states.values()],
    storeImpl: base.store,
    cipher: base.cipher,
    options: base.options,
    replaceService: () => {
      oauth = create();
      return oauth;
    },
  };
}
