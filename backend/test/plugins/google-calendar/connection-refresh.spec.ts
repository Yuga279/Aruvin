/**
 * ============================================================================
 * FILE: connection-refresh.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/connection-refresh.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit and concurrency tests for OAuth token rotation and credential refresh.
 *
 * ROLE IN PROJECT:
 *    Ensures single-flight token rotation, budget accounting, AAD credential
 *    versioning, concurrent preference rebase, and single-action effect safety.
 *
 * KEY COMPONENTS:
 *    - Refresh single-flight & coalescing: Multi-caller token refresh sharing
 *    - Rotation with preference rebase: Preserving concurrent preference CAS
 *    - Effect callback non-retry: Ensuring mutations are never auto-retried on 401
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';
import { GoogleCalendarConnections, tokenAad } from '../../../src/plugins/google-calendar/connection.js';
import { toolFault } from '../../../src/plugins/google-calendar/tools-validation.js';
import { connectionFixture, refreshFixture } from './connection-fixtures.js';
import { deferred } from './oauth-fixtures.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';
import { DEFAULT_BUDGETS } from '../../../src/contracts/budgets.js';
import { MongoCalendarConnections } from '../../../src/persistence/calendar-connections.js';
import { CalendarSecretCipher } from '../../../src/platform/crypto/calendar-secret-cipher.js';
import { calendarMemory } from '../../persistence/calendar-multi-memory.js';
import { connectionV2 } from '../../persistence/calendar-multi-fixtures.js';
import { calendarConnectionV2Schema } from '../../../src/contracts/calendar-discovery.js';

it('rotates the whole encrypted pair while preserving a concurrent preference', async () => {
  const f = await multiConnectionFixture({ expiredToken: true });
  const gate = deferred<{ accessToken: string; refreshToken: string | null;
    expiresAt: string; scopes: string[] | null }>();
  f.client.refresh.mockImplementationOnce(() => gate.promise);
  const account = await f.service.currentAccount();
  const consumeRefreshRequest = vi.fn(async () => undefined);
  const pending = f.service.withAccessToken({ account, signal: new AbortController().signal,
    deadlineAt: new Date(f.now() + 20000).toISOString(), consumeRefreshRequest }, async token => token);
  await vi.waitFor(() => expect(f.client.refresh).toHaveBeenCalledTimes(1));
  await f.patch({ defaultSetting: { defaultCalendarId: 'shared-team', defaultSettingRevision: 2 } });
  gate.resolve({ accessToken: 'rotated-access', refreshToken: null,
    expiresAt: new Date(f.now() + 3600000).toISOString(), scopes: null });
  expect(await pending).toBe('rotated-access');
  const saved = (await f.read())!;
  expect(saved.connectionRevision).toBe(account.connectionRevision);
  expect(saved.defaultSetting).toEqual({ defaultCalendarId: 'shared-team', defaultSettingRevision: 2 });
  expect(saved.credentialVersion).toBe(2);
  expect(f.cipher.openToken(tokenAad(saved, 'refresh'), saved.credentials!.refresh)).toBe('fixture-refresh');
  expect(consumeRefreshRequest).toHaveBeenCalledTimes(1);
});

it('never retries an arbitrary effect callback after an unauthorized response', async () => {
  const f = await multiConnectionFixture();
  const action = vi.fn(async () => { throw toolFault('credential', 'RECONNECT_REQUIRED'); });
  await expect(f.service.withAccessToken({ account: await f.service.currentAccount(),
    signal: new AbortController().signal, deadlineAt: new Date(f.now() + 20000).toISOString(),
    consumeRefreshRequest: vi.fn(async () => undefined) }, action)).rejects.toBeDefined();
  expect(action).toHaveBeenCalledTimes(1);
});

it('concurrent refresh is single flight and rotation is durable before use', async () => {
  const f = refreshFixture();
  await f.seedExpiredGrant();
  const a = f.useToken(), b = f.useToken();
  await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
  f.releaseRefresh({ accessToken: 'fixture-access-new', refreshToken: 'fixture-refresh-new',
    expiresAt: new Date(f.clock.now() + 3600000).toISOString(), scopes: [...CALENDAR_SCOPES] });
  expect(await Promise.all([a, b])).toEqual(['fixture-access-new', 'fixture-access-new']);
  expect(f.refreshBudget).toHaveBeenCalledTimes(1);
  expect(f.actionBeforeConfirmedCas).toBe(false);
  expect(f.readRecord()!.credentialVersion).toBe(2);
});

it('uses a fresh token without refresh', async () => {
  const f = refreshFixture();
  await f.installFixtureGrant({
    subject: 'fixture-sub',
    accessToken: 'fixture-access', refreshToken: 'fixture-refresh',
  });
  expect(await f.useToken()).toBe('fixture-access');
  expect(f.refresh).not.toHaveBeenCalled();
});

it('ten concurrent callers share one refresh request', async () => {
  const f = refreshFixture();
  await f.seedExpiredGrant();
  const callers = Array.from({ length: 10 }, () => f.useToken());
  await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
  f.releaseRefresh({ accessToken: 'fixture-access-new', refreshToken: 'fixture-refresh-new',
    expiresAt: new Date(f.clock.now() + 3600000).toISOString(), scopes: [...CALENDAR_SCOPES] });
  expect(await Promise.all(callers)).toEqual(Array(10).fill('fixture-access-new'));
  expect(f.refreshBudget).toHaveBeenCalledTimes(1);
});

it('retains the refresh token under new AAD when Google omits a replacement', async () => {
  const f = refreshFixture();
  await f.seedExpiredGrant();
  const pending = f.useToken();
  await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
  f.releaseRefresh({
    accessToken: 'fixture-access-new', refreshToken: null,
    expiresAt: new Date(f.clock.now() + 3600000).toISOString(), scopes: null,
  });
  expect(await pending).toBe('fixture-access-new');
  const record = f.readRecord()!;
  expect(record.credentialVersion).toBe(2);
  expect(f.cipher.openToken(tokenAad(record, 'refresh'), record.credentials!.refresh)).toBe('fixture-refresh');
});

it('does not refresh when the budget callback denies', async () => {
  const f = refreshFixture();
  await f.seedExpiredGrant();
  f.refreshBudget.mockRejectedValueOnce(Object.assign(new Error('budget'), {
    failure: { category: 'budget', code: 'CALENDAR_REFRESH_BUDGET', retry: 'none' },
  }));
  await expect(f.useToken()).rejects.toMatchObject({ failure: { category: 'budget' } });
  expect(f.refresh).not.toHaveBeenCalled();
});

it('cannot restore a rotated token after a failed CAS', async () => {
  const f = refreshFixture();
  await f.seedExpiredGrant();
  f.failNextCas('uncertain');
  const pending = f.useToken();
  await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
  f.releaseRefresh({ accessToken: 'fixture-access-new', refreshToken: 'fixture-refresh-new',
    expiresAt: new Date(f.clock.now() + 3600000).toISOString(), scopes: [...CALENDAR_SCOPES] });
  await expect(pending).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  expect(f.readRecord()!.credentialVersion).toBe(1);
});

it('keeps different-owner refresh independent on a shared multi-record store', async () => {
  const memory = calendarMemory();
  const adapter = new MongoCalendarConnections(memory.store, DEFAULT_BUDGETS);
  const cipher = new CalendarSecretCipher({ status: 'ready', key: Buffer.alloc(32, 7) });
  const now = Date.parse('2026-10-22T10:00:00.000Z');
  const make = async (userId: string) => {
    const base = connectionFixture({ configured: true, enabled: true });
    const initial = connectionV2();
    const record = calendarConnectionV2Schema.parse({
      ...initial, userId, googleSubjectId: `sub-${userId}`,
      credentials: {
        access: cipher.sealToken(tokenAad({ ...initial, userId, googleSubjectId: `sub-${userId}` }, 'access'), `access-${userId}`),
        refresh: cipher.sealToken(tokenAad({ ...initial, userId, googleSubjectId: `sub-${userId}` }, 'refresh'), `refresh-${userId}`),
      },
      tokenExpiresAt: new Date(now - 1).toISOString(),
    });
    await adapter.v2.create(record);
    const service = new GoogleCalendarConnections({
      store: base.store, storeV2: adapter.v2, cipher, options: base.options,
      userId, client: base.client, now: () => now,
    });
    return { service, client: base.client };
  };
  const a = await make('u1'), b = await make('u2');
  const gateA = deferred<{ accessToken: string; refreshToken: string | null; expiresAt: string; scopes: string[] | null }>();
  const gateB = deferred<{ accessToken: string; refreshToken: string | null; expiresAt: string; scopes: string[] | null }>();
  a.client.refresh.mockImplementationOnce(() => gateA.promise);
  b.client.refresh.mockImplementationOnce(() => gateB.promise);
  const pendingA = a.service.withAccessToken({ account: await a.service.currentAccount(),
    signal: new AbortController().signal, deadlineAt: new Date(now + 20000).toISOString(),
    consumeRefreshRequest: vi.fn(async () => undefined) }, async token => token);
  const pendingB = b.service.withAccessToken({ account: await b.service.currentAccount(),
    signal: new AbortController().signal, deadlineAt: new Date(now + 20000).toISOString(),
    consumeRefreshRequest: vi.fn(async () => undefined) }, async token => token);
  await vi.waitFor(() => {
    expect(a.client.refresh).toHaveBeenCalledTimes(1);
    expect(b.client.refresh).toHaveBeenCalledTimes(1);
  });
  gateB.resolve({ accessToken: 'b-access', refreshToken: null, expiresAt: new Date(now + 3600000).toISOString(), scopes: null });
  expect(await pendingB).toBe('b-access');
  expect(a.client.refresh).toHaveBeenCalledTimes(1);
  gateA.resolve({ accessToken: 'a-access', refreshToken: null, expiresAt: new Date(now + 3600000).toISOString(), scopes: null });
  expect(await pendingA).toBe('a-access');
});
