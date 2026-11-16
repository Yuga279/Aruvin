/**
 * ============================================================================
 * FILE: validation.ts
 * LOCATION: backend/src/http/validation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Parse and bound chat HTTP bodies, path identifiers, and page queries.
 *
 * ROLE IN PROJECT:
 *    Enforces strict P1 schemas, server identity, and numerical/UTF-8 limits
 *    before any runtime command or repository read is delegated.
 *
 * KEY COMPONENTS:
 *    - parseBody: Strict schema parse with identity and empty-content checks.
 *    - pageQuery / pathId / noQuery: Scalar pagination and path-safe IDs.
 *    - inputBounds: Pre-schema UTF-8 and character ceilings for 413 mapping.
 * ============================================================================
 */

import { z } from 'zod';
import { pageRequestSchema } from '../contracts/api.js';
import { idSchema } from '../contracts/identifiers.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { ChatHttpOptions } from './options.js';
import { AppError } from '../platform/errors/app-error.js';
export function parseBody<S extends z.ZodTypeAny>(schema: S, raw: unknown, identity: ChatHttpOptions['identity']): z.infer<S> {
  identity.assertNoClientOverrides(raw);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppError(parsed.error.issues.some(i => i.code === 'unrecognized_keys')
    ? 'UNKNOWN_FIELD' : 'INVALID_REQUEST', 'Invalid request.');
  const data = parsed.data as z.infer<S>;
  if (data && typeof data === 'object' && 'content' in data && typeof data.content === 'string' && !data.content.trim())
    throw new AppError('INVALID_REQUEST', 'Empty message.');
  return data;
}
export function pathId(value: unknown): string {
  const id = idSchema.parse(value);
  if (/[\s/\\?#\u0000-\u001f\u007f]/u.test(id)) throw new AppError('INVALID_REQUEST', 'Invalid identifier.');
  return id;
}
export function noQuery(query: unknown): void { z.object({}).strict().parse(query); }
export function pageQuery(raw: unknown, budgets: BudgetConfig) {
  const query = z.object({ cursor: z.string().min(1).max(2048).optional(),
    limit: z.string().regex(/^[1-9]\d{0,2}$/u).optional() }).strict().parse(raw);
  const page = pageRequestSchema.parse({ cursor: query.cursor ?? null,
    limit: query.limit === undefined ? budgets.defaultPageSize : Number(query.limit) });
  if (page.limit > budgets.maxPageSize) throw new AppError('INVALID_REQUEST', 'Invalid page size.');
  return page;
}
export function inputBounds(content: string, budgets: BudgetConfig): void {
  if (content.length > Math.min(budgets.maxInputChars, 32000) || Buffer.byteLength(content, 'utf8') > budgets.maxMessageBytes)
    throw new AppError('INPUT_TOO_LARGE', 'Input limit exceeded.');
}
