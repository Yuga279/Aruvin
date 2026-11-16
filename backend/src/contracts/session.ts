/**
 * ============================================================================
 * FILE: session.ts
 * LOCATION: backend/src/contracts/session.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define bounded session metadata and execution-lease fields.
 *
 * ROLE IN PROJECT:
 *    Models one navigation/lifecycle document per chat without embedding
 *    transcript messages or accumulated message and attempt identifiers.
 *
 * KEY COMPONENTS:
 *    - executionLeaseSchema: Current ownership and fencing metadata.
 *    - sessionRecordSchema: Strict versioned session metadata record.
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { schemaVersionSchema } from './versions.js';

export const executionLeaseSchema = z
  .object({
    ownerId: idSchema.nullable(),
    leaseExpiresAt: isoDateSchema.nullable(),
    activeAttemptId: idSchema.nullable(),
    generation: sequenceSchema,
  })
  .strict();

export const sessionRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    userId: idSchema,
    sessionId: idSchema,
    title: z.string().min(1).max(80),
    pinned: z.boolean().optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    lastActivityAt: isoDateSchema,
    lifecycle: z.enum(['active', 'archived']),
    graphThreadId: idSchema,
    execution: executionLeaseSchema,
    latestTurnId: idSchema.nullable(),
    memoryPublication: z.object({ version: sequenceSchema, sequence: sequenceSchema,
      epoch: idSchema, fence: sequenceSchema }).strict().optional(),
  })
  .strict();

export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type ExecutionLeaseFields = z.infer<typeof executionLeaseSchema>;
