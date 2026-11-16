/**
 * ============================================================================
 * FILE: auth-multi-owner-recovery.spec.ts
 * LOCATION: backend/test/operations/auth-multi-owner-recovery.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify local maintenance scans every mapped owner without inference.
 *
 * ROLE IN PROJECT:
 *    Guards multi-owner recovery so inactive accounts are included, one
 *    maintenance runtime drains once, and unmapped legacy data is not adopted.
 *
 * KEY COMPONENTS:
 *    - finishLocalMaintenanceForUsers: Active and inactive owner scans.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { finishLocalMaintenanceForUsers } from '../../src/operations/local-recovery.js';
import { options } from './fixtures.js';
import type { MongoOwnership } from '../../src/persistence/ownership.js';
import type { UsersRepository } from '../../src/contracts/auth.js';
import { account } from '../auth/fixtures.js';

it('finishes recovery only after both active and inactive account owners are scanned', async () => {
  const maintenance = options().runtime, fresh = options().runtime;
  vi.spyOn(maintenance, 'snapshot').mockReturnValue({ accepting: false, active: 0, unresolvedWrites: 0, degraded: false });
  vi.spyOn(maintenance, 'drain').mockResolvedValue({ drained: true, active: 0, unresolvedWrites: 0 });
  const listForRecovery = vi.fn(async (_userId: string, _page: unknown) => ({ items: [], nextCursor: null }));
  const finish = vi.fn(async () => undefined);
  const create = vi.fn().mockReturnValueOnce(maintenance).mockReturnValueOnce(fresh);
  const owner = { finishLocalRecovery: finish } as unknown as MongoOwnership;
  const users: Pick<UsersRepository, 'list'> = { list: vi.fn(async () => ({ items: [
    { account: account({ userId: 'u1', status: 'active' }), revision: 1 },
    { account: account({ userId: 'u2', status: 'inactive' }), revision: 2 },
  ], nextCursor: null })) };
  expect(await finishLocalMaintenanceForUsers(owner, { listForRecovery }, users, ['old'], 1000, create)).toBe(fresh);
  expect(listForRecovery.mock.calls.map(c => c[0])).toEqual(['u1', 'u2']);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(2);
  expect(maintenance.executeTurn).not.toHaveBeenCalled();
});

it('does not finish or admit a fresh runtime when a later owner scan fails', async () => {
  const maintenance = options().runtime;
  vi.spyOn(maintenance, 'snapshot').mockReturnValue({ accepting: false, active: 0, unresolvedWrites: 0, degraded: false });
  const listForRecovery = vi.fn(async (userId: string) => {
    if (userId === 'u2') throw new Error('fixture owner scan failed');
    return { items: [], nextCursor: null };
  });
  const finish = vi.fn(async () => undefined);
  const create = vi.fn(() => maintenance);
  const owner = { finishLocalRecovery: finish } as unknown as MongoOwnership;
  const users: Pick<UsersRepository, 'list'> = { list: vi.fn(async () => ({ items: [
    { account: account({ userId: 'u1', status: 'active' }), revision: 1 },
    { account: account({ userId: 'u2', status: 'inactive' }), revision: 2 },
  ], nextCursor: null })) };
  await expect(finishLocalMaintenanceForUsers(owner, { listForRecovery }, users, ['old'], 1000, create))
    .rejects.toThrow('fixture owner scan failed');
  expect(finish).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledTimes(1);
});

it('fails closed on a non-advancing account cursor', async () => {
  const maintenance = options().runtime;
  vi.spyOn(maintenance, 'snapshot').mockReturnValue({ accepting: false, active: 0, unresolvedWrites: 0, degraded: false });
  const listForRecovery = vi.fn(async () => ({ items: [], nextCursor: null }));
  const finish = vi.fn(async () => undefined);
  const create = vi.fn(() => maintenance);
  const owner = { finishLocalRecovery: finish } as unknown as MongoOwnership;
  const users: Pick<UsersRepository, 'list'> = { list: vi.fn(async () => ({ items: [
    { account: account({ userId: 'u1' }), revision: 1 },
  ], nextCursor: 'same' })) };
  await expect(finishLocalMaintenanceForUsers(owner, { listForRecovery }, users, ['old'], 1000, create))
    .rejects.toMatchObject({ code: 'NOT_READY' });
  expect(finish).not.toHaveBeenCalled();
});
