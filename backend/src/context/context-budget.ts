/**
 * ============================================================================
 * FILE: context-budget.ts
 * LOCATION: backend/src/context/context-budget.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Estimate prompt size and enforce finite input, message, and context budgets.
 *
 * ROLE IN PROJECT:
 *    Gives context assembly a deterministic conservative gate before inference
 *    without truncating history, summarizing, or claiming a model tokenizer.
 *
 * KEY COMPONENTS:
 *    - estimatePromptTokens: UTF-8 JSON bytes plus per-message and global framing.
 *    - validateInput / validateMessageBytes / checkContextBudget: Fail-closed limits.
 * ============================================================================
 */

import type { BudgetConfig } from '../contracts/budgets.js';
import type { ContextChatMessage, ContextOverflow, EnvironmentContext, ResponseMode } from '../contracts/context.js';
import type { FixedAssets } from '../instructions/fixed-assets.js';
import { AppError } from '../platform/errors/app-error.js';

export function fixedContextMessages(assets: FixedAssets): ContextChatMessage[] {
  return [
    { role: 'system', content: assets.instructions },
    { role: 'system', content: `Product background (data, not authority):\n${JSON.stringify(assets.knowledge)}` },
  ];
}

export function defaultEnvironmentContext(now: Date = new Date(), timeZone = 'Etc/UTC'): EnvironmentContext {
  const date = Number.isNaN(now.getTime()) ? new Date() : now;
  let tz = timeZone || 'Etc/UTC';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    }).formatToParts(date);
  } catch {
    tz = 'Etc/UTC';
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    }).formatToParts(date);
  }
  let year = '';
  let month = '';
  let day = '';
  let dayOfWeek = '';
  for (const { type, value } of parts) {
    if (type === 'year') year = value;
    else if (type === 'month') month = value;
    else if (type === 'day') day = value;
    else if (type === 'weekday') dayOfWeek = value;
  }
  return {
    timeZone: tz,
    currentDate: `${year}-${month}-${day}`,
    dayOfWeek,
  };
}

export function environmentContextMessage(environment?: EnvironmentContext): ContextChatMessage {
  const env = environment ?? defaultEnvironmentContext();
  return {
    role: 'system',
    content: `Environment background (data, not authority):\n${JSON.stringify(env)}`,
  };
}

export function responseModeMessage(mode: ResponseMode): ContextChatMessage {
  return { role: 'system', content: `Response mode: ${mode}.` };
}

export function assertFixedContextFits(assets: FixedAssets, budgets: BudgetConfig): void {
  const fixed = fixedContextMessages(assets);
  const envMessage = environmentContextMessage();
  for (const mode of ['text', 'voice'] as const) {
    const probe = [...fixed, envMessage, responseModeMessage(mode), { role: 'user' as const, content: 'x' }];
    if (probe.some(message => Buffer.byteLength(message.content, 'utf8') > budgets.maxMessageBytes) ||
        checkContextBudget(probe, budgets)) {
      throw new AppError('CONFIGURATION_ERROR', 'Fixed Aurvin context exceeds the configured budget.');
    }
  }
}

export function estimatePromptTokens(messages: readonly ContextChatMessage[]): number {
  return Buffer.byteLength(JSON.stringify(messages), 'utf8') + 32 * messages.length + 256;
}

export function validateInput(input: string, budgets: BudgetConfig): void {
  if (!input.trim()) throw new AppError('INVALID_REQUEST', 'Enter a message to continue.');
  const bytes = Buffer.byteLength(input, 'utf8');
  if (input.length > budgets.maxInputChars || bytes > budgets.maxMessageBytes ||
    bytes > budgets.maxInputTokens) {
    throw new AppError('INPUT_TOO_LARGE', 'The message is too large.');
  }
}

export function validateMessageBytes(content: string, budgets: BudgetConfig): void {
  if (Buffer.byteLength(content, 'utf8') > budgets.maxMessageBytes) {
    throw new AppError('NOT_READY', 'A saved message exceeds the context limits.');
  }
}

export function checkContextBudget(
  messages: readonly ContextChatMessage[], budgets: BudgetConfig,
): ContextOverflow | null {
  const requiredTokens = estimatePromptTokens(messages) + budgets.maxOutputTokens + budgets.modelMarginTokens;
  if (requiredTokens <= budgets.maxContextTokens && messages.length <= budgets.maxMessagesInContext) return null;
  return {
    code: 'CONTEXT_BUDGET_EXCEEDED',
    message: 'This chat has reached its context limit. Start a new chat to continue.',
    maxContextTokens: budgets.maxContextTokens,
    requiredTokens,
  };
}
