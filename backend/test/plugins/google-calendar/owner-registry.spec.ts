/**
 * ============================================================================
 * FILE: owner-registry.spec.ts
 * LOCATION: backend/test/plugins/google-calendar/owner-registry.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Calendar owner compartments are created lazily and reused by userId.
 *
 * ROLE IN PROJECT:
 *    Proves construction never resolves ambient identity and the 32-owner cap.
 *
 * KEY COMPONENTS:
 *    - Reuse test: Same owner returns the same compartment.
 *    - Capacity test: 33rd owner is rejected; existing lookup still works.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { CalendarOwnerRegistry } from '../../../src/plugins/google-calendar/owner-registry.js';
import { AppError } from '../../../src/platform/errors/app-error.js';

it('reuses only the same owner compartment and never resolves an ambient identity at construction', () => {
  const create = vi.fn((userId: string) => ({ userId }));
  const owners = new CalendarOwnerRegistry(create);
  expect(create).not.toHaveBeenCalled();
  const a = owners.forUser('u1'), b = owners.forUser('u2');
  expect(a).not.toBe(b);
  expect(owners.forUser('u1')).toBe(a);
  expect(create.mock.calls.map(c => c[0])).toEqual(['u1', 'u2']);
  expect(owners.values()).toEqual([a, b]);
});

it('rejects a 33rd owner and still returns an existing compartment at capacity', () => {
  const owners = new CalendarOwnerRegistry((userId: string) => ({ userId }));
  const first = owners.forUser('u1');
  for (let i = 2; i <= 32; i++) owners.forUser(`u${i}`);
  expect(() => owners.forUser('u33')).toThrow(AppError);
  expect(() => owners.forUser('u33')).toThrow(/Plugin capacity is unavailable/);
  expect(owners.forUser('u1')).toBe(first);
  expect(owners.get('u33')).toBeUndefined();
});
