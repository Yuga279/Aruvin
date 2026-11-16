/**
 * ============================================================================
 * FILE: messages.ts
 * LOCATION: backend/src/persistence/messages.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Implement the P1 message archive port with scoped reference reads.
 *
 * ROLE IN PROJECT:
 *    Persists one bounded visible message per document, pages transcripts in
 *    stable order, and resolves context references without mutating live deltas.
 *
 * KEY COMPONENTS:
 *    - MongoMessages.append: Immutable scoped message inserts.
 *    - MongoMessages.list: Descending fetch with ascending selected pages.
 *    - MongoMessages.getReferences: Strict message-ref materialization.
 * ============================================================================
 */

import type { Filter } from 'mongodb';
import type { MessageRef } from '../contracts/agent-memory.js';
import { visibleMessageSchema } from '../contracts/api.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import {
  messageRecordSchema,
  type MessageCompletionStatus,
  type MessageRecord,
} from '../contracts/message.js';
import type { MessageRepository, PageQuery } from '../contracts/repositories.js';
import { AppError } from '../platform/errors/app-error.js';
import { cursor, page } from './pagination.js';
import { redactCalendarMessage } from './calendar-records.js';
import { inspectConfirmedRecord, type ConfirmedRecord } from './confirmed-record.js';
import { decode, key, normalizeDate, type StoredDocument } from './records.js';
import { RecordStore } from './store.js';

