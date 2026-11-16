/**
 * ============================================================================
 * FILE: metadata.ts
 * LOCATION: backend/src/contracts/metadata.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define bounded accounting and future tool-shaped event metadata records.
 *
 * ROLE IN PROJECT:
 *    Supports reliable attempt accounting and causal context selection while
 *    keeping tool execution outside Phase 1.
 *
 * KEY COMPONENTS:
 *    - Accounting schemas: Preserve unknown provider usage as null/unknown.
 *    - Tool schemas: Store bounded request/result references with causal IDs.
 *    - reconstructToolGroups: Pair results only with their originating request.
 * ============================================================================
 */

import { z } from 'zod';
import { attemptStatusSchema } from './attempt.js';
import { DEFAULT_BUDGETS } from './budgets.js';
import { idSchema, isoDateSchema, sequenceSchema } from './identifiers.js';
import { schemaVersionSchema } from './versions.js';
import { compatibleAmount, moneyEvidenceSchema, timingEvidenceSchema, usageCountSchema } from './usage-evidence.js';

export const ACCOUNTING_STATUSES = ['known', 'pending', 'unknown'] as const;
export const accountingStatusSchema = z.enum(ACCOUNTING_STATUSES);
export type AccountingStatus = z.infer<typeof accountingStatusSchema>;

export const accountingRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    kind: z.literal('accounting'),
    userId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    generationId: z.string().min(1).max(200).nullable(),
    requestedModel: z.string().min(1).max(200),
    reportedModel: z.string().min(1).max(200).nullable(),
    reportedProvider: z.string().min(1).max(200).nullable(),
    promptTokens: usageCountSchema,
    completionTokens: usageCountSchema,
    cost: z.number().finite().nonnegative().nullable(),
    money: moneyEvidenceSchema.optional(),
    cachedPromptTokens: usageCountSchema.optional(),
    cacheWriteTokens: usageCountSchema.optional(),
    reasoningOutputTokens: usageCountSchema.optional(),
    timing: timingEvidenceSchema.optional(),
    accountingStatus: accountingStatusSchema,
    outcome: attemptStatusSchema,
    startedAt: isoDateSchema,
    endedAt: isoDateSchema.nullable(),
  })
  .strict().superRefine((v, ctx) => {
    if (v.money && (!compatibleAmount(v.cost, v.money.reportedAmount) || v.money.estimatedAmount !== null))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Conflicting text cost evidence.' });
  });

export type AccountingRecord = z.infer<typeof accountingRecordSchema>;

const boundedJson = z.string().max(DEFAULT_BUDGETS.maxManifestBytes);

export const toolRequestRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    kind: z.literal('tool-request'),
    userId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    eventId: idSchema,
    sequence: sequenceSchema,
    originatingAssistantEventId: idSchema,
    toolCallId: z.string().min(1).max(128),
    toolName: z.string().min(1).max(64),
    argumentsJson: boundedJson,
    createdAt: isoDateSchema,
  })
  .strict();

export const toolResultRefSchema = z.discriminatedUnion('storage', [
  z.object({ storage: z.literal('inline'), json: boundedJson }).strict(),
  z
    .object({ storage: z.literal('external'), uri: z.string().min(1).max(500) })
    .strict(),
]);

export const toolResultRecordSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    kind: z.literal('tool-result'),
    userId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    attemptId: idSchema,
    eventId: idSchema,
    sequence: sequenceSchema,
    originatingToolRequestEventId: idSchema,
    toolCallId: z.string().min(1).max(128),
    outcome: z.enum(['ok', 'error']),
    resultRef: toolResultRefSchema,
    createdAt: isoDateSchema,
  })
  .strict();

export type ToolRequestRecord = z.infer<typeof toolRequestRecordSchema>;
export type ToolResultRecord = z.infer<typeof toolResultRecordSchema>;

export type ToolGroup = {
  toolCallId: string;
  request: ToolRequestRecord;
  result: ToolResultRecord | null;
};

export function reconstructToolGroups(
  requests: readonly ToolRequestRecord[],
  results: readonly ToolResultRecord[],
): Map<string, ToolGroup> {
  const groups = new Map<string, ToolGroup>();
  const requestsByEventId = new Map<string, ToolGroup>();

  for (const request of requests) {
    const group: ToolGroup = {
      toolCallId: request.toolCallId,
      request,
      result: null,
    };
    groups.set(request.toolCallId, group);
    requestsByEventId.set(request.eventId, group);
  }

  for (const result of results) {
    const group = requestsByEventId.get(result.originatingToolRequestEventId);
    if (
      group &&
      group.result === null &&
      group.toolCallId === result.toolCallId &&
      group.request.userId === result.userId &&
      group.request.sessionId === result.sessionId &&
      group.request.turnId === result.turnId &&
      group.request.attemptId === result.attemptId &&
      result.sequence > group.request.sequence
    ) {
      group.result = result;
    }
  }

  return groups;
}
