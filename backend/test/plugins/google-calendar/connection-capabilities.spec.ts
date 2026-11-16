/**
 * ============================================================================
 * FILE: connection-capabilities.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/connection-capabilities.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for CalendarCapabilityGate role and operation checking.
 *
 * ROLE IN PROJECT:
 *    Ensures read/create/availability permissions are checked against fresh provider
 *    evidence, saved defaults do not silently fall back, and missing primary clarifies.
 *
 * KEY COMPONENTS:
 *    - Role/operation gating: Distinct permissions for reader/writer/owner/freeBusy
 *    - Default preservation: Clarifies on missing or ambiguous saved targets
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { effectiveCalendarCapabilities } from '../../../src/contracts/calendar-discovery.js';
import { CALENDAR_SCOPES, CALENDAR_SCOPES_V1 } from '../../../src/contracts/calendar-policy.js';
import { multiConnectionFixture } from './connection-multi-fixtures.js';

it('gates read create and availability separately on fresh shared roles', async () => {
  for (const role of ['owner', 'writer', 'writerWithoutPrivateAccess', 'reader', 'freeBusyReader'] as const) {
    for (const operation of ['read', 'create', 'availability'] as const) {
      const f = await multiConnectionFixture();
      f.entries[1] = { ...f.entries[1]!, accessRole: role,
        privateAccess: role === 'owner' || role === 'writer',
        capabilities: effectiveCalendarCapabilities(role, CALENDAR_SCOPES, true) };
      // Expire selection evidence: a fresh cache is deliberately reused; the
      // independent effect gate below must still see immediate provider changes.
      f.advance(300001);
      const result = await f.service.capabilityGate.resolve(await f.request(operation, 'shared-team'));
      const allowed = operation === 'availability'
        || (operation === 'read' ? role !== 'freeBusyReader' : !['reader', 'freeBusyReader'].includes(role));
      expect(result.outcome).toBe(allowed ? 'resolved' : 'denied');
      if (result.outcome === 'resolved') {
        expect(result.target.calendarId).toBe('shared-team');
        expect(result.target.privateAccess).toBe(role === 'owner' || role === 'writer');
      }
      expect(f.discover).toHaveBeenCalled();
    }
  }
  const old = await multiConnectionFixture({ scopes: CALENDAR_SCOPES_V1 });
  await expect(old.service.currentAccount()).rejects.toMatchObject({ failure: { code: 'CALENDAR_RECONNECT_REQUIRED' } });
  expect(old.client.refresh).not.toHaveBeenCalled();
});

it('does not silently replace an unavailable saved default or invent primary from email', async () => {
  const f = await multiConnectionFixture({ defaultCalendarId: 'gone-calendar' });
  expect(await f.service.capabilityGate.resolve(await f.request('create')))
    .toMatchObject({ outcome: 'clarify', code: 'CALENDAR_DEFAULT_UNAVAILABLE' });
  expect(await f.service.capabilityGate.resolve(await f.request('create', 'unknown')))
    .toMatchObject({ outcome: 'clarify', code: 'CALENDAR_TARGET_UNKNOWN' });
  f.entries[0] = { ...f.entries[0]!, primary: false };
  f.advance(300001);
  f.discover.mockImplementationOnce(async input => ({ ...((await f.read())!.discovery!),
    discoveryRevision: input.discoveryRevision, entries: f.entries, complete: false,
    limitations: ['primary-missing'] }));
  expect(await f.service.capabilityGate.resolve(await f.request('create', 'primary')))
    .toMatchObject({ outcome: 'clarify', code: 'CALENDAR_PRIMARY_MISSING' });
});

it('reuses fresh selection but checks provider revocation independently at the effect boundary', async () => {
  const f = await multiConnectionFixture();
  try {
    const request = await f.request('create', 'shared-team');
    const resolved = await f.service.resolveTarget(request);
    expect(resolved.outcome).toBe('resolved');
    if (resolved.outcome !== 'resolved') throw new Error('Fixture target missing');
    expect(f.discover).not.toHaveBeenCalled();
    f.entries[1] = { ...f.entries[1]!, accessRole: 'reader', privateAccess: false,
      capabilities: effectiveCalendarCapabilities('reader', CALENDAR_SCOPES, true) };
    await expect(f.service.requireTargetCurrent({ ...request, target: resolved.target }))
      .rejects.toMatchObject({ failure: { code: 'CALENDAR_TARGET_READ_ONLY' } });
    expect(f.discover).toHaveBeenCalledTimes(1);
  } finally { await f.service.close(); }
});
