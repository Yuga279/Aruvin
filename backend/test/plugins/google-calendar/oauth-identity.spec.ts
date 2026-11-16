import { GOOGLE_OAUTH_ENDPOINTS } from '../../../src/plugins/google-calendar/options.js';
import { identityFixture } from './oauth-fixtures.js';

async function expectCredential(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
    expect.fail('expected credential failure');
  } catch (error) {
    expect(error).toMatchObject({ failure: { category: 'credential' } });
    const text = `${(error as Error).message}\n${String(error)}\n${(error as Error).stack ?? ''}`;
    expect(text).not.toContain('fixture-sub-secret');
    expect(text).not.toContain('-----BEGIN');
  }
}

it('identity requires signature audience issuer expiry and browser nonce', async () => {
  const f = identityFixture();
  expect(await f.identity.verify(f.input)).toEqual({ subject: 'fixture-sub', email: 'fixture@example.invalid' });
  await expect(f.identity.verify({ ...f.input,
    idToken: f.signToken({ aud: 'another-client' }),
  })).rejects.toMatchObject({ failure: { category: 'credential' } });
  await expect(f.identity.verify({ ...f.input,
    expectedNonceHash: 'a'.repeat(64),
  })).rejects.toMatchObject({ failure: { category: 'credential' } });
});

it('rejects tampered payload and signature', async () => {
  const f = identityFixture();
  const parts = f.input.idToken.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com', aud: 'fixture-client-id', sub: 'attacker',
    iat: 1, exp: 9999999999, nonce: 'n'.repeat(43),
  })).toString('base64url');
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: `${parts[0]}.${tamperedPayload}.${parts[2]}`,
  }));
  const sig = Buffer.from(parts[2]!, 'base64url');
  sig[0] ^= 0xff;
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: `${parts[0]}.${parts[1]}.${sig.toString('base64url')}`,
  }));
});

it('rejects none hs256 attacker key urls and kid mismatches', async () => {
  const f = identityFixture();
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({}, { alg: 'none' }),
  }));
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({}, { alg: 'HS256' }),
  }));
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({}, { jku: 'https://attacker.example/keys' }),
  }));
  expect(f.requests.every((request) => !request.url.includes('attacker.example'))).toBe(true);
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({}, { kid: 'missing-kid' }),
  }));
  const first = identityFixture();
  const duplicate = identityFixture({ jwks: { keys: [first.jwk, { ...first.jwk }] } });
  await expectCredential(() => duplicate.identity.verify(duplicate.input));
});

it('rejects key algorithm and use mismatches', async () => {
  const base = identityFixture();
  const alg = identityFixture({ jwks: { keys: [{ ...base.jwk, alg: 'ES256' }] } });
  await expectCredential(() => alg.identity.verify(alg.input));
  const use = identityFixture({ jwks: { keys: [{ ...base.jwk, use: 'enc' }] } });
  await expectCredential(() => use.identity.verify(use.input));
});

it('rejects expiry iat nbf issuer audience azp and subject bounds', async () => {
  const f = identityFixture();
  const nowSeconds = Math.floor(f.nowMs / 1000);
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({ exp: nowSeconds }),
  }));
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({ iat: nowSeconds + 61 }),
  }));
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({ nbf: nowSeconds + 61 }),
  }));
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({ iss: 'https://evil.example' }),
  }));
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({ aud: ['fixture-client-id', 'other'], azp: 'other' }),
  }));
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({ sub: '' }),
  }));
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({ sub: 's'.repeat(256) }),
  }));
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: f.signToken({ nonce: undefined }),
  }));
});

it('returns null email when unverified and ignores email for identity', async () => {
  const f = identityFixture();
  expect(await f.identity.verify({
    ...f.input, idToken: f.signToken({ email_verified: false, email: 'fixture@example.invalid' }),
  })).toEqual({ subject: 'fixture-sub', email: null });
});

it('rejects malformed padding duplicate json oversized tokens and abort', async () => {
  const f = identityFixture();
  await expectCredential(() => f.identity.verify({ ...f.input, idToken: `${f.input.idToken}=` }));
  const [, payload, signature] = f.input.idToken.split('.');
  const duplicateHeader = Buffer.from('{"alg":"RS256","kid":"fixture-kid","alg":"none"}').toString('base64url');
  await expectCredential(() => f.identity.verify({
    ...f.input, idToken: `${duplicateHeader}.${payload}.${signature}`,
  }));
  const oversized = `${'a'.repeat(16 * 1024 + 1)}.${payload}.${signature}`;
  await expectCredential(() => f.identity.verify({ ...f.input, idToken: oversized }));
  const controller = new AbortController();
  controller.abort();
  await expect(f.identity.verify({ ...f.input, signal: controller.signal })).rejects.toBeDefined();
});

it('rejects hostile discovery and never fetches an attacker URL', async () => {
  const f = identityFixture({
    discovery: {
      issuer: 'https://accounts.google.com',
      authorization_endpoint: GOOGLE_OAUTH_ENDPOINTS.authorization,
      token_endpoint: GOOGLE_OAUTH_ENDPOINTS.token,
      jwks_uri: 'https://attacker.example/keys',
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    },
  });
  await expectCredential(() => f.identity.verify(f.input));
  expect(f.requests.every((request) => !request.url.includes('attacker.example'))).toBe(true);
  expect(f.requests.some((request) => request.url === GOOGLE_OAUTH_ENDPOINTS.discovery)).toBe(true);
});
