/**
 * ============================================================================
 * FILE: versions.ts
 * LOCATION: backend/src/contracts/versions.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define the initial schema and protocol versions shared across the app.
 *
 * ROLE IN PROJECT:
 *    Provides stable version identifiers for persisted records and wire
 *    contracts so future changes can be introduced deliberately.
 *
 * KEY COMPONENTS:
 *    - CONTRACT_VERSIONS: Initial API, stream, record, and graph versions.
 *    - schemaVersionSchema: Zod validation for version-one records.
 * ============================================================================
 */

import { z } from 'zod';

export const CONTRACT_VERSIONS = {
  api: 1,
  stream: 1,
  session: 1,
  message: 1,
  agentMemory: 1,
  attempt: 1,
  metadata: 1,
  graphSchema: 'phase1.v1',
} as const;

export const schemaVersionSchema = z.literal(1);
