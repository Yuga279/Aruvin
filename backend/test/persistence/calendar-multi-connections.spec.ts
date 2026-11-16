/**
 * ============================================================================
 * FILE: calendar-multi-connections.spec.ts
 * LOCATION: backend/test/persistence/calendar-multi-connections.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Tests for multi-calendar connection persistence with independent preference authority.
 *
 * ROLE IN PROJECT:
 *    Verifies v2 connection creation, CAS with defaultSettingRevision, reset,
 *    and conflict semantics without fencing account authority.
 *
 * KEY COMPONENTS:
 *    - Saves and resets a default across restart without fencing an account.
 *    - Idempotent CAS confirmation.
 *    - Expected revision conflict detection.
 *    - Preference revision rules and validation bounds.
 *    - Token rotation, account replacement, and disconnect transitions.
 *    - Bounded count/byte/lifetime and partial grant rejections.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoCalendarConnections } from '../../src/persistence/calendar-connections.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { connectionV2 } from './calendar-multi-fixtures.js';
import { at, entry } from '../contracts/calendar-multi-fixtures.js';

it('saves and resets a default across restart without fencing an account', async () => {
  const f = calendarMemory();
  const first = connectionV2();
  const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  expect((await a.v2.create(first)).outcome).toBe('confirmed');
  const next = { ...first, revision: 2, updatedAt: at,
    defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } };
  expect((await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next })).outcome).toBe('confirmed');
  const b = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  expect(await b.v2.get('u')).toEqual(next);
  expect((await b.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next })).outcome).toBe('confirmed');
  const reset = { ...next, revision: 3,
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 3 } };
  expect((await b.v2.compareAndSwap({ userId: 'u', expectedRevision: 2,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 2, next: reset })).outcome).toBe('confirmed');
  expect((await b.v2.get('u'))?.connectionRevision).toBe(1);
  expect(await b.v2.get('other-user')).toBeNull();
  expect(f.rows('integration_connections').size).toBe(1);
});

it('advances only document CAS when default value is unchanged', async () => {
  const f = calendarMemory();
  const first = connectionV2();
  const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  await a.v2.create(first);
  const selected = { ...first, revision: 2,
    defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } };
  await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next: selected });

  // Update without changing the default setting value
  const sameDefault = { ...selected, revision: 3, updatedAt: '2026-10-22T10:02:00.000Z' };
  const res = await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 2,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 2, next: sameDefault });
  expect(res.outcome).toBe('confirmed');
  if (res.outcome === 'confirmed') {
    expect(res.record.revision).toBe(3);
    expect(res.record.defaultSetting.defaultSettingRevision).toBe(2);
  }

  // Wrong expected default revision conflicts
  const wrongDefaultRev = { ...sameDefault, revision: 4, updatedAt: '2026-10-22T10:03:00.000Z' };
  const conflictRes = await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 3,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 99, next: wrongDefaultRev });
  expect(conflictRes.outcome).toBe('conflict');
  if (conflictRes.outcome === 'conflict') {
    expect(conflictRes.currentRevision).toBe(3);
    expect(conflictRes.currentDefaultSettingRevision).toBe(2);
  }

  // Changed default with no setting-revision increment rejects INVALID_REQUEST
  const changedNoBump = { ...sameDefault, revision: 4,
    defaultSetting: { defaultCalendarId: 'other-cal@group.calendar.google.com', defaultSettingRevision: 2 } };
  await expect(a.v2.compareAndSwap({ userId: 'u', expectedRevision: 3,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 2, next: changedNoBump }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  // Supplied 'primary' ID fails schema validation
  const primaryInvalid = { ...sameDefault, revision: 4,
    defaultSetting: { defaultCalendarId: 'primary' as never, defaultSettingRevision: 3 } };
  await expect(a.v2.compareAndSwap({ userId: 'u', expectedRevision: 3,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 2, next: primaryInvalid }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('does not let stale discovery or token refresh overwrite a winning preference', async () => {
  const f = calendarMemory();
  const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const first = connectionV2();
  await a.v2.create(first);
  const selected = { ...first, revision: 2,
    defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } };
  await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next: selected });
  const stale = { ...first, revision: 2, discovery: { ...first.discovery!, discoveryRevision: 2 } };
  expect((await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next: stale })).outcome).toBe('conflict');
  const refreshed = { ...selected, revision: 3, discovery: { ...first.discovery!, discoveryRevision: 3 } };
  f.failNext('after-write');
  expect((await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 2,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 2, next: refreshed })).outcome).toBe('confirmed');
  expect(await a.v2.get('u')).toEqual(refreshed);
  const rollbackSnapshot = { ...refreshed, revision: 4, discovery: first.discovery };
  await expect(a.v2.compareAndSwap({ userId: 'u', expectedRevision: 3,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 2, next: rollbackSnapshot }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('requires token and authority revisions only for their own mutations', async () => {
  for (const patch of [
    { credentials: { ...connectionV2().credentials!, access: {
      ...connectionV2().credentials!.access!, ciphertext: 'Yg==' } } },
    { credentialVersion: 2 },
    { enabled: false },
    { connectionRevision: 2, discovery: null },
    { discovery: { ...connectionV2().discovery!, complete: false,
      discoveryRevision: 2, limitations: ['provider-error'] } },
  ]) {
    const f = calendarMemory(); const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
    const first = connectionV2(); await a.v2.create(first);
    await expect(a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
      expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1,
      next: { ...first, revision: 2, ...patch } as ReturnType<typeof connectionV2> }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  }
});

it('handles token rotation, disconnect, account replacement, and write/read failures', async () => {
  const f = calendarMemory();
  const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const first = connectionV2();
  await a.v2.create(first);

  // Positive token rotation: both ciphertexts replaced, credentialVersion + 1, no other revision changes
  const rotated = {
    ...first,
    revision: 2,
    credentialVersion: 2,
    credentials: {
      access: { ...first.credentials!.access!, ciphertext: 'cm90YXRlZC1hY2Nlc3M=' },
      refresh: { ...first.credentials!.refresh, ciphertext: 'cm90YXRlZC1yZWZyZXNo' },
    },
    updatedAt: '2026-10-22T10:02:00.000Z',
  };
  expect((await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 1,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next: rotated })).outcome).toBe('confirmed');

  // Disconnect: tokens/discovery removed, enablement false, status disconnected, connectionRevision + 1, credentialVersion + 1
  const disconnected = {
    ...rotated,
    revision: 3,
    connectionRevision: 2,
    credentialVersion: 3,
    enabled: false,
    status: 'disconnected' as const,
    credentials: null,
    discovery: null,
    tokenExpiresAt: null,
    updatedAt: '2026-10-22T10:03:00.000Z',
  };
  expect((await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 2,
    expectedConnectionRevision: 1, expectedDefaultSettingRevision: 1, next: disconnected })).outcome).toBe('confirmed');

  // Account replacement: new subject/connection, reset override and discovery, setting revision + 1, connectionRevision + 1
  const replaced = {
    ...disconnected,
    revision: 4,
    connectionId: 'c2',
    googleSubjectId: 'sub2',
    accountEmail: 'new@example.com',
    enabled: true,
    status: 'connected' as const,
    connectionRevision: 3,
    credentialVersion: 4,
    credentials: {
      access: { ...first.credentials!.access!, ciphertext: 'bmV3LWFjY2Vzcw==' },
      refresh: { ...first.credentials!.refresh, ciphertext: 'bmV3LXJlZnJlc2g=' },
    },
    tokenExpiresAt: '2026-10-22T11:00:00.000Z',
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 2 },
    discovery: null,
    updatedAt: '2026-10-22T10:04:00.000Z',
  };
  expect((await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 3,
    expectedConnectionRevision: 2, expectedDefaultSettingRevision: 1, next: replaced })).outcome).toBe('confirmed');

  // Fail before write: row remains unchanged, returns conflict
  const attempt5 = { ...replaced, revision: 5, updatedAt: '2026-10-22T10:05:00.000Z' };
  f.failNext('before-write');
  const failBefore = await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 4,
    expectedConnectionRevision: 3, expectedDefaultSettingRevision: 2, next: attempt5 });
  expect(failBefore.outcome).toBe('conflict');

  // Read-unavailable check on confirmation path returns uncertain
  const attempt6 = { ...replaced, revision: 5, updatedAt: '2026-10-22T10:06:00.000Z' };
  const rawSpy = vi.spyOn(f.store, 'raw').mockRejectedValueOnce(new Error('simulated read failure'));
  const uncertainRes = await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 4,
    expectedConnectionRevision: 3, expectedDefaultSettingRevision: 2, next: attempt6 });
  expect(uncertainRes.outcome).toBe('uncertain');
  rawSpy.mockRestore();

  // Retry with same payload confirms
  const confirmedRes = await a.v2.compareAndSwap({ userId: 'u', expectedRevision: 4,
    expectedConnectionRevision: 3, expectedDefaultSettingRevision: 2, next: attempt6 });
  expect(confirmedRes.outcome).toBe('confirmed');
});

it('rejects oversized count byte lifetime and partial-grant connection writes before storage', async () => {
  const c = connectionV2();
  const entries = Array.from({ length: 100 }, (_, i) => ({ ...entry,
    calendarId: `cal-${i}`, primary: i === 0 }));
  const huge = entries.map((e, i) => ({ ...e, calendarId: `${i}-${'界'.repeat(1019)}`,
    label: '界'.repeat(200), timeZone: '界'.repeat(100) }));
  const invalid = [
    { ...c, discovery: { ...c.discovery!, entries: [...entries, { ...entry, calendarId: 'overflow', primary: false }] } },
    { ...c, discovery: { ...c.discovery!, entries: huge } },
    { ...c, discovery: { ...c.discovery!, expiresAt: '2026-10-22T10:05:00.001Z' } },
    { ...c, grantedScopes: c.grantedScopes.slice(0, -1) },
  ];
  for (const value of invalid) {
    const f = calendarMemory(); const a = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
    await expect(a.v2.create(value as never)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(f.rows('integration_connections').size).toBe(0);
  }
});
