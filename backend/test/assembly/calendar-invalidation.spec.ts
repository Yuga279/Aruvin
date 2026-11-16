/**
 * ============================================================================
 * FILE: calendar-invalidation.spec.ts
 * LOCATION: backend/test/assembly/calendar-invalidation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify P8 wires stream quiescence through paged account-revision invalidation.
 *
 * ROLE IN PROJECT:
 *    Exercises AppService's invalidation callback over the assembled v2 store.
 *    Proves the fence stays closed across pages and failed scans do not reopen.
 *
 * KEY COMPONENTS:
 *    - Page loop: cursor null through nextCursor null with one timestamp.
 *    - Fence: abort-and-wait through persistence; no release on scan failure.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { DurableChatRuntime } from '../../src/chat-runtime/durable-chat-runtime.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { assembledCalendarApp } from './calendar-fixture.js';
import { deferred } from './admin-config-fixture.js';

const USER = 'aurvin-dev-user';

function assembledRuntime(h: Awaited<ReturnType<typeof assembledCalendarApp>>): DurableChatRuntime {
  const created = vi.mocked(h.f.ports.runtime).mock.results.at(-1)?.value;
  if (!(created instanceof DurableChatRuntime)) throw new Error('Missing assembled runtime.');
  return created;
}

it('pages account-revision invalidation from a null cursor after streams quiesce', async () => {
  const h = await assembledCalendarApp();
  try {
    const runtime = assembledRuntime(h);
    const quiesce = vi.spyOn(runtime, 'quiesceStreams');
    const release = vi.spyOn(runtime, 'releaseStreamFence');
    const cursors: Array<string | null> = [];
    const stamps = new Set<string>();
    const invalidate = vi.spyOn(h.cal.p.calendarRetention, 'invalidateAccountRevisionPage')
      .mockImplementation(async (input) => {
        cursors.push(input.cursor);
        stamps.add(input.now);
        if (input.cursor === null) return { nextCursor: 'page-1' };
        return { nextCursor: null };
      });
    const account = await h.service.calendarFor(USER).connections.currentAccount();
    await h.service.calendarFor(USER).connections.rejectUnauthorizedAccount(account);
    expect(quiesce).toHaveBeenCalled();
    expect(cursors).toEqual([null, 'page-1']);
    expect(stamps.size).toBe(1);
    expect(invalidate.mock.calls.every(([input]) =>
      input.account.connectionId === account.connectionId
      && input.account.connectionRevision === account.connectionRevision)).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(quiesce.mock.invocationCallOrder[0]!).toBeLessThan(invalidate.mock.invocationCallOrder[0]!);
    expect(invalidate.mock.invocationCallOrder.at(-1)!).toBeLessThan(release.mock.invocationCallOrder[0]!);
  } finally { await h.dispose(); }
});

it('does not release the stream fence when a paged scan fails and retries from a null cursor', async () => {
  const h = await assembledCalendarApp();
  try {
    const runtime = assembledRuntime(h);
    const release = vi.spyOn(runtime, 'releaseStreamFence');
    const cursors: Array<string | null> = [];
    let attempts = 0;
    vi.spyOn(h.cal.p.calendarRetention, 'invalidateAccountRevisionPage')
      .mockImplementation(async (input) => {
        cursors.push(input.cursor);
        attempts += 1;
        if (attempts === 1) throw new AppError('PERSISTENCE_ERROR', 'scan failed', false);
        if (input.cursor === null) return { nextCursor: 'page-1' };
        return { nextCursor: null };
      });
    const account = await h.service.calendarFor(USER).connections.currentAccount();
    await expect(h.service.calendarFor(USER).connections.rejectUnauthorizedAccount(account))
      .rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    expect(release).not.toHaveBeenCalled();
    expect(cursors).toEqual([null]);
    await h.service.calendarFor(USER).connections.disconnect({ mode: 'local' }, new AbortController().signal);
    expect(cursors).toEqual([null, null, 'page-1']);
    expect(release).toHaveBeenCalledTimes(1);
  } finally { await h.dispose(); }
});

it('waits through reserved stream persistence before paging and rejects new attachments while fenced', async () => {
  const h = await assembledCalendarApp();
  try {
    const runtime = assembledRuntime(h);
    const persist = deferred<void>();
    let persisted = false;
    const slot = runtime.reserveStream(USER, 's-open', new AbortController().signal);
    const run = slot.run(async () => {
      await persist.promise;
      persisted = true;
    });
    const enteredQuiesce = deferred<void>();
    const originalQuiesce = runtime.quiesceStreams.bind(runtime);
    vi.spyOn(runtime, 'quiesceStreams').mockImplementation(async (timeoutMs) => {
      enteredQuiesce.resolve();
      return originalQuiesce(timeoutMs);
    });
    const pages: Array<string | null> = [];
    vi.spyOn(h.cal.p.calendarRetention, 'invalidateAccountRevisionPage')
      .mockImplementation(async (input) => {
        expect(persisted).toBe(true);
        pages.push(input.cursor);
        if (input.cursor === null) return { nextCursor: 'page-1' };
        return { nextCursor: null };
      });
    const account = await h.service.calendarFor(USER).connections.currentAccount();
    const invalidating = h.service.calendarFor(USER).connections.rejectUnauthorizedAccount(account);
    await enteredQuiesce.promise;
    expect(pages).toEqual([]);
    expect(() => runtime.reserveStream(USER, 's-new', new AbortController().signal))
      .toThrow(expect.objectContaining({ code: 'NOT_READY' }));
    persist.resolve();
    await invalidating;
    await run;
    expect(pages).toEqual([null, 'page-1']);
    const after = runtime.reserveStream(USER, 's-after', new AbortController().signal);
    after.release();
  } finally { await h.dispose(); }
});

it('fails closed without paging or releasing when quiesce does not drain', async () => {
  const h = await assembledCalendarApp();
  try {
    const runtime = assembledRuntime(h);
    vi.spyOn(runtime, 'quiesceStreams').mockResolvedValue({
      drained: false, active: 1, unresolvedWrites: 1, fenced: true,
    });
    const release = vi.spyOn(runtime, 'releaseStreamFence');
    const invalidate = vi.spyOn(h.cal.p.calendarRetention, 'invalidateAccountRevisionPage');
    const account = await h.service.calendarFor(USER).connections.currentAccount();
    await expect(h.service.calendarFor(USER).connections.rejectUnauthorizedAccount(account))
      .rejects.toMatchObject({ code: 'NOT_READY' });
    expect(invalidate).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  } finally { await h.dispose(); }
});
