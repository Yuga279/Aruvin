/**
 * ============================================================================
 * FILE: auth-calendar.spec.ts
 * LOCATION: backend/test/assembly/auth-calendar.spec.ts
 * ============================================================================
 * PURPOSE: Prove Calendar capability and status stay isolated by owner.
 * ROLE IN PROJECT: Guards AppService calendarFor/configFor routing so one
 * owner's connection cannot leak into another owner's projection.
 * KEY COMPONENTS: assembledCalendarApp explicit-owner status and eligibility.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { assembledCalendarApp } from './calendar-fixture.js';

it('does not let an unconnected owner borrow another owner Calendar capability or status', async () => {
  const f = await assembledCalendarApp();
  try {
    const a = f.service.calendarFor('aurvin-dev-user');
    const b = f.service.calendarFor('u2');
    const aStatus = await a.connections.statusV2();
    const bStatus = await b.connections.statusV2();
    expect(aStatus.connectionRevision).not.toBeNull();
    expect(aStatus.state).toBe('degraded'); // This fixture intentionally uses evidence='fixture'.
    expect(bStatus.accountEmail).toBeNull();
    expect(bStatus.discovery).toBeNull();
    expect(f.service.configFor('aurvin-dev-user')!.calendar!.enabled).toBe(true);
    expect(f.service.configFor('u2')!.calendar!.enabled).toBe(false);
    expect(f.service.configFor('u2')!.revision).toBe(f.service.configFor('aurvin-dev-user')!.revision);
    expect(a.connections.userId).not.toBe(b.connections.userId);
  } finally { await f.dispose(); }
});

it('keeps another owner Calendar projection after one owner is disconnected', async () => {
  const f = await assembledCalendarApp();
  try {
    const a = f.service.calendarFor('aurvin-dev-user');
    const b = f.service.calendarFor('u2');
    await a.connections.statusV2();
    await b.connections.statusV2();
    const revision = f.service.configFor('u2')!.revision;
    await a.connections.disconnect({ mode: 'local' }, new AbortController().signal);
    expect(f.service.configFor('aurvin-dev-user')!.calendar!.enabled).toBe(false);
    expect(f.service.configFor('u2')!.revision).toBe(revision);
    expect(b.connections.userId).toBe('u2');
    expect((await b.connections.statusV2()).accountEmail).toBeNull();
  } finally { await f.dispose(); }
});
