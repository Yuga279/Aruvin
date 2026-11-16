/**
 * ============================================================================
 * FILE: calendar-restart.spec.ts
 * LOCATION: backend/test/operations/calendar-restart.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify owner-fenced Calendar writes and bounded central refresh shutdown.
 *
 * ROLE IN PROJECT:
 *    Exercises AppService's existing lifecycle tracker over deterministic stores.
 *    Prevents safe-close claims while writes or refresh jobs remain unsettled.
 *
 * KEY COMPONENTS:
 *    - Write fencing: Executor checks and uncertain-ack retention.
 *    - Refresh drain: Process abort, underlying job settlement, and one close.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { AppService } from '../../src/app.service.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { GoogleCalendarConnections } from '../../src/plugins/google-calendar/connection.js';
import type { CalendarCalendarsResponse } from '../../src/contracts/calendar-wire.js';
import { assemblyFixture, deferred } from '../assembly/admin-config-fixture.js';
import { assembledCalendarApp } from '../assembly/calendar-fixture.js';

it('Calendar stop fences without disconnect, revoke, or a second close', async () => {
  const f = assemblyFixture();
  const service = await AppService.create(f.bootstrap, f.ports);
  const disconnect = vi.fn();
  expect(f.fetcher).not.toHaveBeenCalled();
  await expect(service.operations.shutdown()).resolves.toEqual({ safe: true });
  await service.operations.shutdown();
  expect(disconnect).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.fetcher).not.toHaveBeenCalled();
});

it('checks executor ownership before a v2 preference write', async () => {
  const h = await assembledCalendarApp();
  await h.cal.setDefault('team@example.test');
  const saved = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
  if (!saved || saved.schemaVersion !== 2) throw new Error('Missing fixture account.');
  const write = vi.spyOn(h.cal.p.calendarConnectionsV2, 'compareAndSwap');
  const owner = vi.spyOn(h.cal.p.owner, 'assertExecutor')
    .mockRejectedValue(new AppError('NOT_READY', 'Ownership is unavailable.', false));
  try {
    await expect(h.service.calendarFor('aurvin-dev-user').connections.settings({ defaultSetting: {
      calendarId: null,
      expectedRevision: saved.defaultSetting.defaultSettingRevision,
      expectedConnectionRevision: saved.connectionRevision,
    } }, new AbortController().signal)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(owner).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  } finally { owner.mockRestore(); write.mockRestore(); await h.dispose(); }
});

it('retains persistence ownership after an uncertain v2 preference acknowledgement', async () => {
  const h = await assembledCalendarApp();
  await h.cal.setDefault('team@example.test');
  const saved = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
  if (!saved || saved.schemaVersion !== 2) throw new Error('Missing fixture account.');
  const write = vi.spyOn(h.cal.p.calendarConnectionsV2, 'compareAndSwap')
    .mockResolvedValueOnce({ outcome: 'uncertain' });
  try {
    await expect(h.service.calendarFor('aurvin-dev-user').connections.settings({ defaultSetting: {
      calendarId: null,
      expectedRevision: saved.defaultSetting.defaultSettingRevision,
      expectedConnectionRevision: saved.connectionRevision,
    } }, new AbortController().signal)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    await expect(h.service.operations.shutdown()).resolves.toEqual({ safe: false });
    expect(h.close).not.toHaveBeenCalled();
  } finally { write.mockRestore(); await h.dispose(); }
});

it('aborts and drains explicit refresh before the single persistence close', async () => {
  const entered = deferred<AbortSignal>();
  const pending = deferred<CalendarCalendarsResponse>();
  const refresh = vi.spyOn(GoogleCalendarConnections.prototype, 'refreshCalendars')
    .mockImplementation((_request, signal) => {
      entered.resolve(signal);
      return pending.promise;
    });
  const h = await assembledCalendarApp();
  try {
    const request = h.service.calendarFor('aurvin-dev-user').connections.refreshCalendars(
      { expectedConnectionRevision: 1 }, new AbortController().signal).catch(error => error);
    const signal = await entered.promise;
    const stopped = h.service.operations.shutdown();
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(h.close).not.toHaveBeenCalled();
    pending.reject(new AppError('CANCELLED', 'Refresh stopped.', false));
    await expect(request).resolves.toMatchObject({ code: 'CANCELLED' });
    await expect(stopped).resolves.toEqual({ safe: true });
    expect(h.close).toHaveBeenCalledTimes(1);
    await expect(Promise.resolve().then(() => h.service.calendarFor('aurvin-dev-user').connections.refreshCalendars(
      { expectedConnectionRevision: 1 }, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally {
    pending.reject(new AppError('CANCELLED', 'Fixture cleanup.', false));
    refresh.mockRestore();
    await h.dispose();
  }
});
