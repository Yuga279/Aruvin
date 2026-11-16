/**
 * ============================================================================
 * FILE: deactivation.spec.ts
 * LOCATION: backend/test/administration/deactivation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify post-confirmation cleanup without a second runtime owner.
 *
 * ROLE IN PROJECT:
 *    Defines the P3 hook and finite best-effort WorkOS revocation.
 *    Keeps cleanup failures separate from confirmed local access state.
 *
 * KEY COMPONENTS:
 *    - Ordering, failures, pagination and deadline assertions.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { administrationFixture } from './fixtures.js';

it('notifies P3 with only the internal ID after inactive state is durable', async () => {
  const hook = vi.fn<(id: string) => Promise<void>>();
  const f = await administrationFixture({ onUserDeactivated: hook });
  const observations: unknown[] = [];
  hook.mockImplementation(async id => {
    observations.push((await f.users.get(id))?.account);
  });
  f.provider.listSessions.mockResolvedValueOnce({ ids: ['sid_1', 'sid_2'], nextCursor: 'page_2' })
    .mockResolvedValueOnce({ ids: ['sid_3'], nextCursor: null });
  await f.service.deactivate(f.admin, 'u1', {});
  expect(hook).toHaveBeenCalledExactlyOnceWith('u1');
  expect(observations[0]).toMatchObject({ status: 'inactive', currentWorkosSessionId: null });
  expect(f.provider.listSessions.mock.calls).toEqual([['user_fixture_1', undefined], ['user_fixture_1', 'page_2']]);
  expect(f.provider.revoke.mock.calls.map(c => c[0])).toEqual(['sid_1', 'sid_2', 'sid_3']);
  await f.service.deactivate(f.admin, 'u1', {});
  expect(hook).toHaveBeenCalledTimes(2); // Reattempt missed cleanup, no new local mutation.
  await f.service.reactivate(f.admin, 'u1', {});
  expect(hook).toHaveBeenCalledTimes(2); // Reactivation never resurrects work.
});
it('does not invoke cleanup for an uncertain local write', async () => {
  const hook = vi.fn(); const f = await administrationFixture({ onUserDeactivated: hook });
  vi.spyOn(f.users, 'compareAndSwap').mockResolvedValueOnce({ outcome: 'uncertain' });
  await expect(f.service.deactivate(f.admin, 'u1', {})).rejects.toMatchObject({ code: 'ACCOUNT_WRITE_UNCERTAIN' });
  expect(hook).not.toHaveBeenCalled(); expect(f.provider.revoke).not.toHaveBeenCalled();
  expect(f.provider.listSessions).not.toHaveBeenCalled();
});
it('keeps confirmed local deactivation effective when provider cleanup or hook fails', async () => {
  const hook = vi.fn(async () => { throw new Error('private-hook-error'); });
  const f = await administrationFixture({ onUserDeactivated: hook });
  f.provider.revoke.mockRejectedValue(new Error('private-provider-error'));
  f.provider.listSessions.mockRejectedValueOnce(new Error('provider-down'));
  expect((await f.service.deactivate(f.admin, 'u1', {})).user.status).toBe('inactive');
  expect(hook).toHaveBeenCalledExactlyOnceWith('u1');
  expect((await f.users.get('u1'))?.account.currentWorkosSessionId).toBeNull();
});
it('caps cleanup pages and stops repeated cursors', async () => {
  const f = await administrationFixture();
  f.provider.listSessions.mockResolvedValue({ ids: [], nextCursor: 'same' });
  await f.service.deactivate(f.admin, 'u1', {});
  expect(f.provider.listSessions).toHaveBeenCalledTimes(2);
  const g = await administrationFixture(); let n = 0;
  g.provider.listSessions.mockImplementation(async () => ({ ids: [], nextCursor: `page_${++n}` }));
  await g.service.deactivate(g.admin, 'u1', {});
  expect(g.provider.listSessions).toHaveBeenCalledTimes(3);
});
it('bounds waiting to ten seconds and dispatches no further provider work after the deadline', async () => {
  vi.useFakeTimers(); let settle!: () => void;
  try {
    const f = await administrationFixture();
    f.provider.revoke.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
    const pending = f.service.deactivate(f.admin, 'u1', {});
    await vi.advanceTimersByTimeAsync(10001);
    expect((await pending).user.status).toBe('inactive');
    settle(); await vi.advanceTimersByTimeAsync(1);
    expect(f.provider.listSessions).not.toHaveBeenCalled();
  } finally { settle?.(); vi.useRealTimers(); }
});
