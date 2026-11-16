/**
 * ============================================================================
 * FILE: sessions.ts
 * LOCATION: backend/src/persistence/sessions.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Implement the P1 session repository plus scoped recovery listing.
 *
 * ROLE IN PROJECT:
 *    Stores bounded session metadata, hides unaccepted chats from navigation,
 *    and exposes recovery scans without embedding transcript arrays.
 *
 * KEY COMPONENTS:
 *    - MongoSessions.createIfAbsent: Idempotent scoped session creation.
 *    - MongoSessions.list: Keyset activity listing of accepted sessions.
 *    - MongoSessions.listForRecovery: Bounded scans of attempts and owner-only leftovers.
 * ============================================================================
 */

import type { Filter } from 'mongodb';
import { sessionSummarySchema } from '../contracts/api.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { PageQuery, SessionRepository } from '../contracts/repositories.js';
import { sessionRecordSchema, type SessionRecord } from '../contracts/session.js';
import { AppError } from '../platform/errors/app-error.js';
import { cursor, page } from './pagination.js';
import {
  decode,
  graphThreadId,
  key,
  normalizeDate,
  type StoredDocument,
} from './records.js';
import { RecordStore } from './store.js';

export class MongoSessions implements SessionRepository {
  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
  ) {}

  get(userId: string, sessionId: string) {
    return this.store.read('sessions', sessionRecordSchema, {
      _id: key('session', userId, sessionId),
      userId,
      sessionId,
    });
  }

  createForInternalTurn(record: SessionRecord): Promise<SessionRecord> {
    return this.createIfAbsent(record);
  }

  async createIfAbsent(record: SessionRecord): Promise<SessionRecord> {
    const value = sessionRecordSchema.parse({
      ...record,
      createdAt: normalizeDate(record.createdAt),
      updatedAt: normalizeDate(record.updatedAt),
      lastActivityAt: normalizeDate(record.lastActivityAt),
    });
    if (
      value.graphThreadId !== graphThreadId(value.userId, value.sessionId) ||
      value.title.length > this.budgets.titleMaxChars
    ) {
      throw new AppError('INVALID_REQUEST', 'Invalid session record.');
    }
    const saved = await this.get(value.userId, value.sessionId);
    if (saved) {
      if (saved.graphThreadId !== value.graphThreadId) {
        throw new AppError(
          'IDEMPOTENCY_PAYLOAD_MISMATCH',
          'The session identity is already used.',
        );
      }
      return saved;
    }
    try {
      return await this.store.insert(
        'sessions',
        sessionRecordSchema,
        value,
        key('session', value.userId, value.sessionId),
        this.budgets.maxDocumentBytes,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
        const winner = await this.get(value.userId, value.sessionId);
        if (winner?.graphThreadId === value.graphThreadId) {
          return winner;
        }
      }
      throw error;
    }
  }

  async list(userId: string, query: PageQuery) {
    const { limit, after } = page(
      query,
      'sessions',
      userId,
      '',
      this.budgets.maxPageSize,
    );
    // Equality on each index prefix preserves activity order without a computed sort.
    // Mongo's null equality includes missing flags; normalize only these bounded reads.
    const pins = !after || after.pinned ? [true, false, null] : [false, null];
    const groups = await Promise.all(pins.map(async (pinned) => {
      const filter: Filter<StoredDocument> = {
        userId, lifecycle: 'active', latestTurnId: { $ne: null }, pinned,
      };
      if (after && (pinned === true) === (after.pinned ?? false)) {
        filter.$or = [
          { lastActivityAt: { $lt: after.value } },
          { lastActivityAt: after.value, sessionId: { $lt: after.id } },
        ];
      }
      return this.store.collection('sessions')
        .find(filter, this.store.options())
        .sort({ lastActivityAt: -1, sessionId: -1 })
        .limit(limit + 1)
        .toArray();
    }));
    // Merge at most 3 * (limit + 1) records using Mongo's simple binary string order.
    const docs = groups.flat().map<StoredDocument>(doc => ({ ...doc, pinned: doc.pinned ?? false }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
        Buffer.compare(Buffer.from(b.lastActivityAt), Buffer.from(a.lastActivityAt)) ||
        Buffer.compare(Buffer.from(b.sessionId), Buffer.from(a.sessionId)))
      .slice(0, limit + 1);
    const selected = docs.slice(0, limit).map((doc) =>
      sessionSummarySchema.parse(
        decode(sessionRecordSchema, doc) && {
          sessionId: doc.sessionId,
          title: doc.title,
          pinned: doc.pinned,
          createdAt: doc.createdAt,
          lastActivityAt: doc.lastActivityAt,
        },
      ),
    );
    const last = selected.at(-1);
    return {
      items: selected,
      nextCursor:
        docs.length > limit && last
          ? cursor({
              kind: 'sessions',
              userId,
              sessionId: '',
              value: last.lastActivityAt,
              id: last.sessionId,
              pinned: last.pinned ?? false,
            })
          : null,
    };
  }

  async touchActivity(userId: string, sessionId: string, at: string): Promise<void> {
    const value = normalizeDate(at);
    try {
      const result = await this.store
        .collection('sessions')
        .updateOne(
          { _id: key('session', userId, sessionId), userId, sessionId },
          { $max: { lastActivityAt: value, updatedAt: value }, $inc: { _revision: 1 } },
          this.store.options(),
        );
      if (!result.matchedCount) {
        throw new Error('missing');
      }
    } catch {
      const saved = await this.get(userId, sessionId);
      if (!saved || saved.lastActivityAt < value) {
        throw new AppError('PERSISTENCE_ERROR', 'Chat activity could not be saved.');
      }
    }
  }

  async update(userId: string, sessionId: string, changes: { title?: string; pinned?: boolean }): Promise<void> {
    const title = changes.title?.trim();
    if ((changes.title !== undefined && (!title || title.length > this.budgets.titleMaxChars)) ||
      (changes.pinned !== undefined && typeof changes.pinned !== 'boolean') ||
      (title === undefined && changes.pinned === undefined)) {
      throw new AppError('INVALID_REQUEST', 'Invalid session update.');
    }
    const fields = { ...(title !== undefined ? { title } : {}),
      ...(changes.pinned !== undefined ? { pinned: changes.pinned } : {}) };
    await this.mutate(userId, sessionId, fields);
  }

  // Soft deletion preserves durable accounting/checkpoints for the retention policy.
  async delete(userId: string, sessionId: string): Promise<void> {
    await this.mutate(userId, sessionId, { lifecycle: 'archived' }, true);
  }

  private async mutate(userId: string, sessionId: string, fields: Record<string, string | boolean>, idleOnly = false) {
    const scope = { _id: key('session', userId, sessionId), userId, sessionId };
    try {
      const result = await this.store.collection('sessions').updateOne({ ...scope, lifecycle: 'active',
        ...(idleOnly ? { 'execution.ownerId': null, 'execution.activeAttemptId': null } : {}) },
      { $set: { ...fields, updatedAt: new Date().toISOString() }, $inc: { _revision: 1 } }, this.store.options());
      if (result.matchedCount) return;
    } catch {
      const saved = await this.store.raw('sessions', scope);
      if (saved && Object.entries(fields).every(([name, value]) => saved[name] === value)) return;
      throw new AppError('PERSISTENCE_ERROR', 'The session change could not be confirmed.');
    }
    const saved = await this.get(userId, sessionId);
    if (idleOnly && saved?.lifecycle === 'archived') return;
    if (!saved || saved.lifecycle !== 'active') throw new AppError('NOT_FOUND', 'Chat not found.');
    throw new AppError('CONFLICT_ACTIVE_TURN', 'Wait for the response to finish before deleting this chat.');
  }

  async listForRecovery(userId: string, query: PageQuery) {
    const { limit, after } = page(
      query,
      'sessions',
      userId,
      '',
      this.budgets.maxPageSize,
    );
    const filter: Filter<StoredDocument> = {
      userId,
      $or: [
        { 'execution.activeAttemptId': { $ne: null } },
        { 'execution.ownerId': { $ne: null } },
      ],
    };
    if (after) {
      filter.$and = [{ $or: [
        { lastActivityAt: { $lt: after.value } },
        { lastActivityAt: after.value, sessionId: { $lt: after.id } },
      ] }];
    }
    const docs = await this.store
      .collection('sessions')
      .find(filter, this.store.options())
      .sort({ lastActivityAt: -1, sessionId: -1 })
      .limit(limit + 1)
      .toArray();
    const items = docs.slice(0, limit).map((doc) => decode(sessionRecordSchema, doc)!);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        docs.length > limit && last
          ? cursor({
              kind: 'sessions',
              userId,
              sessionId: '',
              value: last.lastActivityAt,
              id: last.sessionId,
            })
          : null,
    };
  }
}
