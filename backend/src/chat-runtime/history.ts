/**
 * ============================================================================
 * FILE: history.ts
 * LOCATION: backend/src/chat-runtime/history.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Read complete bounded archives and discover latest-turn attempts.
 *
 * ROLE IN PROJECT:
 *    Prevents newest-page context selection by paging the full session archive
 *    and reconstructing accepted history from markers and terminal attempts.
 *
 * KEY COMPONENTS:
 *    - attemptsFor/archiveRecords: Bounded full-collection page walks.
 *    - acceptedHistory: Marker-confirmed users and non-truncated assistants.
 *    - latestAttempt: Current attempt for a logical turn.
 * ============================================================================
 */

import type { PersistenceBundle } from '../persistence/persistence.js';
import type { MessageRecord } from '../contracts/message.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import { eligible } from '../context/reference-selection.js';
import { AppError } from '../platform/errors/app-error.js';
export async function attemptsFor(p: PersistenceBundle, u: string, s: string): Promise<AttemptRecord[]> {
  let cursor: string | null = null;
  const out: AttemptRecord[] = [];
  for (let page = 0; page < 100; page++) {
    const found = await p.metadata.listAttempts(u, s, { cursor, limit: p.metadata.budgets.maxPageSize });
    out.push(...found.items); cursor = found.nextCursor;
    if (!cursor) return out.sort((a, b) => b.sequence - a.sequence);
  }
  throw new AppError('STORAGE_BUDGET_EXCEEDED', 'This chat has reached its record limit. Start a new chat.');
}
export async function archiveRecords(p: PersistenceBundle, u: string, s: string): Promise<MessageRecord[]> {
  let cursor: string | null = null;
  const out: MessageRecord[] = [];
  for (let page = 0; page < 100; page++) {
    const found = await p.messages.listForContext(u, s, { cursor, limit: p.messages.budgets.maxPageSize });
    out.push(...found.items);
    cursor = found.nextCursor;
    if (!cursor) return out.sort((a, b) => a.sequence - b.sequence);
  }
  throw new AppError('STORAGE_BUDGET_EXCEEDED', 'This chat has reached its record limit. Start a new chat.');
}
export async function acceptedHistory(p: PersistenceBundle, u: string, s: string): Promise<MessageRecord[]> {
  const [attemptsResult, archiveResult] = await Promise.allSettled([
    attemptsFor(p, u, s),
    archiveRecords(p, u, s),
  ]);
  if (attemptsResult.status === 'rejected') throw attemptsResult.reason;
  if (archiveResult.status === 'rejected') throw archiveResult.reason;
  const attempts = attemptsResult.value;
  const rawRecords = archiveResult.value;

  const accepted = new Set<string>();
  const completed = new Set<string>();
  const terminalLive = new Set<string>();
  const markers = new Map<string, Awaited<ReturnType<typeof p.metadata.getAcceptance>>>();
  const bulk = typeof p.metadata.getAcceptances === 'function';
  if (bulk) {
    for (let i = 0; i < attempts.length; i += 500) {
      for (const marker of await p.metadata.getAcceptances(u, s, attempts.slice(i, i + 500).map(a => a.attemptId)))
        markers.set(marker.attemptId, marker);
    }
  }
  for (const a of attempts) {
    const marker = bulk ? markers.get(a.attemptId) : await p.metadata.getAcceptance(u, s, a.attemptId);
    if (marker && marker.turnId === a.turnId && marker.userMessageId === a.causal.userMessageId && marker.payloadHash === a.payloadHash)
      accepted.add(marker.userMessageId);
    if (a.status === 'completed' && !a.truncated) completed.add(a.attemptId);
    if (['completed', 'truncated', 'cancelled', 'interrupted', 'failed'].includes(a.status)) terminalLive.add(a.attemptId);
  }
  return rawRecords.filter(m => eligible(m) && (m.role === 'user' ? accepted.has(m.messageId)
    : m.visibility === 'internal' && m.mode === 'live' ? terminalLive.has(m.attemptId!) : completed.has(m.attemptId!)));
}
export async function latestAttempt(p: PersistenceBundle, u: string, s: string, t: string): Promise<AttemptRecord> {
  const a = typeof p.metadata.latestAttempt === 'function' ? await p.metadata.latestAttempt(u, s, t)
    : (await attemptsFor(p, u, s)).find(item => item.turnId === t);
  if (!a) throw new AppError('NOT_FOUND', 'Turn not found.');
  return a;
}
