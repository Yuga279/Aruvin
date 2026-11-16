/**
 * ============================================================================
 * FILE: calendar-multi-discovery.spec.ts
 * LOCATION: backend/test/contracts/calendar-multi-discovery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Google Calendar Phase 2 discovery, roles, snapshots, and connection v2 contracts.
 *
 * ROLE IN PROJECT:
 *    Tests bounded discovery snapshots, effective capabilities, canonical primary resolution,
 *    and connection CAS / transition schemas without inventing primary or scopes.
 *
 * KEY COMPONENTS:
 *    - calendarDiscoverySnapshotSchema / calendarDiscoveryEntrySchema
 *    - effectiveCalendarCapabilities / primaryCalendarId
 *    - calendarConnectionV2Schema / calendarConnectionTransitionV2Schema
 *    - calendarOAuthOptionsV2Schema
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { CALENDAR_SCOPES, CALENDAR_SCOPES_V1 } from '../../src/contracts/calendar-policy.js';
import { calendarDiscoverySnapshotSchema, calendarDiscoveryEntrySchema, calendarDefaultSettingSchema,
  effectiveCalendarCapabilities, primaryCalendarId, calendarConnectionV2Schema,
  calendarConnectionTransitionV2Schema,
  type CalendarConnectionStoreV2, type CalendarDiscoveryPort,
} from '../../src/contracts/calendar-discovery.js';
import { snapshot, entry, at, until } from './calendar-multi-fixtures.js';
import { calendarOAuthOptionsSchema, calendarOAuthOptionsV2Schema } from '../../src/contracts/calendar-connections.js';

it('admits bounded discovery and shared roles without inventing a primary or scope', () => {
  const oauth = { clientId: 'client', redirectUri: 'http://localhost:3000/api/plugins/google-calendar/oauth/callback' };
  expect(calendarOAuthOptionsV2Schema.safeParse(oauth).success).toBe(true);
  expect(calendarOAuthOptionsSchema.safeParse(oauth).success).toBe(false);
  expect(primaryCalendarId(calendarDiscoverySnapshotSchema.parse(snapshot))).toBe(entry.calendarId);
  const absent = { ...snapshot, entries: [{ ...entry, primary: false }], complete: false,
    limitations: ['primary-missing'] };
  expect(calendarDiscoverySnapshotSchema.safeParse(absent).success).toBe(true);
  expect(primaryCalendarId(calendarDiscoverySnapshotSchema.parse(absent))).toBeNull();
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries: [entry,
    { ...entry, calendarId: 'other' }] }).success).toBe(false);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, nextPageToken: 'short-page-more' }).success).toBe(false);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot,
    expiresAt: '2026-10-22T10:05:00.001Z' }).success).toBe(false);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot,
    entries: Array.from({ length: 101 }, (_, i) => ({ ...entry, primary: i === 0,
      calendarId: `cal-${i}` })) }).success).toBe(false);
  expect(calendarDiscoveryEntrySchema.safeParse({ ...entry, accessRole: 'superOwner' }).success).toBe(false);
  for (const role of ['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'] as const) {
    const caps = effectiveCalendarCapabilities(role, CALENDAR_SCOPES, true);
    expect(caps.createEvents).toBe(['owner', 'writer', 'writerWithoutPrivateAccess'].includes(role));
    expect(caps.readEvents).toBe(role !== 'freeBusyReader');
    expect(caps.availability).toBe(true);
    expect(effectiveCalendarCapabilities(role, CALENDAR_SCOPES_V1, true))
      .toEqual({ readEvents: false, createEvents: false, availability: false });
  }
  expect(calendarDiscoveryEntrySchema.safeParse({ ...entry,
    accessRole: 'writerWithoutPrivateAccess', privateAccess: false }).success).toBe(true);
  expect(calendarDiscoveryEntrySchema.safeParse({ ...entry,
    accessRole: 'writerWithoutPrivateAccess', privateAccess: true }).success).toBe(false);
  const pref = calendarDefaultSettingSchema.parse({ defaultCalendarId: null, defaultSettingRevision: 1 });
  const connection = { schemaVersion: 2, connectionId: 'c', connectionRevision: 1,
    userId: 'u', provider: 'google-calendar',
    revision: 1, credentialVersion: 1, googleSubjectId: 'sub', accountEmail: null,
    enabled: false, status: 'reconnect-required', credentials: null, tokenExpiresAt: null,
    grantedScopes: [], updatedAt: at, defaultSetting: pref, discovery: snapshot };
  const first = calendarConnectionV2Schema.parse(connection);
  const changed = calendarConnectionV2Schema.parse({ ...first, revision: 2,
    defaultSetting: { defaultCalendarId: entry.calendarId, defaultSettingRevision: 2 } });
  expect(changed.connectionRevision).toBe(first.connectionRevision);
  expect(until).toBe(snapshot.expiresAt);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries: [entry, entry] }).success).toBe(false);
  expect(primaryCalendarId(calendarDiscoverySnapshotSchema.parse(snapshot))).not.toBe('renamed@example.com');
  expect(calendarDiscoveryEntrySchema.safeParse({ ...entry, calendarId: 'primary' }).success).toBe(false);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries: [], complete: false,
    limitations: ['primary-missing'] }).success).toBe(true);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot,
    retentionExpiresAt: '2026-10-22T10:01:00.000Z' }).success).toBe(false);
  const volatile = { ...snapshot, retentionPolicyId: null, expiresAt: at, retentionExpiresAt: at };
  expect(calendarDiscoverySnapshotSchema.safeParse(volatile).success).toBe(true);
  expect(calendarConnectionV2Schema.safeParse({ ...first, discovery: volatile }).success).toBe(false);
  expect(calendarConnectionV2Schema.safeParse({ ...first, connectionRevision: 2 }).success).toBe(false);
  expect(calendarConnectionTransitionV2Schema.safeParse({ previous: first, next: changed }).success).toBe(true);
  expect(calendarConnectionTransitionV2Schema.safeParse({ previous: first,
    next: { ...changed, connectionRevision: 2, discovery: null } }).success).toBe(false);
  const store: CalendarConnectionStoreV2 = { get: async () => null,
    create: async () => ({ outcome: 'uncertain' }),
    compareAndSwap: async () => ({ outcome: 'uncertain' }) };
  const discovery: CalendarDiscoveryPort = { discover: async () => calendarDiscoverySnapshotSchema.parse(snapshot) };
  expect(store.get).toBeTypeOf('function'); expect(discovery.discover).toBeTypeOf('function');
});
