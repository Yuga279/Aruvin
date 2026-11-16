/**
 * ============================================================================
 * FILE: accounting-reporting.ts
 * LOCATION: backend/src/contracts/accounting-reporting.ts
 * PURPOSE: Define bounded internal, read-only usage reports without HTTP exposure.
 * ROLE IN PROJECT: Supports UTC accounting queries through the persistence boundary.
 * KEY COMPONENTS: Range/page validation, totals and distinct counting semantics.
 * ============================================================================
 */
import { z } from 'zod';
import { idSchema } from './identifiers.js';
export const MAX_ACCOUNTING_RANGE_MS = 31 * 86_400_000;
export const MAX_ACCOUNTING_REPORT_RECORDS = 10_000;
const utc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
export const accountingQuerySchema = z.object({ start: utc, end: utc, userId: idSchema.optional(),
  byUser: z.boolean().optional(), limit: z.number().int().positive().max(50),
  cursor: z.string().min(1).max(2048).nullable().optional(),
}).strict().refine(v => Date.parse(v.end) > Date.parse(v.start)
  && Date.parse(v.end) - Date.parse(v.start) <= MAX_ACCOUNTING_RANGE_MS);
export type AccountingQuery = z.infer<typeof accountingQuerySchema>;
export type AccountingTotals = {
  userId: string | null; currency: 'USD'; unit: 'text-tokens' | 'voice-audio' | 'voice-characters';
  reportedTotal: string | null; estimatedTotal: string | null; spendComplete: boolean;
  requestCount: number; executionAttemptCount: number; operationCount: number; billableOperationCount: number;
  knownCostCount: number; pendingCostCount: number; unknownCostCount: number; estimatedCostCount: number;
  tokenCompleteCount: number; tokenIncompleteCount: number; promptTokens: number; completionTokens: number;
  cachedPromptTokens: number; cacheWriteTokens: number; reasoningOutputTokens: number;
  breakdownIncompleteCount: number; observedAudioMs: number; billableCharacters: number;
  voiceUnitsIncompleteCount: number; dispatchCount: number; dispatchIncompleteCount: number;
  unobservedDispatchBillingCount: number;
  failedCount: number; cancelledCount: number; interruptedCount: number; truncatedCount: number;
};
