/**
 * ============================================================================
 * FILE: agent-memory.ts
 * LOCATION: backend/src/contracts/agent-memory.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define bounded memory manifests that reference original message records.
 *
 * ROLE IN PROJECT:
 *    Separates selected agent context from the durable UI archive without
 *    copying transcript content into an ever-growing manifest document.
 *
 * KEY COMPONENTS:
 *    - Reference schemas: Bound message and source-range linkage.
 *    - agentMemoryManifestSchema: Versioned context selection manifest.
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema, sequenceSchema } from './identifiers.js';
import { schemaVersionSchema } from './versions.js';

export const sourceRangeSchema = z
  .object({
    fromSequence: sequenceSchema,
    toSequence: sequenceSchema,
    fromEventId: idSchema,
    toEventId: idSchema,
  })
  .strict();

export const messageRefSchema = z
  .object({
    messageId: idSchema,
    eventId: idSchema,
    sequence: sequenceSchema,
  })
  .strict();

export const summaryRefSchema = z
  .object({
    summaryId: idSchema,
    sourceRange: sourceRangeSchema,
  })
  .strict();

export const agentMemoryManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    userId: idSchema,
    sessionId: idSchema,
    contextVersion: sequenceSchema,
    sourceRanges: z.array(sourceRangeSchema).max(64),
    messageRefs: z.array(messageRefSchema).max(500),
    activeSummaryRef: summaryRefSchema.nullable(),
    instructionVersion: z.string().min(1).max(64),
    knowledgeContentHash: z.string().min(1).max(128),
    graphSchemaVersion: z.string().min(1).max(64),
  })
  .strict();

export type AgentMemoryManifest = z.infer<typeof agentMemoryManifestSchema>;
export type SourceRange = z.infer<typeof sourceRangeSchema>;
export type MessageRef = z.infer<typeof messageRefSchema>;
