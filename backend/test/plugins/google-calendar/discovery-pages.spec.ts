/**
 * ============================================================================
 * FILE: discovery-pages.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/discovery-pages.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for cached calendar discovery pagination and HMAC-signed cursors.
 *
 * ROLE IN PROJECT:
 *    Verifies bounded pages, HMAC cursor integrity, expiration handling,
 *    and retention expiry enforcement without provider calls.
 *
 * KEY COMPONENTS:
 *    - Paged calendars: 20-entry chunks bounded by 15360 page bytes
 *    - HMAC cursors: Scoped token validation with expiry checks
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarCalendarsResponseSchema } from '../../../src/contracts/calendar-wire.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('pages cached calendars by count and bytes without exposing provider continuation or refreshing', async () => {
  const f = await multiConnectionFixture();
  const old = (await f.read())!;
  const entries = Array.from({ length: 25 }, (_, i) => ({ ...f.entries[0]!,
    calendarId: `cal-${String(i).padStart(2, '0')}`, label: `Calendar ${i}`, primary: i === 0 }));
  expect((await f.patch({ discovery: null })).outcome).toBe('confirmed');
  const cleared = (await f.read())!;
  expect((await f.patch({ discovery: { ...old.discovery!, discoveryRevision: cleared.revision + 1,
    entries, complete: false, truncated: true, nextPageToken: 'private-provider-token',
    limitations: ['page-limit'] } })).outcome).toBe('confirmed');
  const a = calendarCalendarsResponseSchema.parse(await f.service.calendars({}));
  expect(a.page.calendars).toHaveLength(20);
  expect(a.page.nextPageToken).not.toBe('private-provider-token');
  const b = calendarCalendarsResponseSchema.parse(await f.service.calendars({ pageToken: a.page.nextPageToken! }));
  expect(b.page.calendars).toHaveLength(5);
  expect(b.page.nextPageToken).toBeNull();
  expect(new Set([...a.page.calendars, ...b.page.calendars].map(c => c.calendarId)).size).toBe(25);
  expect(a.page.complete).toBe(false);
  expect(Buffer.byteLength(JSON.stringify(a), 'utf8')).toBeLessThanOrEqual(16384);
  expect(f.discover).not.toHaveBeenCalled();
});

it('rejects tampered or expired calendar cursors without network or identity leakage', async () => {
  const f = await multiConnectionFixture();
  await expect(f.service.calendars({ pageToken: 'forged.signature' })).rejects.toBeDefined();
  const before = (await f.read())!;
  expect((await f.patch({ discovery: { ...before.discovery!, discoveryRevision: before.revision + 1,
    expiresAt: new Date(f.now() + 60000).toISOString(),
    retentionExpiresAt: new Date(f.now() + 300000).toISOString() } })).outcome).toBe('confirmed');
  f.advance(60000);
  const stale = await f.service.calendars({});
  expect(stale.page.limitations).toContain('stale');
  expect(stale.page.complete).toBe(false);
  expect(f.discover).not.toHaveBeenCalled();
  f.advance(240000);
  await expect(f.service.calendars({})).rejects.toMatchObject({ code: 'NOT_READY' });
});
