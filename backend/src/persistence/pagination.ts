/**
 * ============================================================================
 * FILE: pagination.ts
 * LOCATION: backend/src/persistence/pagination.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Encode and decode scoped, bounded keyset cursors for archive pages.
 *
 * ROLE IN PROJECT:
 *    Prevents cross-user or cross-collection cursor reuse and keeps page sizes
 *    inside configured budgets for sessions, messages, and attempts.
 *
 * KEY COMPONENTS:
 *    - cursor: Version-1 base64url encoding of kind, scope, and order keys.
 *    - page: Strict request validation with scope-bound cursor decoding.
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema } from '../contracts/identifiers.js';
import type { PageQuery } from '../contracts/repositories.js';
import { AppError } from '../platform/errors/app-error.js';

const cursorSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(['sessions', 'messages', 'attempts']),
    userId: idSchema,
    sessionId: z.string().max(128),
    value: z.union([
      z.string().max(64),
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ]),
    id: idSchema,
    pinned: z.boolean().optional(),
  })
  .strict();

type Cursor = z.infer<typeof cursorSchema>;

export function cursor(input: Omit<Cursor, 'v'>): string {
  return Buffer.from(JSON.stringify(cursorSchema.parse({ ...input, v: 1 }))).toString(
    'base64url',
  );
}

export function page(
  query: PageQuery,
  kind: Cursor['kind'],
  userId: string,
  sessionId: string,
  max: number,
): { limit: number; after: Cursor | null } {
  idSchema.parse(userId);
  if (kind !== 'sessions') {
    idSchema.parse(sessionId);
  }
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > Math.min(max, 50)
  ) {
    throw new AppError('INVALID_REQUEST', 'Invalid page size.');
  }
  if (!query.cursor) {
    return { limit: query.limit, after: null };
  }
  try {
    if (query.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) {
      throw new Error('cursor');
    }
    const after = cursorSchema.parse(
      JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
    );
    if (
      after.kind !== kind ||
      after.userId !== userId ||
      after.sessionId !== sessionId
    ) {
      throw new Error('scope');
    }
    if (
      kind === 'sessions'
        ? typeof after.value !== 'string' ||
          new Date(after.value).toISOString() !== after.value
        : typeof after.value !== 'number'
    ) {
      throw new Error('order');
    }
    return { limit: query.limit, after };
  } catch {
    throw new AppError('INVALID_REQUEST', 'Invalid page cursor.');
  }
}
