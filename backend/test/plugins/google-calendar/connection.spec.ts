import { parseCalendarSetupOptions } from '../../../src/plugins/google-calendar/options.js';
import { connectionFixture } from './connection-fixtures.js';

const VALID_OAUTH = {
  clientId: 'fixture-client-id',
  clientSecret: 'fixture-client-secret',
  redirectUri: 'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
  targetCalendarId: 'owned-a',
};
const VALID_ORIGINS = {
  frontendOrigin: 'http://127.0.0.1:5173',
  backendOrigin: 'http://127.0.0.1:3000',
};

function expectConfigError(input: unknown, leaked: string[] = []): void {
  try {
    parseCalendarSetupOptions(input);
    expect.fail('expected configuration error');
  } catch (error) {
    expect(error).toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'Calendar setup configuration is invalid.',
    });
    const text = `${(error as Error).message}\n${String(error)}\n${(error as Error).stack ?? ''}`;
    for (const value of leaked) expect(text).not.toContain(value);
  }
}

it('default off does not call Google or expose secrets', async () => {
  const f = connectionFixture();
  expect(await f.service.status()).toEqual({
    protocolVersion: 1, state: 'disabled', enabled: false,
    accountEmail: null, targetCalendarId: null, processingDisclosure: null,
  });
  expect(f.network).not.toHaveBeenCalled();
  expect(f.storeCalls.every(call => call.userId === 'u1')).toBe(true);
});

it('empty options stay unconfigured and default off', async () => {
  const parsed = parseCalendarSetupOptions({});
  expect(parsed.oauth).toBeNull();
  expect(parsed.initial.enabled).toBe(false);
  expect(parsed.initial.processingPolicyId).toBeNull();
  const f = connectionFixture();
  const status = await f.service.status();
  expect(status.state).toBe('disabled');
  expect(JSON.stringify(status)).not.toContain('fixture-client-secret');
  expect(JSON.stringify(status)).not.toContain('credentials');
});

it('missing encryption key client secret or policy cannot become connected', async () => {
  const missingSecret = parseCalendarSetupOptions({
    ...VALID_ORIGINS,
    oauth: { clientId: VALID_OAUTH.clientId, redirectUri: VALID_OAUTH.redirectUri,
      targetCalendarId: VALID_OAUTH.targetCalendarId },
    initial: { enabled: true, processingPolicyId: 'fixture-policy' },
    realDataPolicyApproved: true,
  });
  expect(missingSecret.oauth).toBeNull();
  const missingKey = connectionFixture({ configured: true, enabled: true, encryption: false });
  expect(await missingKey.service.status()).toMatchObject({
    state: 'setup-required', enabled: true, targetCalendarId: null,
  });
  expect(missingKey.network).not.toHaveBeenCalled();
  const missingPolicy = connectionFixture({ configured: true, enabled: true, policy: false });
  expect(await missingPolicy.service.status()).toMatchObject({
    state: 'setup-required', enabled: true,
  });
});

it.each([
  ['remote origin', { ...VALID_ORIGINS, frontendOrigin: 'https://evil.example', oauth: VALID_OAUTH },
    ['evil.example']],
  ['credential-bearing origin', { ...VALID_ORIGINS,
    frontendOrigin: 'http://user:pass@127.0.0.1:5173', oauth: VALID_OAUTH },
    ['user', 'pass']],
  ['wrong callback path', { ...VALID_ORIGINS, oauth: { ...VALID_OAUTH,
    redirectUri: 'http://127.0.0.1:3000/oauth/callback' } },
    ['/oauth/callback']],
  ['hostname mismatch', { frontendOrigin: 'http://localhost:5173',
    backendOrigin: 'http://127.0.0.1:3000', oauth: VALID_OAUTH },
    ['localhost', '127.0.0.1']],
  ['control character target', { ...VALID_ORIGINS, oauth: { ...VALID_OAUTH,
    targetCalendarId: 'owned\u0007a' } }, ['owned']],
  ['dot segment target', { ...VALID_ORIGINS, oauth: { ...VALID_OAUTH, targetCalendarId: '..' } },
    ['..']],
] as const)('rejects %s without leaking supplied values', (_name, input, leaked) => {
  expectConfigError(input, [...leaked]);
});

