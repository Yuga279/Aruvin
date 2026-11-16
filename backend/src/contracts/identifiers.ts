/**
 * ============================================================================
 * FILE: identifiers.ts
 * LOCATION: backend/src/contracts/identifiers.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide shared bounded schemas for IDs, datetimes, and ordered sequences.
 *
 * ROLE IN PROJECT:
 *    Keeps persisted and protocol identities consistently validated across
 *    independent backend modules.
 *
 * KEY COMPONENTS:
 *    - idSchema: Non-empty identifiers capped at 128 characters.
 *    - isoDateSchema / sequenceSchema: Time and event-order primitives.
 * ============================================================================
 */

import { z } from 'zod';

export const ID_MAX_LENGTH = 128;

export const idSchema = z.string().min(1).max(ID_MAX_LENGTH);

export const isoDateSchema = z.string().min(1).refine(
  (value) => !Number.isNaN(Date.parse(value)),
  {
    message: 'expected ISO-8601 datetime',
  },
);

export const sequenceSchema = z.number().int().nonnegative();
