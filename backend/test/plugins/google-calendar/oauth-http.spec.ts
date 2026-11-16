import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';
import { authorizationUrl } from '../../../src/plugins/google-calendar/oauth-client.js';
import { deferred, oauthHttpFixture } from './oauth-fixtures.js';

const VALID_GRANT = {
  token_type: 'Bearer', access_token: 'fixture-access', refresh_token: 'fixture-refresh',
  expires_in: 3600, id_token: 'fixture-id-token',
  scope: CALENDAR_SCOPES.join(' '),
};
const SECRETS = ['fixture-client-secret', 'fixture-code', 'fixture-access', 'fixture-refresh',
  'fixture-id-token', 'v'.repeat(43), 'Bad token', 'https://attacker.example'];

function expectSafe(error: unknown): void {
  const text = `${(error as Error).message}\n${String(error)}\n${(error as Error).stack ?? ''}\n${JSON.stringify(error)}`;
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

it('requests incremental consent and rejects every incomplete literal grant', async () => {
  const url = new URL(authorizationUrl(oauthHttpFixture([]).options, {
    state: 's'.repeat(43), nonce: 'n'.repeat(43), challenge: 'c'.repeat(43),
  }));
  expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  expect(url.searchParams.get('prompt')).toBe('consent');
  expect(url.searchParams.get('scope')?.split(' ')).toEqual([...CALENDAR_SCOPES]);
  for (const missing of CALENDAR_SCOPES) {
    const f = oauthHttpFixture([{ body: { ...VALID_GRANT,
      scope: CALENDAR_SCOPES.filter(s => s !== missing).join(' ') } }]);
    const failure = await f.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
      signal: new AbortController().signal, deadlineAt: f.deadlineAt }).catch(e => e);
    expect(failure).toMatchObject({ failure: { code: 'OAUTH_SCOPE_REJECTED', retry: 'none' },
      missingScopes: [missing] });
    expectSafe(failure);
    expect(f.requests).toHaveLength(1);
  }
});

it('normalizes Google returned email alias to canonical email', async () => {
  const f = oauthHttpFixture([{ status: 200, body: { ...VALID_GRANT,
    scope: CALENDAR_SCOPES.map(s => s === 'email'
      ? 'https://www.googleapis.com/auth/userinfo.email' : s).join(' ') } }]);
  const grant = await f.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: f.deadlineAt });
  expect(grant.scopes).toContain('email');
});

it('exchange uses form body PKCE and never retries a code', async () => {
  const f = oauthHttpFixture([{ status: 200, body: VALID_GRANT }]);
  const grant = await f.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: f.deadlineAt });
  expect(f.requests).toHaveLength(1);
  const request = f.requests[0]!;
  expect(request.url).toBe('https://oauth2.googleapis.com/token');
  const body = new URLSearchParams(await request.text());
  expect(body.get('code_verifier')).toBe('v'.repeat(43));
  expect(body.get('redirect_uri')).toBe(f.options.oauth!.redirectUri);
  expect(body.get('client_secret')).toBe('fixture-client-secret');
  expect(grant.scopes).toEqual(expect.arrayContaining([...CALENDAR_SCOPES]));
});

it('does not retry a lost code or refresh response', async () => {
  const lostCode = oauthHttpFixture([{ fail: true }, { status: 200, body: VALID_GRANT }]);
  await expect(lostCode.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: lostCode.deadlineAt })).rejects.toMatchObject({
    code: 'PROVIDER_ERROR',
  });
  expect(lostCode.requests).toHaveLength(1);
  const lostRefresh = oauthHttpFixture([{ fail: true }, { status: 200, body: VALID_GRANT }]);
  await expect(lostRefresh.client.refresh({ refreshToken: 'fixture-refresh',
    signal: new AbortController().signal, deadlineAt: lostRefresh.deadlineAt })).rejects.toMatchObject({
    code: 'PROVIDER_ERROR',
  });
  expect(lostRefresh.requests).toHaveLength(1);
});

it('does not dispatch after abort or an elapsed deadline', async () => {
  const aborted = oauthHttpFixture([{ status: 200, body: VALID_GRANT }]);
  const controller = new AbortController();
  controller.abort();
  await expect(aborted.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: controller.signal, deadlineAt: aborted.deadlineAt })).rejects.toMatchObject({
    code: 'CANCELLED',
  });
  expect(aborted.requests).toHaveLength(0);
  const expired = oauthHttpFixture([{ status: 200, body: VALID_GRANT }]);
  await expect(expired.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal,
    deadlineAt: new Date(expired.clock.now() - 1).toISOString() })).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
  expect(expired.requests).toHaveLength(0);
});

it('cancels an aborted body reader', async () => {
  const gate = deferred<void>();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"token_type":"Bearer"'));
    },
    cancel() { cancelled = true; gate.resolve(); },
  });
  const f = oauthHttpFixture([{ stream }]);
  const controller = new AbortController();
  const pending = f.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: controller.signal, deadlineAt: f.deadlineAt });
  await vi.waitFor(() => expect(f.requests).toHaveLength(1));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  await gate.promise;
  expect(cancelled).toBe(true);
});

