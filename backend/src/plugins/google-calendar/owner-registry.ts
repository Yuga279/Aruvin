/**
 * ============================================================================
 * FILE: owner-registry.ts
 * LOCATION: backend/src/plugins/google-calendar/owner-registry.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Hold explicit-owner Calendar connection/OAuth/runtime compartments.
 *
 * ROLE IN PROJECT:
 *    Shares admitted repositories across owners without ambient identity
 *    resolution at construction or during refresh/cleanup.
 *
 * KEY COMPONENTS:
 *    - CalendarOwnerRegistry.forUser: Lazy, capped, immutable owner lookup.
 *    - get/values: Existing compartments only; never invent an owner.
 * ============================================================================
 */

import { idSchema } from '../../contracts/identifiers.js';
import { AppError } from '../../platform/errors/app-error.js';

export class CalendarOwnerRegistry<T> {
  private readonly owners = new Map<string, T>();
  constructor(private readonly create: (userId: string) => T) {}
  forUser(userId: string): T {
    idSchema.parse(userId);
    const found = this.owners.get(userId);
    if (found !== undefined) return found;
    // ponytail: 32 resident owners/process; add quiescent eviction only if
    // installation size grows. Never evict OAuth/refresh/operation evidence.
    if (this.owners.size >= 32) throw new AppError('CONCURRENCY_LIMIT', 'Plugin capacity is unavailable.');
    const created = this.create(userId); this.owners.set(userId, created); return created;
  }
  get(userId: string): T | undefined { return this.owners.get(userId); }
  values(): T[] { return [...this.owners.values()]; }
}
