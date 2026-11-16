/**
 * ============================================================================
 * FILE: budgets.ts
 * LOCATION: backend/src/contracts/budgets.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define finite default limits and validate runtime budget configuration.
 *
 * ROLE IN PROJECT:
 *    Centralizes resource ceilings shared by contracts and platform config,
 *    including reserved model-output and storage headroom.
 *
 * KEY COMPONENTS:
 *    - budgetConfigSchema: Validates positive limits and cross-field constraints.
 *    - DEFAULT_BUDGETS: Conservative Phase 1 default budget values.
 *    - usableHistoryTokens: Calculates remaining context capacity for history.
 * ============================================================================
 */

import { z } from 'zod';
import { CONSERVATIVE_DOCUMENT_HEADROOM_BYTES } from './persistence-profile.js';

export const budgetConfigObjectSchema = z
  .object({
    maxInputChars: z.number().int().positive(),
    maxInputTokens: z.number().int().positive(),
    maxMessagesInContext: z.number().int().positive(),
    maxContextTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    modelMarginTokens: z.number().int().positive(),
    maxMessageBytes: z.number().int().positive(),
    maxDocumentBytes: z.number().int().positive(),
    maxManifestBytes: z.number().int().positive(),
    maxPageSize: z.number().int().positive().max(50),
    defaultPageSize: z.number().int().positive(),
    titleMaxChars: z.number().int().positive(),
    maxConcurrentAttemptsPerSession: z.literal(1),
    maxConcurrentGenerationsPerProcess: z.number().int().positive(),
    maxRequestsPerMinutePerUser: z.number().int().positive(),
    retryMaxAttempts: z.number().int().positive().max(3),
    retryBaseDelayMs: z.number().int().positive(),
    retryMaxDelayMs: z.number().int().positive(),
    connectTimeoutMs: z.number().int().positive(),
    firstOutputTimeoutMs: z.number().int().positive(),
    idleStreamTimeoutMs: z.number().int().positive(),
    totalRunTimeoutMs: z.number().int().positive(),
    persistenceTimeoutMs: z.number().int().positive(),
    shutdownDrainMs: z.number().int().positive(),
  })
  .strict();

export const budgetConfigSchema = budgetConfigObjectSchema.superRefine(
  (budgets, ctx) => {
    if (budgets.defaultPageSize > budgets.maxPageSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'defaultPageSize cannot exceed maxPageSize',
        path: ['defaultPageSize'],
      });
    }
    if (usableHistoryTokens(budgets) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'maxContextTokens must leave room for maxOutputTokens and modelMarginTokens',
        path: ['maxContextTokens'],
      });
    }
    if (budgets.retryMaxDelayMs < budgets.retryBaseDelayMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'retryMaxDelayMs must be >= retryBaseDelayMs',
        path: ['retryMaxDelayMs'],
      });
    }
  },
);

export type BudgetConfig = z.infer<typeof budgetConfigSchema>;

export const DEFAULT_BUDGETS: BudgetConfig = {
  maxInputChars: 32_000,
  maxInputTokens: 8_192,
  maxMessagesInContext: 80,
  maxContextTokens: 16_384,
  maxOutputTokens: 2_048,
  modelMarginTokens: 1_024,
  maxMessageBytes: 65_536,
  maxDocumentBytes: CONSERVATIVE_DOCUMENT_HEADROOM_BYTES,
  maxManifestBytes: 131_072,
  maxPageSize: 50,
  defaultPageSize: 20,
  titleMaxChars: 80,
  maxConcurrentAttemptsPerSession: 1,
  maxConcurrentGenerationsPerProcess: 8,
  maxRequestsPerMinutePerUser: 20,
  retryMaxAttempts: 2,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 5_000,
  connectTimeoutMs: 10_000,
  firstOutputTimeoutMs: 30_000,
  idleStreamTimeoutMs: 20_000,
  totalRunTimeoutMs: 180_000,
  persistenceTimeoutMs: 15_000,
  shutdownDrainMs: 20_000,
};

export function usableHistoryTokens(budgets: BudgetConfig): number {
  return (
    budgets.maxContextTokens -
    budgets.maxOutputTokens -
    budgets.modelMarginTokens
  );
}