it('accepts omitted or primary target in setup options', () => {
  const withoutTarget = parseCalendarSetupOptions({
    ...VALID_ORIGINS,
    oauth: { clientId: VALID_OAUTH.clientId, clientSecret: VALID_OAUTH.clientSecret, redirectUri: VALID_OAUTH.redirectUri },
  });
  expect(withoutTarget.oauth?.targetCalendarId).toBeUndefined();
  const withPrimary = parseCalendarSetupOptions({
    ...VALID_ORIGINS,
    oauth: { ...VALID_OAUTH, targetCalendarId: 'primary' },
  });
  expect(withPrimary.oauth?.targetCalendarId).toBe('primary');
});

it('accepts a literal owned calendar id and never publishes secrets', async () => {
  const parsed = parseCalendarSetupOptions({
    ...VALID_ORIGINS,
    oauth: VALID_OAUTH,
    initial: { enabled: true, processingPolicyId: 'fixture-policy' },
    realDataPolicyApproved: true,
    evidence: 'fixture',
  });
  expect(parsed.oauth?.targetCalendarId).toBe('owned-a');
  expect(parsed.oauth?.targetCalendarId).not.toBe('primary');
  const f = connectionFixture({ configured: true, enabled: true, targetCalendarId: 'owned-a' });
  const status = await f.service.status();
  expect(status).toMatchObject({
    state: 'setup-required', enabled: true, targetCalendarId: 'owned-a',
    processingDisclosure: {
      policyId: 'fixture-policy',
      processors: 'Google, OpenRouter and the configured model provider',
      dataCollection: 'deny',
    },
  });
  const publicText = JSON.stringify(status);
  expect(publicText).not.toContain('fixture-client-secret');
  expect(publicText).not.toContain('clientSecret');
  expect(publicText).not.toContain('credentials');
  expect(publicText).not.toContain('googleSubjectId');
});

