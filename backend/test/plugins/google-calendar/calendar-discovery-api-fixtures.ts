/**
 * ============================================================================
 * FILE: calendar-discovery-api-fixtures.ts
 * LOCATION: backend/test/plugins/google-calendar/calendar-discovery-api-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide typed test fixtures and builders for Google Calendar P3 discovery and availability.
 *
 * ROLE IN PROJECT:
 *    Supports unit and regression tests for CalendarDiscoveryApi and CalendarAvailabilityApi.
 *
 * KEY COMPONENTS:
 *    - discoveryInput / availabilityInput: Default mock inputs for provider ports.
 *    - providerEntry: Factory for mock Google CalendarList items.
 *    - snapshot: Factory for valid CalendarDiscoverySnapshot instances.
 * ============================================================================
 */

import type { CalendarDiscoveryPort } from '../../../src/contracts/calendar-discovery.js';
import { calendarDiscoverySnapshotSchema } from '../../../src/contracts/calendar-discovery.js';
import type { CalendarAvailabilityPort } from '../../../src/contracts/calendar-availability.js';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';

export const NOW = '2026-10-22T10:00:00.000Z';
export const clock = () => Date.parse(NOW);
export type DiscoveryInput = Parameters<CalendarDiscoveryPort['discover']>[0];
export type AvailabilityInput = Parameters<CalendarAvailabilityPort['check']>[0];
export function discoveryInput(patch: Partial<DiscoveryInput> = {}): DiscoveryInput {
  return { account: { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' },
    accessToken: 'fixture-token', signal: new AbortController().signal,
    grantedScopes: CALENDAR_SCOPES, policyAllows: true,
    retentionPolicy: { policyId: 'fixture-policy', expiresAt: '2026-10-22T10:05:00.000Z' },
    now: NOW, deadlineAt: '2026-10-22T10:00:20.000Z',
    consumeRequest: async () => {}, mode: 'in-turn', discoveryRevision: 1,
    limits: { retainedCalendars: 100, pageDeliveries: 2, snapshotBytes: 262144, freshnessMs: 300000 },
    ...patch };
}
export function providerEntry(id = 'canonical-primary', patch: Record<string, unknown> = {}) {
  return { id, summary: id, accessRole: 'owner', primary: id === 'canonical-primary',
    timeZone: 'Europe/London', selected: true, ...patch };
}
export function snapshot(count = 1) {
  return calendarDiscoverySnapshotSchema.parse({ schemaVersion: 2,
    connectionId: 'c', connectionRevision: 1, discoveryRevision: 1,
    entries: Array.from({ length: count }, (_, i) => ({ calendarId: `c${i}`, label: `Calendar ${i}`,
      primary: i === 0, accessRole: 'owner', privateAccess: true, timeZone: 'Europe/London',
      selected: true, hidden: false, deleted: false,
      capabilities: { readEvents: true, createEvents: true, availability: true } })),
    fetchedAt: NOW, expiresAt: '2026-10-22T10:05:00.000Z', complete: true,
    truncated: false, nextPageToken: null, limitations: [], retentionPolicyId: 'fixture-policy',
    retentionExpiresAt: '2026-10-22T10:05:00.000Z' });
}
export function availabilityInput(patch: Partial<AvailabilityInput> = {}): AvailabilityInput {
  const { mode: _mode, discoveryRevision: _revision, limits: _limits, ...context } = discoveryInput();
  return { ...context, snapshot: snapshot(), calendarIds: ['c0'],
    timeMin: '2026-10-22T11:00:00.000Z', timeMax: '2026-10-22T12:00:00.000Z',
    timeZone: 'Europe/London', purpose: 'availability', availabilityRevision: 1,
    limits: { batchCalendars: 50, batches: 2, busyIntervals: 2000,
      workingBytes: 262144, resultBytes: 15360 }, ...patch };
}