it('enforces the token byte cap before JSON parse', async () => {
  const cap = 32 * 1024;
  const exact = Buffer.concat([Buffer.from('{'), Buffer.alloc(cap - 2, 0x20), Buffer.from('}')]);
  const exactFixture = oauthHttpFixture([{ status: 200, raw: exact }]);
  await expect(exactFixture.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: exactFixture.deadlineAt })).rejects.toBeDefined();
  expect(exactFixture.requests).toHaveLength(1);
  const overflow = oauthHttpFixture([{ status: 200, raw: Buffer.alloc(cap + 1, 0x20) }]);
  await expect(overflow.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: overflow.deadlineAt })).rejects.toMatchObject({
    code: 'INPUT_TOO_LARGE',
  });
});

it('rejects chunked overflow malformed utf8 json redirects and wrong media types', async () => {
  const overflowStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.alloc(20 * 1024, 0x61));
      controller.enqueue(Buffer.alloc(20 * 1024, 0x61));
      controller.close();
    },
  });
  const chunked = oauthHttpFixture([{ stream: overflowStream }]);
  await expect(chunked.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: chunked.deadlineAt })).rejects.toMatchObject({
    code: 'INPUT_TOO_LARGE',
  });
  const utf8 = oauthHttpFixture([{ raw: Buffer.from([0xff, 0xfe, 0xfd]),
    headers: { 'content-type': 'application/json' } }]);
  await expect(utf8.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: utf8.deadlineAt })).rejects.toMatchObject({
    code: 'PROVIDER_ERROR',
  });
  const json = oauthHttpFixture([{ raw: Buffer.from('{not-json'),
    headers: { 'content-type': 'application/json' } }]);
  await expect(json.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: json.deadlineAt })).rejects.toMatchObject({
    code: 'PROVIDER_ERROR',
  });
  const redirect = oauthHttpFixture([{ redirect: 'https://attacker.example/steal' }]);
  try {
    await redirect.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
      signal: new AbortController().signal, deadlineAt: redirect.deadlineAt });
    expect.fail('expected redirect failure');
  } catch (error) {
    expectSafe(error);
  }
  const media = oauthHttpFixture([{ status: 200, body: VALID_GRANT,
    headers: { 'content-type': 'text/html' } }]);
  await expect(media.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: media.deadlineAt })).rejects.toMatchObject({
    code: 'PROVIDER_ERROR',
  });
});

it('rejects negative nan overflow expiry missing scope and missing refresh', async () => {
  for (const expires_in of [-1, Number.NaN, Number.MAX_SAFE_INTEGER]) {
    const f = oauthHttpFixture([{ status: 200, body: { ...VALID_GRANT, expires_in } }]);
    try {
      await f.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
        signal: new AbortController().signal, deadlineAt: f.deadlineAt });
      expect.fail(`expected expiry ${String(expires_in)} to fail`);
    } catch (error) {
      expectSafe(error);
    }
  }
  const missingScope = oauthHttpFixture([{ status: 200, body: { ...VALID_GRANT, scope: 'openid email' } }]);
  await expect(missingScope.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: missingScope.deadlineAt })).rejects.toMatchObject({
    failure: { category: 'credential' },
  });
  const missingRefresh = oauthHttpFixture([{ status: 200, body: { ...VALID_GRANT, refresh_token: undefined } }]);
  await expect(missingRefresh.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
    signal: new AbortController().signal, deadlineAt: missingRefresh.deadlineAt })).rejects.toMatchObject({
    failure: { category: 'credential' },
  });
});

it('maps invalid_grant without leaking provider text', async () => {
  const f = oauthHttpFixture([{ status: 400, body: {
    error: 'invalid_grant', error_description: 'Bad token fixture-refresh',
  } }]);
  try {
    await f.client.exchange({ code: 'fixture-code', verifier: 'v'.repeat(43),
      signal: new AbortController().signal, deadlineAt: f.deadlineAt });
    expect.fail('expected invalid_grant failure');
  } catch (error) {
    expect(error).toMatchObject({ failure: { category: 'credential', code: 'RECONNECT_REQUIRED' } });
    expectSafe(error);
  }
});

it('puts revoke tokens in the form body not the URL', async () => {
  const f = oauthHttpFixture([{ status: 200, body: {} }]);
  expect(await f.client.revoke({ token: 'fixture-refresh',
    signal: new AbortController().signal, deadlineAt: f.deadlineAt })).toBe('confirmed');
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]!.url).toBe('https://oauth2.googleapis.com/revoke');
  expect(f.requests[0]!.url).not.toContain('fixture-refresh');
  expect(new URLSearchParams(await f.requests[0]!.text()).get('token')).toBe('fixture-refresh');
});

it('authorization url stays on the pinned Google endpoint', () => {
  const f = oauthHttpFixture([]);
  const url = new URL(authorizationUrl(f.options, {
    state: 's'.repeat(43), nonce: 'n'.repeat(43), challenge: 'c'.repeat(43),
  }));
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
});