it('grant activation verifies the exact owned target and fences old bindings', async () => {
  const f = connectionFixture({ configured: true, enabled: true });
  await f.installFixtureGrant({ subject: 'fixture-sub-a', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access-a', refreshToken: 'fixture-refresh-a' });
  const first = await f.service.currentBinding();
  expect(first).toMatchObject({ userId: 'u1', googleSubjectId: 'fixture-sub-a', calendarId: 'owned-a' });
  const oldVersion = f.readRecord()!.credentialVersion;
  await f.installFixtureGrant({ subject: 'fixture-sub-b', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access-b', refreshToken: 'fixture-refresh-b' });
  const next = f.readRecord()!;
  expect(next.connectionRevision).toBe(first.connectionRevision + 1);
  expect(next.credentialVersion).toBe(oldVersion + 1);
  await expect(f.service.requireCurrent(first, new AbortController().signal))
    .rejects.toMatchObject({ failure: { category: 'policy' } });
  expect((await f.service.status()).state).toBe('degraded');
});

it('rejects target proof mismatch conflict and does not revoke on failed install', async () => {
  const mismatch = connectionFixture({ configured: true, enabled: true });
  mismatch.target.verifyOwnedTarget = vi.fn(async () => ({
    calendarId: 'other', googleSubjectId: 'fixture-sub-a',
    verifiedAt: new Date(mismatch.clock.now()).toISOString(),
    proofRevision: 'google-calendar.events-owned.v1',
  }));
  await expect(mismatch.installFixtureGrant({ subject: 'fixture-sub-a', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh' })).rejects.toMatchObject({
    failure: { category: 'policy' },
  });
  expect(mismatch.readRecord()).toBeNull();
  expect(mismatch.client.revoke).not.toHaveBeenCalled();

  const denied = connectionFixture({ configured: true, enabled: true });
  denied.target.verifyOwnedTarget = vi.fn(async () => {
    throw Object.assign(new Error('not owned'), { failure: { category: 'policy', code: 'CALENDAR_TARGET_NOT_OWNED', retry: 'none' } });
  });
  await expect(denied.installFixtureGrant({ subject: 'fixture-sub', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh' })).rejects.toBeDefined();
  expect(denied.client.revoke).not.toHaveBeenCalled();

  const conflict = connectionFixture({ configured: true, enabled: true });
  conflict.failNextCas('conflict');
  await expect(conflict.installFixtureGrant({ subject: 'fixture-sub', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh' })).rejects.toMatchObject({
    code: 'PERSISTENCE_ERROR',
  });
});

it('does not retarget an old binding after account replacement', async () => {
  const f = connectionFixture({ configured: true, enabled: true });
  await f.installFixtureGrant({ subject: 'fixture-sub-a', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access-a', refreshToken: 'fixture-refresh-a' });
  const first = await f.service.currentBinding();
  await f.installFixtureGrant({ subject: 'fixture-sub-b', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access-b', refreshToken: 'fixture-refresh-b' });
  await expect(f.service.requireCurrent(first, new AbortController().signal))
    .rejects.toMatchObject({ failure: { category: 'policy' } });
  expect(f.invalidations).toContainEqual({ binding: first, reason: 'replacement' });
  expect(f.readRecord()!.calendarId).toBe('owned-a');
  expect(f.readRecord()!.calendarId).not.toBe('primary');
});

it('local disconnect fences first and never revokes the Google project grant', async () => {
  const f = connectionFixture({ configured: true, enabled: true });
  await f.installFixtureGrant({ subject: 'fixture-sub', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh' });
  const binding = await f.service.currentBinding();
  const result = await f.service.disconnect({ mode: 'local' }, new AbortController().signal);
  expect(result).toEqual({ disconnected: true, remoteRevocation: 'not-requested' });
  expect(f.readRecord()).toMatchObject({ enabled: false, status: 'disconnected', credentials: null });
  expect(f.revoke).not.toHaveBeenCalled();
  await expect(f.service.requireCurrent(binding, new AbortController().signal)).rejects.toBeDefined();
  expect(f.invalidations).toContainEqual({ binding, reason: 'disconnect' });
});

it('settings disable retains credentials and re-enable invalidates old bindings', async () => {
  const f = connectionFixture({ configured: true, enabled: true });
  await f.installFixtureGrant({ subject: 'fixture-sub', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh' });
  const binding = await f.service.currentBinding();
  const disabled = await f.service.settings({ enabled: false }, new AbortController().signal);
  expect(disabled.state).toBe('disabled');
  expect(f.readRecord()?.credentials).not.toBeNull();
  expect(f.revoke).not.toHaveBeenCalled();
  await expect(f.service.requireCurrent(binding, new AbortController().signal)).rejects.toBeDefined();
  const enabled = await f.service.settings({ enabled: true }, new AbortController().signal);
  expect(enabled.enabled).toBe(true);
  await expect(f.service.requireCurrent(binding, new AbortController().signal))
    .rejects.toMatchObject({ failure: { category: 'policy' } });
});

it('explicit revoke requires acknowledgment and runs only after local clear', async () => {
  const f = connectionFixture({ configured: true, enabled: true });
  await f.installFixtureGrant({ subject: 'fixture-sub', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh' });
  await expect(f.service.disconnect({ mode: 'revoke-google-grant' } as never,
    new AbortController().signal)).rejects.toBeDefined();
  expect(f.revoke).not.toHaveBeenCalled();
  f.revoke.mockResolvedValueOnce('confirmed');
  const result = await f.service.disconnect({
    mode: 'revoke-google-grant', acknowledgeProjectWideRevocation: true,
  }, new AbortController().signal);
  expect(result).toEqual({ disconnected: true, remoteRevocation: 'confirmed' });
  expect(f.revoke).toHaveBeenCalledTimes(1);
  expect(f.readRecord()).toMatchObject({ status: 'disconnected', credentials: null });
});

it('close fences without persistence or revoke', async () => {
  const f = connectionFixture({ configured: true, enabled: true });
  await f.installFixtureGrant({ subject: 'fixture-sub', targetCalendarId: 'owned-a',
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh' });
  const binding = await f.service.currentBinding();
  await f.service.close();
  await expect(f.service.requireCurrent(binding, new AbortController().signal)).rejects.toBeDefined();
  expect(f.revoke).not.toHaveBeenCalled();
  expect(f.readRecord()?.status).toBe('connected');
});




