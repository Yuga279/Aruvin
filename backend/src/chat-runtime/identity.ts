/**
 * ============================================================================
 * FILE: identity.ts
 * LOCATION: backend/src/chat-runtime/identity.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Derive deterministic scoped session, turn, attempt, message, and event IDs.
 *
 * ROLE IN PROJECT:
 *    Gives P5 a stable identity recipe so new chats, retries, and stream paths
 *    stay idempotent without hashing user content into request identity.
 *
 * KEY COMPONENTS:
 *    - sessionIdFor/attemptIdFor/turnIdFor: Scoped hashed or existing IDs.
 *    - inputId/outputId/eventIdFor: Durable message and event identities.
 *    - titleFor/responseFor: Bounded titles and P1 acceptance responses.
 * ============================================================================
 */

import { key } from '../persistence/records.js';
import { API_ROUTES, type SubmitTurnResponse } from '../contracts/api.js';
import type { AttemptRecord } from '../contracts/attempt.js';
export const sessionIdFor = (u: string, s: string | null, k: string) => s ?? key('new-session', u, k);
export const attemptIdFor = (u: string, s: string, k: string) => key('attempt-id', u, s, k);
export const turnIdFor = (u: string, s: string, k: string) => key('turn', u, s, k);
export const inputId = (u: string, s: string, a: string) => key('input', u, s, a);
export const outputId = (a: AttemptRecord) => key('output', a.userId, a.sessionId, a.attemptId);
export const eventIdFor = (u: string, s: string, id: string) => key('event', u, s, id);
export function titleFor(content: string, maximum: number): string {
  const text = content.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim() || 'New chat';
  let out = '';
  for (const point of text) { if (out.length + point.length > Math.min(maximum, 80)) break; out += point; }
  return out || 'Chat'.slice(0, Math.min(maximum, 80));
}
export function responseFor(a: AttemptRecord): SubmitTurnResponse {
  return { sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId,
    userMessageId: a.causal.userMessageId, streamPath: API_ROUTES.turnStream(a.sessionId, a.turnId) };
}