export class MongoMessages implements MessageRepository {
  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
    readonly clock: () => number = Date.now,
  ) {}

  async appendConfirmed(record: MessageRecord): Promise<ConfirmedRecord<MessageRecord>> {
    if (record.role === 'user' && record.sourceProvenance) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (record.role === 'user' && record.content.length > this.budgets.maxInputChars) {
      throw new AppError('INPUT_TOO_LARGE', 'The message exceeds the input limit.');
    }
    if (record.canvasArtifacts !== undefined && (record.role !== 'assistant' || record.mode !== 'live' || record.visibility !== 'internal')) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    return this.store.insertConfirmed(
      'messages',
      messageRecordSchema,
      { ...record, createdAt: normalizeDate(record.createdAt) },
      key('message', record.userId, record.sessionId, record.messageId),
      this.budgets.maxMessageBytes,
    );
  }

  async append(record: MessageRecord): Promise<void> {
    await this.appendConfirmed(record);
  }

  async getConfirmed(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<ConfirmedRecord<MessageRecord> | null> {
    return this.store.readConfirmed('messages', messageRecordSchema, {
      _id: key('message', userId, sessionId, messageId),
      userId,
      sessionId,
    });
  }

  async get(userId: string, sessionId: string, messageId: string) {
    const record = await this.store.read('messages', messageRecordSchema, {
      _id: key('message', userId, sessionId, messageId),
      userId,
      sessionId,
    });
    return record ? redactCalendarMessage(record, this.clock()) : null;
  }

  listPublished(userId: string, sessionId: string, query: PageQuery, maxSequence: number) {
    if (!Number.isSafeInteger(maxSequence) || maxSequence < -1) throw new AppError('INVALID_REQUEST', 'Invalid publication boundary.');
    return this.list(userId, sessionId, query, maxSequence);
  }
  async list(userId: string, sessionId: string, query: PageQuery, maxSequence?: number) {
    const result = await this.readPage(userId, sessionId, query, true, maxSequence);
    const candidates = result.items.filter(
      (record) => record.visibility === 'internal' && record.role === 'user',
    );
    let confirmedKeys: Set<string> | null = null;
    if (candidates.length > 0) {
      const uniqueCandidates = Array.from(
        new Map(candidates.map((c) => [`${c.turnId}\0${c.messageId}`, c])).values(),
      );
      const filter: Filter<StoredDocument> = {
        userId,
        sessionId,
        kind: 'acceptance',
        ...(uniqueCandidates.length === 1
          ? { userMessageId: uniqueCandidates[0]!.messageId, turnId: uniqueCandidates[0]!.turnId }
          : {
              $or: uniqueCandidates.map((c) => ({
                userMessageId: c.messageId,
                turnId: c.turnId,
              })),
            }),
      };
      try {
        const docs = await this.store
          .collection('metadata')
          .find(filter, this.store.options())
          .limit(uniqueCandidates.length)
          .toArray();
        confirmedKeys = new Set(
          docs
            .filter((doc) => typeof doc.turnId === 'string' && typeof doc.userMessageId === 'string')
            .map((doc) => `${doc.turnId}\0${doc.userMessageId}`),
        );
      } catch {
        throw new AppError('PERSISTENCE_ERROR', 'The chat could not be read.');
      }
    }
    const items = [];
    for (const record of result.items) {
      if (
        record.visibility === 'internal' &&
        record.role === 'user' &&
        (!confirmedKeys || !confirmedKeys.has(`${record.turnId}\0${record.messageId}`))
      ) {
        continue; // Unconfirmed acceptance is not a transcript.
      }
      items.push(record);
    }
    return {
      ...result,
      items: items.map((record) =>
        visibleMessageSchema.parse({
          messageId: record.messageId,
          turnId: record.turnId,
          eventId: record.eventId,
          sequence: record.sequence,
          role: record.role,
          content: record.visibility === 'internal' ? '' : record.content,
          createdAt: record.createdAt,
          completionStatus: record.completionStatus,
          truncated: record.truncated,
          ...(record.mode !== undefined ? { mode: record.mode } : {}),
          ...(record.voiceSessionId !== undefined ? { voiceSessionId: record.voiceSessionId } : {}),
          ...(record.voiceDurationSeconds !== undefined ? { voiceDurationSeconds: record.voiceDurationSeconds } : {}),
          ...(record.visibility === 'internal' ? { voiceTranscripts: [{ role: record.role, content: record.content, createdAt: record.createdAt }] }
            : record.voiceTranscripts !== undefined ? { voiceTranscripts: record.voiceTranscripts } : {}),
          ...(record.canvasArtifacts !== undefined ? { canvasArtifacts: record.canvasArtifacts } : {}),
          ...(record.calendarView ? { calendarView: record.calendarView } : {}),
        }),
      ),
    };
  }

  listForContext(userId: string, sessionId: string, query: PageQuery) {
    return this.readPage(userId, sessionId, query, false);
  }

  private async readPage(
    userId: string,
    sessionId: string,
    query: PageQuery,
    visibleOnly: boolean,
    maxSequence?: number,
  ) {
    const { limit, after } = page(
      query,
      'messages',
      userId,
      sessionId,
      this.budgets.maxPageSize,
    );
    const filter: Filter<StoredDocument> = {
      userId,
      sessionId,
      ...(maxSequence !== undefined ? { sequence: { $lte: maxSequence } } : {}),
      ...(visibleOnly ? { $and: [{ $or: [{ visibility: { $ne: 'internal' } },
        { visibility: 'internal', mode: 'live', voiceSessionId: { $exists: true },
          completionStatus: { $in: ['accepted', 'completed', 'truncated', 'cancelled', 'interrupted', 'failed'] } }] }] } : {}),
    };
    if (after) {
      filter.$or = [
        { sequence: { $lt: after.value } },
        { sequence: after.value, messageId: { $lt: after.id } },
      ];
    }
    const docs = await this.store
      .collection('messages')
      .find(filter, this.store.options())
      .sort({ sequence: -1, messageId: -1 })
      .limit(limit + 1)
      .toArray();
    const records = docs.slice(0, limit).map((doc) => redactCalendarMessage(decode(messageRecordSchema, doc)!, this.clock()));
    const last = records.at(-1);
    return {
      items: records.reverse(),
      olderAvailable: docs.length > limit,
      nextCursor:
        docs.length > limit && last
          ? cursor({
              kind: 'messages',
              userId,
              sessionId,
              value: last.sequence,
              id: last.messageId,
            })
          : null,
    };
  }

  async updateCompletionConfirmed(
    expected: ConfirmedRecord<MessageRecord>,
    completionStatus: MessageCompletionStatus,
    truncated: boolean,
  ): Promise<ConfirmedRecord<MessageRecord>> {
    const envelope = inspectConfirmedRecord<MessageRecord>(expected, {
      store: this.store,
      collection: 'messages',
    });
    const saved = envelope.canonical;
    const id = key('message', saved.userId, saved.sessionId, saved.messageId);
    if (envelope.id !== id) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence receipt.');
    }
    if (saved.completionStatus === completionStatus && saved.truncated === truncated) {
      return expected;
    }
    if (
      ['completed', 'truncated', 'failed', 'cancelled', 'interrupted'].includes(
        saved.completionStatus,
      )
    ) {
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Message is already finalized.');
    }
    if (truncated !== (completionStatus === 'truncated')) {
      throw new AppError('INVALID_REQUEST', 'Invalid truncation state.');
    }
    const result = await this.store.replaceConfirmed(
      expected,
      messageRecordSchema,
      { ...saved, completionStatus, truncated },
      this.budgets.maxMessageBytes,
    );
    if (result.outcome !== 'confirmed') {
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Message changed while saving.');
    }
    return result.receipt;
  }

  async updateCompletion(
    userId: string,
    sessionId: string,
    messageId: string,
    completionStatus: MessageCompletionStatus,
    truncated: boolean,
  ): Promise<void> {
    const expected = await this.getConfirmed(userId, sessionId, messageId);
    if (!expected) {
      throw new AppError('NOT_FOUND', 'Message not found.');
    }
    await this.updateCompletionConfirmed(expected, completionStatus, truncated);
  }

  async getReferences(
    userId: string,
    sessionId: string,
    refs: readonly MessageRef[],
  ): Promise<MessageRecord[]> {
    if (refs.length > Math.min(500, this.budgets.maxMessagesInContext)) {
      throw new AppError('CONTEXT_BUDGET_EXCEEDED', 'The selected history is too large.');
    }
    if (!refs.length) return [];
    const docs = await this.store.collection('messages').find({ userId, sessionId,
      _id: { $in: refs.map(ref => key('message', userId, sessionId, ref.messageId)) },
    }, this.store.options()).limit(refs.length).toArray();
    const records = new Map(docs.map(doc => {
      const record = redactCalendarMessage(decode(messageRecordSchema, doc)!, this.clock());
      return [record.messageId, record] as const;
    }));
    const items: MessageRecord[] = [];
    for (const ref of refs) {
      const item = records.get(ref.messageId);
      if (!item || item.eventId !== ref.eventId || item.sequence !== ref.sequence) {
        throw new AppError('NOT_READY', 'Chat context needs recovery.');
      }
      items.push(item);
    }
    return items;
  }
}
