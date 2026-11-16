import { expect, it } from 'vitest';
import { CALENDAR_BOOTSTRAP_ENV_NAMES, loadCalendarBootstrap } from './calendar-config.js';
import { loadBootstrapConfig } from './bootstrap-config.js';

const LOCAL_FRONTEND = 'http://127.0.0.1:5173';
const LOCAL_PORT = 3000;

it('does not opt into Calendar or require loopback when Calendar is absent', () => {
  expect(loadCalendarBootstrap({}, 'https://existing-admin.invalid', 3000)).toBeNull();
});

it('keeps a partial setup default-off and never approves policy from an id alone', () => {
  const value = loadCalendarBootstrap({
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID: 'fixture-policy',
  }, LOCAL_FRONTEND, LOCAL_PORT)!;
  expect(value.setup.initial.enabled).toBe(false);
  expect(value.setup.oauth).toBeNull();
  expect(value.setup.realDataPolicyApproved).toBe(false);
  expect(value.permission.minimalEvidenceAllowed).toBe(false);
});

it('rejects a nonlocal setup without exposing supplied secrets', () => {
  try {
    loadCalendarBootstrap({ AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret' },
      'https://existing-admin.invalid', 3000);
    expect.fail('nonlocal setup was admitted');
  } catch (error) {
    expect(error).toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(String(error)).not.toContain('fixture-secret');
  }
});

it.each([
  ['unknown boolean spelling', { AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED: 'yes' }, []],
  ['uppercase boolean', { AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED: 'TRUE' }, []],
  ['numeric boolean', { AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED: '1' }, []],
  ['malformed date-only deadline', { AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT: '2026-10-21' },
    ['2026-10-21']],
  ['malformed relative deadline', { AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT: 'tomorrow' },
    ['tomorrow']],
  ['invalid IANA timezone', { AURVIN_GOOGLE_CALENDAR_TIME_ZONE: 'Not/AZone' }, ['Not/AZone']],
  ['arbitrary remote redirect', {
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret',
    AURVIN_GOOGLE_CALENDAR_REDIRECT_URI: 'https://evil.invalid/callback',
    AURVIN_GOOGLE_CALENDAR_TARGET_ID: 'owned-a',
  }, ['fixture-secret', 'evil.invalid']],
  ['mixed localhost and 127.0.0.1', {
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret',
    AURVIN_GOOGLE_CALENDAR_REDIRECT_URI:
      'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
    AURVIN_GOOGLE_CALENDAR_TARGET_ID: 'owned-a',
  }, ['fixture-secret']],
  ['credentials in a URL', {
    AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET: 'http://user:fixture-secret@127.0.0.1:5173',
  }, ['fixture-secret']],
] as const)('rejects %s without exposing supplied secrets', (_name, env, leaked) => {
  const frontend = _name === 'mixed localhost and 127.0.0.1'
    ? 'http://localhost:5173'
    : LOCAL_FRONTEND;
  try {
    loadCalendarBootstrap({ ...env }, frontend, LOCAL_PORT);
    expect.fail(`${_name} was admitted`);
  } catch (error) {
    expect(error).toMatchObject({ code: 'CONFIGURATION_ERROR' });
    const text = `${String(error)}\n${(error as Error).stack ?? ''}`;
    for (const value of leaked) expect(text).not.toContain(value);
  }
});

it('accepts the deprecated primary target for compatibility instead of rejecting it', () => {
  // The multi-calendar amendment relaxed the env pin that used to reject
  // `primary`: the legacy target is a compatibility value that never becomes a
  // v2 targeting authority. See docs/google-calendar-multi-calendar/goal.md.
  const value = loadCalendarBootstrap({
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret',
    AURVIN_GOOGLE_CALENDAR_REDIRECT_URI:
      'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
    AURVIN_GOOGLE_CALENDAR_TARGET_ID: 'primary',
  }, LOCAL_FRONTEND, LOCAL_PORT)!;
  expect(value.setup.oauth?.targetCalendarId).toBeUndefined();
  expect(value.setup.initial.enabled).toBe(false);
});

it('configures OAuth without a target and ignores deprecated environment targeting', () => {
  const env = {
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret',
    AURVIN_GOOGLE_CALENDAR_REDIRECT_URI:
      'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
    AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID: 'fixture-policy',
    AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED: 'true',
    AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED: 'true',
    AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT: '2099-01-01T00:00:00.000Z',
  };
  const plain = loadCalendarBootstrap(env, LOCAL_FRONTEND, LOCAL_PORT)!;
  const legacy = loadCalendarBootstrap({ ...env,
    AURVIN_GOOGLE_CALENDAR_TARGET_ID: 'old-owned-calendar',
  }, LOCAL_FRONTEND, LOCAL_PORT)!;
  expect(plain.setup.oauth).toMatchObject({ clientId: 'fixture-client' });
  expect(plain.setup.oauth?.targetCalendarId).toBeUndefined();
  expect(legacy.setup).toEqual(plain.setup);
  expect(plain.setup.initial.enabled).toBe(false);
  expect(plain.setup.realDataPolicyApproved).toBe(true);
});

it('treats blank optional flags as absent rather than true', () => {
  const value = loadCalendarBootstrap({
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED: '',
    AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED: '',
    AURVIN_GOOGLE_CALENDAR_CONTENT_PERMISSION: '',
  }, LOCAL_FRONTEND, LOCAL_PORT)!;
  expect(value.setup.realDataPolicyApproved).toBe(false);
  expect(value.permission.minimalEvidenceAllowed).toBe(false);
  expect(value.permission.content).toBe('volatile');
});

it('ignores a scope override environment name', () => {
  const value = loadCalendarBootstrap({
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_SCOPES: 'https://www.googleapis.com/auth/calendar',
  }, LOCAL_FRONTEND, LOCAL_PORT)!;
  expect(CALENDAR_BOOTSTRAP_ENV_NAMES).not.toContain('AURVIN_GOOGLE_CALENDAR_SCOPES');
  expect(value.setup.oauth).toBeNull();
  expect(value.setup.initial.enabled).toBe(false);
});

it('keeps expired policy as a plugin gate without breaking ordinary text bootstrap', () => {
  const env = {
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID: 'fixture-policy',
    AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED: 'true',
    AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED: 'true',
    AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT: '2020-01-01T00:00:00.000Z',
  };
  const value = loadCalendarBootstrap(env, LOCAL_FRONTEND, LOCAL_PORT)!;
  expect(value.policyDeadlines[0]).toBeLessThan(Date.now());
  const bootstrap = loadBootstrapConfig({
    NODE_ENV: 'development',
    FRONTEND_ORIGIN: LOCAL_FRONTEND,
    ...env,
  });
  expect(bootstrap.frontendOrigin).toBe(LOCAL_FRONTEND);
  expect(bootstrap.calendar?.policyDeadlines[0]).toBeLessThan(Date.now());
});
