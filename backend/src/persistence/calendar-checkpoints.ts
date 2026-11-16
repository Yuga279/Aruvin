/**
 * ============================================================================
 * FILE: calendar-checkpoints.ts
 * LOCATION: backend/src/persistence/calendar-checkpoints.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validation walker to ensure LangGraph checkpoints do not leak calendar tokens or content.
 *
 * ROLE IN PROJECT:
 *    Enforces safety invariants on checkpoint graph state, admitting only
 *    bounded, scoped v1 and v2 calendar reference pointers.
 *
 * KEY COMPONENTS:
 *    - calendarCheckpointRefsSchema: Re-exported v1 references schema.
 *    - calendarCheckpointRefsV2Schema: Exported v2 multi-calendar references schema.
 *    - assertCalendarCheckpointSafe: Deep validation traversal blocking forbidden keys.
 * ============================================================================
 */

import {
  calendarCheckpointRefsV1Schema as calendarCheckpointRefsSchema,
  calendarCheckpointRefsV2Schema,
  compatibleCalendarCheckpointRefsSchema,
  compatibleSkillCheckpointRefsSchema,
} from '../contracts/calendar-compatibility.js';
import { AppError } from '../platform/errors/app-error.js';

export {
  calendarCheckpointRefsSchema,
  calendarCheckpointRefsV2Schema,
  compatibleCalendarCheckpointRefsSchema,
  compatibleSkillCheckpointRefsSchema,
};

const blockedKeys = new Set([
  'credentials', 'accessToken', 'refreshToken', 'encryptedVerifier', 'tool_calls', 'tool_call_id',
]);

export function assertCalendarCheckpointSafe(
  value: unknown,
  scope: { userId: string; sessionId: string },
): void {
  walk(value, scope, 0, 0);
}

function isCalendarRefsPayload(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function assertScopedCalendarRefs(
  value: unknown,
  scope: { userId: string; sessionId: string },
): void {
  const parsed = compatibleSkillCheckpointRefsSchema.safeParse(value);
  if (!parsed.success || parsed.data.userId !== scope.userId || parsed.data.sessionId !== scope.sessionId) {
    throw new AppError('INVALID_REQUEST', 'Invalid graph persistence scope.');
  }
}

function walk(value: unknown, scope: { userId: string; sessionId: string }, depth: number, nodes: number): number {
  if (nodes > 4000 || depth > 12) throw new AppError('INVALID_REQUEST', 'Invalid graph persistence scope.');
  if (value == null || typeof value !== 'object') return nodes + 1;
  if (Array.isArray(value)) {
    if (value[0] === 'calendarRefs' && isCalendarRefsPayload(value[1])) {
      assertScopedCalendarRefs(value[1], scope);
    }
    return value.reduce((count, item) => walk(item, scope, depth + 1, count), nodes + 1);
  }
  const record = value as Record<string, unknown>;
  if (isCalendarRefsPayload(record.calendarRefs)) {
    assertScopedCalendarRefs(record.calendarRefs, scope);
  }
  for (const [key, child] of Object.entries(record)) {
    if (blockedKeys.has(key)) throw new AppError('INVALID_REQUEST', 'Invalid graph persistence scope.');
    nodes = walk(child, scope, depth + 1, nodes + 1);
  }
  return nodes;
}
