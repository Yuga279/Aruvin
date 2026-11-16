import { createHash } from 'node:crypto';
import { CALENDAR_LIMITS } from '../../../src/contracts/calendar-policy.js';
import { connectionFixture } from './connection-fixtures.js';
import { GoogleCalendarOAuthService } from '../../../src/plugins/google-calendar/oauth.js';
import { oauthFixture } from './oauth-fixtures.js';

it('callback is single use browser bound and expires at the deadline', async () => {
  const f = oauthFixture();
  const first = await f.start();
  const state = new URL(first.authorizationUrl).searchParams.get('state')!;
  await expect(f.callback({ state, code: 'fixture-code', cookie: 'wrong-browser' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).not.toHaveBeenCalled();
  await f.callback({ state, code: 'fixture-code', cookie: first.cookie });
  expect(f.exchange).toHaveBeenCalledTimes(1);
  await expect(f.callback({ state, code: 'fixture-code', cookie: first.cookie }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).toHaveBeenCalledTimes(1);
  const second = await f.start();
  f.clock.advance(CALENDAR_LIMITS.oauthStateMs);
  await expect(f.callback({ state: new URL(second.authorizationUrl).searchParams.get('state')!,
    code: 'fixture-code', cookie: second.cookie })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).toHaveBeenCalledTimes(1);
});

it('rejects missing duplicate and malformed callback inputs', async () => {
  const f = oauthFixture();
  const started = await f.start();
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  await expect(f.oauth.callback({ rawQuery: '', cookieHeader: `aurvin_gcal_oauth=${started.cookie}` },
    new AbortController().signal, 'sid_fixture')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.oauth.callback({
    rawQuery: `state=${state}&state=${state}&code=fixture-code`,
    cookieHeader: `aurvin_gcal_oauth=${started.cookie}`,
  }, new AbortController().signal, 'sid_fixture')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.oauth.callback({
    rawQuery: `state=${state}&code=fixture-code&error=access_denied`,
    cookieHeader: `aurvin_gcal_oauth=${started.cookie}`,
  }, new AbortController().signal, 'sid_fixture')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.oauth.callback({
    rawQuery: `state=${state}&code=fixture-code`,
    cookieHeader: `aurvin_gcal_oauth=${started.cookie}; aurvin_gcal_oauth=${started.cookie}`,
  }, new AbortController().signal, 'sid_fixture')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).not.toHaveBeenCalled();
});

it('consumes denied consent without exchanging a code', async () => {
  const f = oauthFixture();
  const started = await f.start();
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  expect(await f.callback({ state, cookie: started.cookie, error: 'access_denied' })).toBe('cancelled');
  expect(f.exchange).not.toHaveBeenCalled();
  expect(await f.readState()).toHaveLength(0);
});

it('exchanges only one of two concurrent callbacks', async () => {
  const f = oauthFixture();
  const started = await f.start();
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  const results = await Promise.allSettled([
    f.callback({ state, code: 'fixture-code', cookie: started.cookie }),
    f.callback({ state, code: 'fixture-code', cookie: started.cookie }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(f.exchange).toHaveBeenCalledTimes(1);
});

it('does not exchange after a lost consume ACK or restart', async () => {
  const lost = oauthFixture();
  const started = await lost.start();
  lost.storeImpl.consumeAck = 'throw';
  await expect(lost.callback({
    state: new URL(started.authorizationUrl).searchParams.get('state')!,
    code: 'fixture-code', cookie: started.cookie,
  })).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  expect(lost.exchange).not.toHaveBeenCalled();
  const restarted = oauthFixture();
  const first = await restarted.start();
  restarted.replaceService();
  await expect(restarted.callback({
    state: new URL(first.authorizationUrl).searchParams.get('state')!,
    code: 'fixture-code', cookie: first.cookie,
  })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(restarted.exchange).not.toHaveBeenCalled();
  expect((await restarted.readState()).length).toBeGreaterThan(0);
});

it('supersedes the prior start and fails a disabled or unconfigured flow', async () => {
  const f = oauthFixture();
  const first = await f.start();
  const second = await f.start();
  await expect(f.callback({
    state: new URL(first.authorizationUrl).searchParams.get('state')!,
    code: 'fixture-code', cookie: first.cookie,
  })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(f.exchange).not.toHaveBeenCalled();
  expect(await f.callback({
    state: new URL(second.authorizationUrl).searchParams.get('state')!,
    code: 'fixture-code', cookie: second.cookie,
  })).toBe('fixture');
  const disabled = oauthFixture();
  const started = await disabled.start();
  disabled.service.invalidateLifecycle();
  await expect(disabled.callback({
    state: new URL(started.authorizationUrl).searchParams.get('state')!,
    code: 'fixture-code', cookie: started.cookie,
  })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(disabled.exchange).not.toHaveBeenCalled();
  const unconfigured = connectionFixture();
  const oauth = new GoogleCalendarOAuthService({
    connections: unconfigured.service,
    store: unconfigured.store,
    cipher: unconfigured.cipher,
    options: unconfigured.options,
    client: unconfigured.client as never,
    googleIdentity: { verify: vi.fn() },
    now: () => unconfigured.clock.now(),
  });
  await expect(oauth.start(new AbortController().signal, 'sid_fixture')).rejects.toMatchObject({ code: 'NOT_READY' });
});

it('does not issue a cookie when state persistence fails', async () => {
  const f = oauthFixture();
  f.storeImpl.failPut = true;
  await expect(f.start()).rejects.toBeDefined();
  expect(await f.readState()).toHaveLength(0);
});

it('binds PKCE and nonce hashes without storing raw secrets', async () => {
  const f = oauthFixture();
  const started = await f.start();
  const url = new URL(started.authorizationUrl);
  const state = url.searchParams.get('state')!;
  const nonce = url.searchParams.get('nonce')!;
  const challenge = url.searchParams.get('code_challenge')!;
  const records = await f.readState();
  expect(records).toHaveLength(1);
  const record = records[0]!;
  const publicText = JSON.stringify(record);
  expect(publicText).not.toContain(state);
  expect(publicText).not.toContain(started.cookie);
  expect(publicText).not.toContain(nonce);
  expect(record.stateHash).toBe(createHash('sha256').update(state, 'utf8').digest('hex'));
  expect(record.browserHash).toBe(createHash('sha256').update(started.cookie, 'utf8').digest('hex'));
  expect(record.oidcNonceHash).toBe(createHash('sha256').update(nonce, 'utf8').digest('hex'));
  const verifier = f.cipher.openVerifier({
    userId: record.userId, stateHash: record.stateHash, browserHash: record.browserHash,
    oidcNonceHash: record.oidcNonceHash, redirectUri: record.redirectUri,
  }, record.encryptedVerifier);
  expect(createHash('sha256').update(verifier, 'ascii').digest('base64url')).toBe(challenge);
  expect(JSON.stringify(started)).not.toContain(verifier);
});

