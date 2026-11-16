/**
 * ============================================================================
 * FILE: attempt.ts
 * LOCATION: backend/src/contracts/attempt.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define the versioned lifecycle record for one model-generation attempt.
 *
 * ROLE IN PROJECT:
 *    Tracks accepted input, idempotency, model attribution, truncation, and
 *    causal linkage without storing private model reasoning.
 *
 * KEY COMPONENTS:
 *    - attemptStatusSchema: Accepted through terminal lifecycle values.
 *    - attemptRecordSchema: Strict durable attempt/accounting metadata shape.
 * ============================================================================
 */

import { z } from 'zod';
import { appErrorCodeSchema } from './errors.js';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { schemaVersionSchema } from './versions.js';
import { calendarReplyReferenceSchema } from './calendar-authority.js';

export const ATTEMPT_STATUSES = [
  'accepted',
  'generating',
  'finalizing',
  'completed',
  'truncated',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const attemptRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    kind: z.literal('attempt'),
    userId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    idempotencyKey: z.string().min(8).max(128),
    payloadHash: z.string().length(64),
    // Undefined is legacy storage; null means this accepted request had no reference.
    calendarReplyTo: calendarReplyReferenceSchema.nullable().optional(),
    // Publication dependency, never an authorization or model-dispatch receipt.
    nativePublication: z.object({ epoch: idSchema, version: sequenceSchema, fence: sequenceSchema,
      contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
    status: attemptStatusSchema,
    sequence: sequenceSchema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    instructionVersion: z.string().min(1).max(64),
    knowledgeContentHash: z.string().min(1).max(128),
    graphSchemaVersion: z.string().min(1).max(64),
    contextVersion: sequenceSchema,
    modelId: z.string().min(1).max(200),
    openRouterUser: idSchema,
    generationId: z.string().min(1).max(200).nullable(),
    truncated: z.boolean(),
    errorCode: appErrorCodeSchema.nullable(),
    causal: z
      .object({
        userMessageId: idSchema,
        previousAttemptId: idSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export type AttemptRecord = z.infer<typeof attemptRecordSchema>;
