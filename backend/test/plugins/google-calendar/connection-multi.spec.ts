/**
 * ============================================================================
 * FILE: connection-multi.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/connection-multi.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration tests for multi-calendar connection lifecycle and re-consent.
 *
 * ROLE IN PROJECT:
 *    Verifies v2 grant installation, same-subject re-consent, subject mismatch
 *    guarding, and preference preservation under real persistence storage.
 *
 * KEY COMPONENTS:
 *    - Pinless connect: Verifies connection creation without target pin
 *    - Subject switch refusal: Verifies OAUTH_SUBJECT_CHANGED protection on re-consent
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { CALENDAR_SCOPES, CALENDAR_SCOPES_V1 } from '../../../src/contracts/calendar-policy.js';
import { connectionRecordSchema } from '../../../src/contracts/calendar-connections.js';
import { OAuthScopeRejected } from '../../../src/plugins/google-calendar/oauth-client.js';
import { deferred, oauthFixture } from './oauth-fixtures.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('returns a usable continuation after refreshing more than one page of calendars', async () => {
  const f = await multiConnectionFixture();
  for (let index = 2; index < 25; index += 1) {
    f.entries.push({ ...f.entries[1], calendarId: `shared-${index}`, label: `Shared ${index}` });
  }
  const before = (await f.read())!;
  const refreshed = await f.service.refreshCalendars({ expectedConnectionRevision: before.connectionRevision },
    new AbortController().signal);
  expect(refreshed.page.calendars).toHaveLength(20);
  expect(refreshed.page.nextPageToken).toEqual(expect.any(String));
  const next = await f.service.calendars({ pageToken: refreshed.page.nextPageToken });
  expect(next.page.calendars).toHaveLength(5);
  expect(next.page.nextPageToken).toBeNull();
  await f.service.close();
});

it('connects without a pin and leaves primary selection automatic', async () => {
  const f = await multiConnectionFixture({ empty: true });
  const snapshot = await f.service.captureSetupSnapshot();
  expect(snapshot).not.toHaveProperty('targetCalendarId');
  await f.service.installGrant({
    snapshot,
    grant: {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: 'fixture-id-token',
      scopes: [...CALENDAR_SCOPES],
      expiresAt: new Date(f.now() + 3600000).toISOString(),
    },
    account: { subject: 'fixture-sub', email: 'renamed@example.invalid' },
    signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(),
    isCurrentFlow: () => true,
  });
  expect(await f.read()).toMatchObject({
    schemaVersion: 2,
    status: 'connected',
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 },
  });
  expect((await f.service.statusV2()).primaryCalendarId).toBe('canonical-primary');
  expect(f.discover).toHaveBeenCalledTimes(1);
});

it('refuses a subject switch during re-consent without overwriting tokens or preferences', async () => {
  const f = await multiConnectionFixture({ defaultCalendarId: 'shared-team' });
  const snapshot = await f.service.captureSetupSnapshot();
  const before = await f.read();
  await expect(f.service.installGrant({
    snapshot,
    grant: {
      accessToken: 'wrong-access',
      refreshToken: 'wrong-refresh',
      idToken: 'fixture-id-token',
      scopes: [...CALENDAR_SCOPES],
      expiresAt: new Date(f.now() + 3600000).toISOString(),
    },
    account: { subject: 'another-subject', email: null },
    signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(),
    isCurrentFlow: () => true,
  })).rejects.toMatchObject({ failure: { code: 'OAUTH_SUBJECT_CHANGED' } });
  expect(await f.read()).toEqual(before);
  expect(f.discover).not.toHaveBeenCalled();
});

it('preserves default setting across same-subject beginConsent and re-consent', async () => {
  const f = await multiConnectionFixture({ defaultCalendarId: 'shared-team' });
  const before = (await f.read())!;
  await f.service.beginConsent(new AbortController().signal);
  const mid = (await f.read())!;
  expect(mid.status).toBe('reconnect-required');
  expect(mid.connectionRevision).toBe(before.connectionRevision + 1);
  expect(mid.defaultSetting.defaultCalendarId).toBe('shared-team');
  expect(mid.discovery).toBeNull();
  expect(f.invalidated).toHaveBeenCalledWith(
    expect.objectContaining({ googleSubjectId: 'fixture-sub' }),
    'reconnect-required',
  );

  const snapshot = await f.service.captureSetupSnapshot();
  await f.service.installGrant({
    snapshot,
    grant: {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: 'fixture-id-token',
      scopes: [...CALENDAR_SCOPES],
      expiresAt: new Date(f.now() + 3600000).toISOString(),
    },
    account: { subject: 'fixture-sub', email: 'updated@example.invalid' },
    signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(),
    isCurrentFlow: () => true,
  });
  const after = (await f.read())!;
  expect(after.status).toBe('connected');
  expect(after.connectionId).toBe(before.connectionId);
  expect(after.connectionRevision).toBe(mid.connectionRevision + 1);
  expect(after.defaultSetting.defaultCalendarId).toBe('shared-team');
});

it('retains an invalid override as an ID across re-consent', async () => {
  const f = await multiConnectionFixture({ defaultCalendarId: 'nonexistent-cal' });
  await f.service.beginConsent(new AbortController().signal);
  const snapshot = await f.service.captureSetupSnapshot();
  await f.service.installGrant({
    snapshot,
    grant: {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      idToken: 'fixture-id-token',
      scopes: [...CALENDAR_SCOPES],
      expiresAt: new Date(f.now() + 3600000).toISOString(),
    },
    account: { subject: 'fixture-sub', email: null },
    signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(),
    isCurrentFlow: () => true,
  });
  const after = (await f.read())!;
  expect(after.defaultSetting.defaultCalendarId).toBe('nonexistent-cal');
});

it('fails installation on partial consent missing any required scope', async () => {
  for (const missing of CALENDAR_SCOPES) {
    const f = await multiConnectionFixture({ empty: true });
    const snapshot = await f.service.captureSetupSnapshot();
    const partialScopes = CALENDAR_SCOPES.filter((s) => s !== missing);
    await expect(f.service.installGrant({
      snapshot,
      grant: {
        accessToken: 'partial-access',
        refreshToken: 'partial-refresh',
        idToken: 'fixture-id-token',
        scopes: partialScopes,
        expiresAt: new Date(f.now() + 3600000).toISOString(),
      },
      account: { subject: 'fixture-sub', email: null },
      signal: new AbortController().signal,
      deadlineAt: new Date(f.now() + 20000).toISOString(),
      isCurrentFlow: () => true,
    })).rejects.toMatchObject({ failure: { code: 'OAUTH_SCOPE_REJECTED' } });
    expect(await f.read()).toBeNull();
  }
});

it('rejects state replay after partial consent failure', async () => {
  const f = oauthFixture();
  const started = await f.start();
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  f.exchange.mockRejectedValueOnce(
    new OAuthScopeRejected(CALENDAR_SCOPES.filter((s) => s !== 'https://www.googleapis.com/auth/calendar.events')),
  );
  const outcome = await f.callback({ state, code: 'fixture-code', cookie: started.cookie });
  expect(outcome).toBe('failed');
  const status = await f.service.statusV2();
  expect(status.state).toBe('reconnect-required');
  expect(status.missingScopes).toEqual(['https://www.googleapis.com/auth/calendar.events']);
  await expect(f.callback({ state, code: 'fixture-code', cookie: started.cookie }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('causes zero writes on v1 status and preserves legacy pin after explicit migrateLegacy', async () => {
  const f = await multiConnectionFixture({ empty: true });
  const cipher = f.cipher;
  const legacyRecord = connectionRecordSchema.parse({
    schemaVersion: 1,
    provider: 'google-calendar',
    userId: 'u1',
    connectionId: 'legacy-conn',
    revision: 1,
    connectionRevision: 1,
    credentialVersion: 1,
    googleSubjectId: 'fixture-sub',
    accountEmail: 'legacy@example.invalid',
    calendarId: 'legacy-pin-cal',
    targetRevision: 1,
    enabled: true,
    status: 'connected',
    credentials: {
      access: cipher.sealToken({ version: 1, provider: 'google-calendar', userId: 'u1', connectionId: 'legacy-conn', credentialVersion: 1, googleSubjectId: 'fixture-sub', tokenKind: 'access' }, 'leg-acc'),
      refresh: cipher.sealToken({ version: 1, provider: 'google-calendar', userId: 'u1', connectionId: 'legacy-conn', credentialVersion: 1, googleSubjectId: 'fixture-sub', tokenKind: 'refresh' }, 'leg-ref'),
    },
    tokenExpiresAt: new Date(f.now() + 3600000).toISOString(),
    grantedScopes: [...CALENDAR_SCOPES_V1],
    updatedAt: new Date(f.now()).toISOString(),
  });
  await f.adapter.create(legacyRecord);

  // Status check causes zero writes
  const status = await f.service.statusV2();
  expect(status.protocolVersion).toBe(2);
  expect(status.state).toBe('reconnect-required');
  expect(status.missingScopes.length).toBeGreaterThan(0);
  expect(status.connectionRevision).toBe(1);
  expect(status.defaultSetting).toBeNull();
  const v1Check = await f.adapter.get('u1');
  expect(v1Check).toEqual(legacyRecord);

  // Explicit migration
  const migrated = await f.adapter.migrateLegacy({
    userId: 'u1',
    expectedRevision: 1,
    expectedConnectionRevision: 1,
    legacy: legacyRecord,
    now: new Date(f.now()).toISOString(),
    admissionStopped: true,
    executorDrained: true,
  });
  expect(migrated.outcome).toBe('confirmed');

  // Re-consent after migration
  await f.service.beginConsent(new AbortController().signal);
  const snapshot = await f.service.captureSetupSnapshot();
  await f.service.installGrant({
    snapshot,
    grant: {
      accessToken: 'migrated-access',
      refreshToken: 'migrated-refresh',
      idToken: 'fixture-id-token',
      scopes: [...CALENDAR_SCOPES],
      expiresAt: new Date(f.now() + 3600000).toISOString(),
    },
    account: { subject: 'fixture-sub', email: 'legacy@example.invalid' },
    signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(),
    isCurrentFlow: () => true,
  });
  const after = (await f.read())!;
  expect(after.defaultSetting.defaultCalendarId).toBe('legacy-pin-cal');
});

it('cannot publish old-account discovery after disconnect and replacement', async () => {
  const f = await multiConnectionFixture({ defaultCalendarId: 'shared-team' });
  const old = (await f.read())!;
  const gate = deferred<NonNullable<typeof old.discovery>>();
  f.discover.mockImplementationOnce(() => gate.promise);
  const refresh = f.service.refreshCalendars({ expectedConnectionRevision: old.connectionRevision },
    new AbortController().signal).catch(e => e);
  await vi.waitFor(() => expect(f.discover).toHaveBeenCalledTimes(1));
  await f.service.disconnect({ mode: 'local' }, new AbortController().signal);
  const snapshot = await f.service.captureSetupSnapshot();
  await f.service.installGrant({ snapshot, grant: { accessToken: 'replacement-access',
    refreshToken: 'replacement-refresh', idToken: 'fixture-id-token', scopes: [...CALENDAR_SCOPES],
    expiresAt: new Date(f.now() + 3600000).toISOString() },
    account: { subject: 'replacement-sub', email: null }, signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(), isCurrentFlow: () => true });
  const replacement = (await f.read())!;
  gate.resolve({ ...old.discovery!, discoveryRevision: old.revision + 1 });
  await refresh;
  expect(await f.read()).toEqual(replacement);
  expect(replacement.googleSubjectId).toBe('replacement-sub');
  expect(replacement.defaultSetting.defaultCalendarId).toBeNull();
  expect(replacement.discovery?.connectionId).toBe(replacement.connectionId);
});
