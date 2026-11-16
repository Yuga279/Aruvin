/**
 * ============================================================================
 * FILE: memory-calendar-reader.ts
 * LOCATION: backend/src/persistence/memory-calendar-reader.ts
 * ============================================================================
 * PURPOSE: Read only committed consolidated native memory evidence.
 * ROLE IN PROJECT: Cold hydration companion to the terminal archive writer.
 * KEY COMPONENTS: Publication visibility, bounded scoped lookup, original pairs.
 * ============================================================================
 */
import type { PersistenceBundle } from './persistence.js';
import type { MessageRecord } from '../contracts/message.js';
import type { SessionRecord } from '../contracts/session.js';
import { memoryCalendarRecordSchema, type MemoryCalendarState } from '../chat-runtime/memory-calendar-state.js';
import { key } from './records.js';
import { AppError } from '../platform/errors/app-error.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';

export async function readMemoryCalendarStates(p: PersistenceBundle, session: SessionRecord,
  records: readonly MessageRecord[], maxTurns: number, publishedAttempts: readonly AttemptRecord[] = []): Promise<MemoryCalendarState[]> {
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 250)
    throw new Error('Invalid native hydration bound.');
  const attempts = [...new Set(records.filter(record => record.role === 'assistant' && record.attemptId)
    .map(record => record.attemptId!))];
  if (attempts.length > maxTurns) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Native history exceeds its hydration limit.');
  const publication = session.memoryPublication, store = p.owner.store;
  if (publishedAttempts.length > maxTurns || new Set(publishedAttempts.map(a => a.attemptId)).size !== publishedAttempts.length ||
      publishedAttempts.some(a => a.userId !== session.userId || a.sessionId !== session.sessionId))
    throw new AppError('NOT_READY', 'Native history needs reconciliation.');
  if (!publication || !store || session.lifecycle !== 'active') return [];
  const states: MemoryCalendarState[] = [];
  for (const attemptId of attempts) {
    const attempt = publishedAttempts.find(a => a.attemptId === attemptId);
    const dependency = attempt?.nativePublication;
    if (dependency && (!attempt || dependency.version !== attempt.contextVersion + 1 || attempt.sequence > publication.sequence ||
        !['completed', 'truncated', 'failed', 'cancelled', 'interrupted'].includes(attempt.status)))
      throw new AppError('NOT_READY', 'Native history needs reconciliation.');
    const record = await store.read('metadata', memoryCalendarRecordSchema, {
      _id: key('memory-calendar-native', session.userId, session.sessionId, attemptId),
      userId: session.userId, sessionId: session.sessionId,
    });
    if (!record) {
      if (dependency && dependency.version <= publication.version)
        throw new AppError('NOT_READY', 'Native history needs reconciliation.');
      continue;
    }
    if (record.version > publication.version) {
      if (dependency && dependency.version <= publication.version)
        throw new AppError('NOT_READY', 'Native history needs reconciliation.');
      continue; // Partial publication is never model context.
    }
    if (record.attemptId !== attemptId || record.userId !== session.userId || record.sessionId !== session.sessionId ||
        record.fence !== publication.fence || (dependency && (record.epoch !== dependency.epoch ||
          record.version !== dependency.version || record.fence !== dependency.fence ||
          record.turnId !== attempt?.turnId ||
          hashPayload(JSON.stringify(record.state)) !== dependency.contentHash)) ||
        !records.some(message => message.attemptId === attemptId &&
          message.turnId === record.turnId && message.sequence <= publication.sequence))
      throw new AppError('NOT_READY', 'Native history needs reconciliation.');
    states.push(record.state);
  }
  return states;
}
