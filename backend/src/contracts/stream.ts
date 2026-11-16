/**
 * ============================================================================
 * FILE: stream.ts
 * LOCATION: backend/src/contracts/stream.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define the versioned, client-safe application stream protocol.
 *
 * ROLE IN PROJECT:
 *    Provides strict SSE event envelopes for the backend and frontend while
 *    withholding provider internals, checkpoints, credentials, and reasoning.
 *
 * KEY COMPONENTS:
 *    - streamEnvelopeSchema: Validates stable turn-scoped protocol events.
 *    - encodeSseFrame / parseSseDataLine: Encode and validate SSE data frames.
 * ============================================================================
 */

import { z } from 'zod';
import { attemptStatusSchema } from './attempt.js';
import { appErrorCodeSchema } from './errors.js';
import { idSchema, sequenceSchema } from './identifiers.js';
import { accountingStatusSchema } from './metadata.js';
import { calendarViewSchema } from './calendar-view.js';
import { CONTRACT_VERSIONS } from './versions.js';

export const STREAM_PROTOCOL_VERSION = CONTRACT_VERSIONS.stream;
export const saveStateSnapshotSchema = z.object({
  state: z.enum(['pending', 'saving', 'saved', 'failed', 'unknown', 'fenced']),
  epoch: idSchema, version: z.number().int().nonnegative().safe(),
  durableVersion: z.number().int().nonnegative().safe(),
}).strict();

export const turnAcceptedEventSchema = z
  .object({
    type: z.literal('turn-accepted'),
    userMessageId: idSchema,
  })
  .strict();

export const deltaEventSchema = z
  .object({
    type: z.literal('delta'),
    text: z.string().min(1),
    reset: z.literal(true).optional(),
  })
  .strict();

export const statusEventSchema = z
  .object({
    type: z.literal('status'),
    status: attemptStatusSchema,
    truncated: z.boolean(),
    save: saveStateSnapshotSchema.optional(),
  })
  .strict();

export const usageEventSchema = z
  .object({
    type: z.literal('usage'),
    accountingStatus: accountingStatusSchema,
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    cost: z.number().nonnegative().nullable(),
  })
  .strict();

export const errorEventSchema = z
  .object({
    type: z.literal('error'),
    code: appErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();

export const completedEventSchema = z
  .object({
    type: z.literal('completed'),
    assistantMessageId: idSchema,
    outcome: z.enum(['completed', 'truncated']),
    save: saveStateSnapshotSchema.optional(),
    calendarView: calendarViewSchema.optional(),
  })
  .strict();

export const streamEventSchema = z.discriminatedUnion('type', [
  turnAcceptedEventSchema,
  deltaEventSchema,
  statusEventSchema,
  usageEventSchema,
  errorEventSchema,
  completedEventSchema,
]);

export const streamEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(STREAM_PROTOCOL_VERSION),
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    sequence: sequenceSchema,
    event: streamEventSchema,
  })
  .strict();

export type StreamEvent = z.infer<typeof streamEventSchema>;
export type StreamEnvelope = z.infer<typeof streamEnvelopeSchema>;

export function encodeSseFrame(envelope: StreamEnvelope): string {
  return `data: ${JSON.stringify(envelope)}\n\n`;
}

export function parseSseDataLine(line: string): StreamEnvelope {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) {
    throw new Error('invalid_sse_line');
  }
  const json = trimmed.slice('data:'.length).trim();
  return streamEnvelopeSchema.parse(JSON.parse(json));
}
