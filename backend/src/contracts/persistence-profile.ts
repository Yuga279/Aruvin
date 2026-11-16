/**
 * ============================================================================
 * FILE: persistence-profile.ts
 * LOCATION: backend/src/contracts/persistence-profile.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define supported persistence profile labels and conservative size headroom.
 *
 * ROLE IN PROJECT:
 *    Keeps Phase 1 storage limits service-agnostic until P2 verifies the
 *    selected service's actual document and feature capabilities.
 *
 * KEY COMPONENTS:
 *    - persistenceProfileSchema: Allowed service-profile identifiers.
 *    - documentHeadroomBytes: Conservative size budget for every profile.
 * ============================================================================
 */

import { z } from 'zod';

export const PERSISTENCE_PROFILES = [
  'unknown',
  'native-mongodb',
  'cosmos-mongodb-ru',
  'azure-documentdb',
] as const;

export const persistenceProfileSchema = z.enum(PERSISTENCE_PROFILES);
export type PersistenceProfile = z.infer<typeof persistenceProfileSchema>;

export const CONSERVATIVE_DOCUMENT_LIMIT_BYTES = 2_000_000;
export const CONSERVATIVE_DOCUMENT_HEADROOM_BYTES = 1_800_000;

export function documentHeadroomBytes(_profile: PersistenceProfile): number {
  return CONSERVATIVE_DOCUMENT_HEADROOM_BYTES;
}
