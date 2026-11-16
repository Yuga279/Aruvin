/**
 * ============================================================================
 * FILE: calendar-retention.ts
 * LOCATION: backend/src/persistence/calendar-retention.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Retention and privacy redaction for Google Calendar sources, results, decisions,
 *    proposals, operations, and connections.
 *
 * ROLE IN PROJECT:
 *    Executes bounded pagination sweeps to expire cached calendar data, redact
 *    sensitive event labels and links, while preserving causal deduplication authority.
 *
 * KEY COMPONENTS:
 *    - sweepMultiCalendarPage: Cursor-based sweep over metadata and integration_connections.
 *    - registerSource / redactSource: Source lifecycle and TTL enforcement.
 *    - expireAuditPage: Preserves unresolved operations beyond audit deadline.
 * ============================================================================
 */

import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type { BudgetConfig } from '../contracts/budgets.js';
import {
  type CalendarSourceReference,
  type CalendarSourceReferenceV2,
  calendarToolResultRecordSchema,
  calendarToolResultRecordV2Schema,
} from '../contracts/calendar-sources.js';
import {
  compatibleCalendarConnectionSchema,
  compatibleCalendarOperationSchema,
  compatibleCalendarSourceSchema,
  compatibleSkillDecisionRecordSchema,
  compatibleSkillResultRecordSchema,
} from '../contracts/calendar-compatibility.js';
import { idSchema, isoDateSchema } from '../contracts/identifiers.js';
import { calendarAccountBindingSchema, type CalendarAccountBinding } from '../contracts/calendar-discovery.js';
import { AppError } from '../platform/errors/app-error.js';
import {
  decodeCalendar,
  encodeCalendar,
  calendarSourceExpired,
  redactCalendarDecision,
  redactCalendarDecisionForAccount,
  redactCalendarMessage,
  redactCalendarMessageForAccount,
  redactCalendarMessageContent,
  redactCalendarOperation,
  redactCalendarResultForAccount,
  redactCalendarSource,
  redactCalendarSourceForAccount,
  redactCalendarResult,
  readCurrentCalendarAccountBinding,
  requireCalendarAccountRevision,
  sameCalendarAccountBinding,
  sourceKey,
} from './calendar-records.js';
import { RecordStore } from './store.js';
import { messageRecordSchema } from '../contracts/message.js';
import {
  resumableDecisionSchema,
  resumableDecisionV2Schema,
  resumableSkillDecisionSchema,
} from '../contracts/calendar-model.js';
import {
  type CalendarOperation,
  type CalendarOperationV2,
} from '../contracts/calendar-operations.js';
import {
  calendarProposalSchema,
} from '../contracts/calendar-authority.js';
import { MongoCalendarProposals } from './calendar-proposals.js';
import { MongoCalendarOperations } from './calendar-operations.js';
import { MongoCalendarConnections } from './calendar-connections.js';
import type { Document } from 'mongodb';
import { key } from './records.js';

export const calendarSourceRecordSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('calendar-source'),
  userId: idSchema,
  sessionId: idSchema,
  sourceId: idSchema,
  source: compatibleCalendarSourceSchema,
}).strict();

export const multiCalendarCursorSchema = z.object({
  v: z.literal(2),
  userId: idSchema,
  collection: z.enum(['metadata', 'integration_connections']),
  after: z.string().max(2048),
}).strict();

const invalidationCursorSchema = z.object({
  v: z.literal(1),
  userId: idSchema,
  connectionId: idSchema,
  connectionRevision: z.number().int().positive(),
  googleSubjectId: z.string().min(1).max(255),
  now: isoDateSchema,
  collection: z.enum(['metadata', 'messages']),
  after: z.string().max(2048),
}).strict();

function encodeMultiCalendarCursor(payload: z.infer<typeof multiCalendarCursorSchema>): string {
  return Buffer.from(JSON.stringify(multiCalendarCursorSchema.parse(payload))).toString('base64url');
}

function decodeMultiCalendarCursor(raw: string, userId: string): z.infer<typeof multiCalendarCursorSchema> {
  if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new AppError('INVALID_REQUEST', 'Invalid page cursor.');
  }
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const parsed = multiCalendarCursorSchema.parse(json);
    if (parsed.userId !== userId) throw new Error('Scope mismatch');
    return parsed;
  } catch {
    throw new AppError('INVALID_REQUEST', 'Invalid page cursor.');
  }
}

function encodeInvalidationCursor(value: z.infer<typeof invalidationCursorSchema>): string {
  return Buffer.from(JSON.stringify(invalidationCursorSchema.parse(value))).toString('base64url');
}

function decodeInvalidationCursor(
  raw: string,
  account: CalendarAccountBinding,
  now: string,
): z.infer<typeof invalidationCursorSchema> {
  if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new AppError('INVALID_REQUEST', 'Invalid page cursor.');
  }
  try {
    const parsed = invalidationCursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (parsed.userId !== account.userId || parsed.connectionId !== account.connectionId
      || parsed.connectionRevision !== account.connectionRevision || parsed.googleSubjectId !== account.googleSubjectId
      || parsed.now !== now) throw new Error('Scope mismatch');
    return parsed;
  } catch {
    throw new AppError('INVALID_REQUEST', 'Invalid page cursor.');
  }
}

export class MongoCalendarRetention {
  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
    readonly clock: () => number = Date.now,
  ) {}

  async registerSource(record: {
    userId: string;
    sessionId: string;
    source: CalendarSourceReference | CalendarSourceReferenceV2;
  }): Promise<void> {
    const source = compatibleCalendarSourceSchema.parse(record.source);
    if (!source.permission.minimalEvidenceAllowed) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const account = await requireCalendarAccountRevision(this.store, {
      userId: record.userId, connectionId: source.connectionId,
      connectionRevision: source.connectionRevision,
    });
    const value = calendarSourceRecordSchema.parse({
      schemaVersion: 1, kind: 'calendar-source', userId: record.userId, sessionId: record.sessionId,
      sourceId: source.sourceId, source,
    });
    const existing = decodeCalendar(calendarSourceRecordSchema, await this.store.raw('metadata', {
      _id: sourceKey(value.userId, value.sessionId, value.sourceId), userId: value.userId, sessionId: value.sessionId,
    }));
    if (existing) {
      if (existing.source.fetchedAt !== source.fetchedAt || existing.source.connectionId !== source.connectionId) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      if (Date.parse(source.expiresAt) > Date.parse(existing.source.expiresAt)) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      const current = await readCurrentCalendarAccountBinding(this.store, record.userId);
      if (!sameCalendarAccountBinding(current, account)) {
        throw new AppError('INVALID_REQUEST', 'Calendar account revision is no longer current.', false);
      }
      return;
    }
    const id = sourceKey(value.userId, value.sessionId, value.sourceId);
    const { doc } = encodeCalendar(calendarSourceRecordSchema, value, id, this.budgets.maxDocumentBytes);
    let writeFailed = false;
    try {
      await this.store.collection('metadata').updateOne(
        { _id: id, userId: value.userId, sessionId: value.sessionId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      writeFailed = true;
    }
    let current: Awaited<ReturnType<typeof readCurrentCalendarAccountBinding>>;
    try {
      current = await readCurrentCalendarAccountBinding(this.store, record.userId);
    } catch {
      await this.redactSource({
        userId: value.userId, sessionId: value.sessionId, sourceId: value.sourceId,
        reason: 'account-revision-invalidated', now: new Date(this.clock()).toISOString(),
      });
      throw new AppError('PERSISTENCE_ERROR', 'Calendar account authority could not be confirmed.', false);
    }
    if (!sameCalendarAccountBinding(current, account)) {
      await this.redactSource({
        userId: value.userId, sessionId: value.sessionId, sourceId: value.sourceId,
        reason: 'account-revision-invalidated', now: new Date(this.clock()).toISOString(),
      });
      throw new AppError('INVALID_REQUEST', 'Calendar account revision is no longer current.', false);
    }
    const saved = decodeCalendar(calendarSourceRecordSchema, await this.store.raw('metadata', {
      _id: id, userId: value.userId, sessionId: value.sessionId,
    }));
    if (!saved) {
      throw new AppError('PERSISTENCE_ERROR', writeFailed
        ? 'Calendar source save could not be confirmed.' : 'Calendar source could not be saved.', false);
    }
    if (!isDeepStrictEqual(saved, value)) {
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The source identity already has different data.', false);
    }
  }

  async redactSource(input: {
    userId: string; sessionId: string; sourceId: string; reason: string; now: string;
  }): Promise<void> {
    isoDateSchema.parse(input.now);
    const id = sourceKey(input.userId, input.sessionId, input.sourceId);
    const raw = await this.store.raw('metadata', { _id: id, userId: input.userId, sessionId: input.sessionId });
    const saved = decodeCalendar(calendarSourceRecordSchema, raw);
    if (!saved || !raw) return;
    const next = calendarSourceRecordSchema.parse({
      ...saved,
      source: redactCalendarSource(saved.source, Date.parse(input.now)),
    });
    if (isDeepStrictEqual(next, saved)) return;
    const { doc } = encodeCalendar(calendarSourceRecordSchema, next, id, this.budgets.maxDocumentBytes);
    doc._revision = Number(raw._revision) + 1;
    try {
      const result = await this.store.collection('metadata').replaceOne(
        { _id: id, userId: input.userId, sessionId: input.sessionId, _revision: raw._revision },
        doc,
        this.store.options(),
      );
      if (result.matchedCount === 1) return;
    } catch {
      /* Confirm an ambiguous redaction below; never repeat it blindly. */
    }
    const confirmed = await this.store.raw('metadata', { _id: id, userId: input.userId, sessionId: input.sessionId });
    const savedAgain = decodeCalendar(calendarSourceRecordSchema, confirmed);
    if (savedAgain && savedAgain.source.redactedAt !== null) return;
    throw new AppError('PERSISTENCE_ERROR', 'Calendar source redaction could not be confirmed.', false);
  }

  async sweepPage(input: { userId: string; now: string; cursor: string | null; limit: number }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > this.budgets.maxPageSize) {
      throw new AppError('INVALID_REQUEST', 'Invalid page size.');
    }
    const nowMs = Date.parse(isoDateSchema.parse(input.now));
    const docs = await this.store.collection('metadata').find({
      userId: input.userId, kind: 'calendar-source',
      ...(input.cursor ? { _id: { $gt: input.cursor } } : {}),
    }, this.store.options()).sort({ _id: 1 }).limit(input.limit + 1).toArray();
    for (const doc of docs.slice(0, input.limit)) {
      const record = decodeCalendar(calendarSourceRecordSchema, doc);
      if (!record) continue;
      if (record.source.redactedAt === null && Date.parse(record.source.expiresAt) <= nowMs) {
        await this.redactSource({
          userId: record.userId, sessionId: record.sessionId, sourceId: record.sourceId,
          reason: 'expired', now: input.now,
        });
      }
    }
    await this.redactDerived(input.userId, nowMs);
    const last = docs.slice(0, input.limit).at(-1);
    return { nextCursor: docs.length > input.limit && last ? String(last._id) : null };
  }

  async invalidateAccountRevisionPage(input: {
    account: CalendarAccountBinding;
    now: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ nextCursor: string | null }> {
    const account = calendarAccountBindingSchema.parse(input.account);
    const now = isoDateSchema.parse(input.now);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > this.budgets.maxPageSize) {
      throw new AppError('INVALID_REQUEST', 'Invalid page size.');
    }
    const cursor = input.cursor ? decodeInvalidationCursor(input.cursor, account, now) : null;
    const collection = cursor?.collection ?? 'metadata';
    const after = cursor?.after ?? '';

    if (collection === 'metadata') {
      // ponytail: keyset pages bound each batch, but current indexes do not cover every account-revision field;
      // add per-kind account-revision indexes before admitting large retained histories.
      const docs = await this.store.collection('metadata').find({
        userId: account.userId,
        ...(after ? { _id: { $gt: after } } : {}),
        $or: [
          { kind: 'calendar-source', 'source.connectionId': account.connectionId,
            'source.connectionRevision': account.connectionRevision },
          { kind: 'calendar-model-decision', connectionId: account.connectionId,
            connectionRevision: account.connectionRevision },
          { kind: 'calendar-tool-result', 'resultRef.source.connectionId': account.connectionId,
            'resultRef.source.connectionRevision': account.connectionRevision },
          { kind: 'calendar-operation', connectionId: account.connectionId,
            connectionRevision: account.connectionRevision },
          { kind: 'calendar-proposal', connectionId: account.connectionId,
            connectionRevision: account.connectionRevision },
        ],
      }, this.store.options()).sort({ _id: 1 }).limit(input.limit + 1).toArray();
      const page = docs.slice(0, input.limit);
      for (const doc of page) await this.invalidateMetadataDoc(doc, account, now);
      if (docs.length > input.limit && page.length > 0) {
        return { nextCursor: encodeInvalidationCursor({
          v: 1, ...account, now, collection: 'metadata', after: String(page.at(-1)!._id),
        }) };
      }
      return { nextCursor: encodeInvalidationCursor({
        v: 1, ...account, now, collection: 'messages', after: '',
      }) };
    }

    const docs = await this.store.collection('messages').find({
      userId: account.userId,
      ...(after ? { _id: { $gt: after } } : {}),
      sourceProvenance: { $elemMatch: {
        connectionId: account.connectionId,
        connectionRevision: account.connectionRevision,
      } },
    }, this.store.options()).sort({ _id: 1 }).limit(input.limit + 1).toArray();
    const page = docs.slice(0, input.limit);
    for (const doc of page) {
      const record = decodeCalendar(messageRecordSchema, doc);
      if (!record) continue;
      const redacted = redactCalendarMessageForAccount(record, account, Date.parse(now));
      if (!isDeepStrictEqual(redacted, record)) {
        await this.replaceInvalidatedRecord('messages', messageRecordSchema, redacted, doc, this.budgets.maxMessageBytes);
      }
    }
    return {
      nextCursor: docs.length > input.limit && page.length > 0
        ? encodeInvalidationCursor({ v: 1, ...account, now, collection: 'messages', after: String(page.at(-1)!._id) })
        : null,
    };
  }

  private async invalidateMetadataDoc(doc: Document, account: CalendarAccountBinding, now: string): Promise<void> {
    if (doc.kind === 'calendar-source') {
      const record = decodeCalendar(calendarSourceRecordSchema, doc);
      if (!record) return;
      const source = redactCalendarSourceForAccount(record.source, account, Date.parse(now));
      if (!isDeepStrictEqual(source, record.source)) {
        await this.replaceInvalidatedRecord('metadata', calendarSourceRecordSchema, { ...record, source }, doc,
          this.budgets.maxDocumentBytes);
      }
    } else if (doc.kind === 'calendar-model-decision') {
      const record = decodeCalendar(compatibleSkillDecisionRecordSchema, doc);
      if (!record) return;
      const redacted = redactCalendarDecisionForAccount(record, account, Date.parse(now));
      if (!isDeepStrictEqual(redacted, record)) {
        const schema = redacted.schemaVersion === 3 ? resumableSkillDecisionSchema
          : redacted.schemaVersion === 2 ? resumableDecisionV2Schema : resumableDecisionSchema;
        await this.replaceInvalidatedRecord('metadata', schema, redacted, doc, this.budgets.maxDocumentBytes);
      }
      await this.redactAssistantAttempt({
        userId: record.userId, sessionId: record.sessionId, turnId: record.turnId,
        attemptId: record.attemptId, now,
      });
    } else if (doc.kind === 'calendar-tool-result') {
      const record = decodeCalendar(compatibleSkillResultRecordSchema, doc);
      if (!record || record.schemaVersion === 3) return;
      const redacted = redactCalendarResultForAccount(record, account, Date.parse(now));
      if (!isDeepStrictEqual(redacted, record)) {
        const schema = redacted.schemaVersion === 2 ? calendarToolResultRecordV2Schema : calendarToolResultRecordSchema;
        await this.replaceInvalidatedRecord('metadata', schema, redacted, doc, this.budgets.maxDocumentBytes);
      }
      await this.redactAssistantAttempt({
        userId: record.userId, sessionId: record.sessionId, turnId: record.turnId,
        attemptId: record.attemptId, now,
      });
    } else if (doc.kind === 'calendar-operation') {
      const record = decodeCalendar(compatibleCalendarOperationSchema, doc);
      if (!record) return;
      const operations = new MongoCalendarOperations(this.store, this.budgets, this.clock);
      const outcome = await operations.redactInvalidatedRevision({
        account, sessionId: record.sessionId, turnId: record.turnId, now,
      });
      if (outcome !== 'confirmed') {
        throw new AppError('PERSISTENCE_ERROR', 'Calendar operation redaction could not be confirmed.', false);
      }
      await this.redactAssistantAttempt({
        userId: record.userId, sessionId: record.sessionId, turnId: record.turnId,
        attemptId: record.originatingAttemptId, now,
      });
    } else if (doc.kind === 'calendar-proposal') {
      const record = decodeCalendar(calendarProposalSchema, doc);
      if (!record) return;
      let unresolvedOperation = false;
      if (record.consumedBy) {
        unresolvedOperation = true;
        const operationRaw = await this.store.collection('metadata').findOne({
          kind: 'calendar-operation', userId: record.userId, operationId: record.consumedBy.operationId,
        }, this.store.options());
        if (operationRaw) {
          const operation = decodeCalendar(compatibleCalendarOperationSchema, operationRaw);
          if (operation && ['succeeded', 'definitely-failed', 'failed', 'cancelled', 'evidence-expired'].includes(operation.state)) {
            unresolvedOperation = false;
          }
        }
      }
      const proposals = new MongoCalendarProposals(this.store, this.budgets, this.clock);
      await this.redactAssistantAttempt({
        userId: record.userId, sessionId: record.sessionId, turnId: record.originatingTurnId,
        attemptId: record.originatingAttemptId, now,
      });
      const outcome = await proposals.tombstone({
        expectedRevision: record.revision,
        tombstone: {
          schemaVersion: 2, kind: 'calendar-proposal-tombstone', userId: record.userId,
          sessionId: record.sessionId, proposalId: record.proposalId, intentId: record.intentId,
          revision: record.revision + 1, reason: 'disconnected',
          operationId: record.consumedBy?.operationId ?? null,
          canonicalActionHash: record.consumedBy?.canonicalActionHash ?? null,
          at: now, unresolvedOperation,
        },
      });
      if (outcome !== 'confirmed') {
        throw new AppError('PERSISTENCE_ERROR', 'Calendar proposal redaction could not be confirmed.', false);
      }
    }
  }

  private async redactAssistantAttempt(input: {
    userId: string; sessionId: string; turnId: string; attemptId: string; now: string;
  }): Promise<void> {
    const messageId = key('output', input.userId, input.sessionId, input.attemptId);
    const id = key('message', input.userId, input.sessionId, messageId);
    const doc = await this.store.raw('messages', {
      _id: id, userId: input.userId, sessionId: input.sessionId,
      turnId: input.turnId, attemptId: input.attemptId, role: 'assistant',
    });
    if (!doc) return;
    const record = decodeCalendar(messageRecordSchema, doc);
    if (!record) return;
    const redacted = redactCalendarMessageContent(record, Date.parse(input.now));
    if (!isDeepStrictEqual(redacted, record)) {
      await this.replaceInvalidatedRecord('messages', messageRecordSchema, redacted, doc, this.budgets.maxMessageBytes);
    }
  }

  private async replaceInvalidatedRecord(
    collection: 'metadata' | 'messages',
    schema: z.ZodTypeAny,
    value: unknown,
    old: Document,
    limit: number,
  ): Promise<void> {
    const { record, doc } = encodeCalendar(schema, value, String(old._id), limit);
    doc._revision = Number(old._revision) + 1;
    try {
      const result = await this.store.collection(collection).replaceOne(
        { _id: old._id, userId: old.userId, _revision: old._revision }, doc, this.store.options(),
      );
      if (result.matchedCount === 1) return;
    } catch {
      /* Confirm the CAS by exact reread; a lost acknowledgement is not a reason to repeat blindly. */
    }
    const saved = await this.store.raw(collection, { _id: old._id, userId: old.userId });
    const decoded = decodeCalendar(schema, saved);
    if (saved?._revision === doc._revision && decoded && isDeepStrictEqual(decoded, record)) return;
    throw new AppError('PERSISTENCE_ERROR', 'Calendar content redaction could not be confirmed.', false);
  }

  async expireAuditPage(input: { userId: string; now: string; cursor: string | null; limit: number }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > this.budgets.maxPageSize) {
      throw new AppError('INVALID_REQUEST', 'Invalid page size.');
    }
    const nowMs = Date.parse(isoDateSchema.parse(input.now));
    const docs = await this.store.collection('metadata').find({
      userId: input.userId, kind: 'calendar-operation',
      ...(input.cursor ? { _id: { $gt: input.cursor } } : {}),
    }, this.store.options()).sort({ _id: 1 }).limit(input.limit + 1).toArray();
    for (const doc of docs.slice(0, input.limit)) {
      const operation = decodeCalendar(compatibleCalendarOperationSchema, doc);
      if (!operation) continue;
      if (operation.state === 'unknown' || operation.state === 'dispatching' || operation.state === 'planned') continue;
      if (Date.parse(operation.auditExpiresAt) > nowMs) continue;
      if (operation.state === 'evidence-expired') continue;
      const redacted = redactCalendarOperation(operation, nowMs);
      let confirmed: boolean;
      if (operation.schemaVersion === 2) {
        const operations = new MongoCalendarOperations(this.store, this.budgets, this.clock);
        const outcome = await operations.v2.compareAndSwap({
          expectedRevision: operation.revision,
          next: {
            ...(redacted as CalendarOperationV2),
            revision: operation.revision + 1,
            sequence: operation.sequence + 1,
            state: 'evidence-expired',
            action: null,
            updatedAt: input.now,
          },
        });
        confirmed = outcome.outcome === 'confirmed';
      } else {
        const operations = new MongoCalendarOperations(this.store, this.budgets, this.clock);
        const outcome = await operations.compareAndSwap(operation.revision, {
          ...(redacted as CalendarOperation),
          revision: operation.revision + 1,
          sequence: operation.sequence + 1,
          state: 'evidence-expired',
          action: null,
          updatedAt: input.now,
        });
        confirmed = outcome.outcome === 'confirmed';
      }
      if (!confirmed) throw new AppError('PERSISTENCE_ERROR', 'Calendar operation expiry could not be confirmed.', false);
      await this.redactAssistantAttempt({
        userId: operation.userId, sessionId: operation.sessionId, turnId: operation.turnId,
        attemptId: operation.originatingAttemptId, now: input.now,
      });
    }
    const last = docs.slice(0, input.limit).at(-1);
    return { nextCursor: docs.length > input.limit && last ? String(last._id) : null };
  }

  async sweepMultiCalendarPage(input: {
    userId: string;
    now: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ nextCursor: string | null }> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > this.budgets.maxPageSize) {
      throw new AppError('INVALID_REQUEST', 'Invalid page size.');
    }
    const nowMs = Date.parse(isoDateSchema.parse(input.now));
    const cursor = input.cursor ? decodeMultiCalendarCursor(input.cursor, input.userId) : null;
    const currentCollection = cursor ? cursor.collection : 'metadata';
    const after = cursor ? cursor.after : null;

    if (currentCollection === 'metadata') {
      const docs = await this.store.collection('metadata').find({
        userId: input.userId,
        ...(after ? { _id: { $gt: after } } : {}),
      }, this.store.options()).sort({ _id: 1 }).limit(input.limit + 1).toArray();

      const page = docs.slice(0, input.limit);
      for (const doc of page) {
        await this.sweepMetadataDoc(doc, input.userId, input.now, nowMs);
      }

      if (docs.length > input.limit && page.length > 0) {
        const lastId = String(page[page.length - 1]._id);
        return {
          nextCursor: encodeMultiCalendarCursor({
            v: 2, userId: input.userId, collection: 'metadata', after: lastId,
          }),
        };
      }

      // Metadata collection is exhausted for this cursor stream; check if integration_connections has records
      const connDoc = await this.store.collection('integration_connections').findOne({
        userId: input.userId, provider: 'google-calendar',
      }, this.store.options());
      if (connDoc) {
        return {
          nextCursor: encodeMultiCalendarCursor({
            v: 2, userId: input.userId, collection: 'integration_connections', after: '',
          }),
        };
      }
      return { nextCursor: null };
    }

    if (currentCollection === 'integration_connections') {
      const docs = await this.store.collection('integration_connections').find({
        userId: input.userId,
        provider: 'google-calendar',
        ...(after ? { _id: { $gt: after } } : {}),
      }, this.store.options()).sort({ _id: 1 }).limit(input.limit + 1).toArray();

      const page = docs.slice(0, input.limit);
      for (const doc of page) {
        await this.sweepConnectionDoc(doc, input.userId, input.now, nowMs);
      }

      if (docs.length > input.limit && page.length > 0) {
        const lastId = String(page[page.length - 1]._id);
        return {
          nextCursor: encodeMultiCalendarCursor({
            v: 2, userId: input.userId, collection: 'integration_connections', after: lastId,
          }),
        };
      }

      return { nextCursor: null };
    }

    return { nextCursor: null };
  }

  private async sweepMetadataDoc(
    doc: Document, userId: string, nowIso: string, nowMs: number,
  ): Promise<void> {
    if (doc.kind === 'calendar-source') {
      const record = decodeCalendar(calendarSourceRecordSchema, doc);
      if (record && record.source.redactedAt === null && Date.parse(record.source.expiresAt) <= nowMs) {
        await this.redactSource({
          userId: record.userId, sessionId: record.sessionId, sourceId: record.sourceId,
          reason: 'expired', now: nowIso,
        });
      }
    } else if (doc.kind === 'calendar-proposal') {
      const record = decodeCalendar(calendarProposalSchema, doc);
      if (record) {
        const proposals = new MongoCalendarProposals(this.store, this.budgets, this.clock);
        const deadline = Math.min(Date.parse(record.expiresAt), Date.parse(record.contentExpiresAt));
        if (record.state === 'pending' && nowMs >= deadline) {
          await this.redactAssistantAttempt({
            userId: record.userId, sessionId: record.sessionId, turnId: record.originatingTurnId,
            attemptId: record.originatingAttemptId, now: nowIso,
          });
          const outcome = await proposals.tombstone({
            expectedRevision: record.revision,
            tombstone: {
              schemaVersion: 2,
              kind: 'calendar-proposal-tombstone',
              userId: record.userId,
              sessionId: record.sessionId,
              proposalId: record.proposalId,
              intentId: record.intentId,
              revision: record.revision + 1,
              reason: 'expired',
              operationId: null,
              canonicalActionHash: null,
              at: nowIso,
              unresolvedOperation: false,
            },
          });
          if (outcome !== 'confirmed') throw new AppError('PERSISTENCE_ERROR', 'Calendar proposal expiry could not be confirmed.', false);
        } else if (record.state === 'consumed' && nowMs >= Date.parse(record.contentExpiresAt)) {
          let unresolved = true;
          if (record.consumedBy?.operationId) {
            const opRaw = await this.store.collection('metadata').findOne({
              kind: 'calendar-operation',
              userId: record.userId,
              operationId: record.consumedBy.operationId,
            }, this.store.options());
            if (opRaw) {
              const op = decodeCalendar(compatibleCalendarOperationSchema, opRaw);
              if (op && ['succeeded', 'definitely-failed', 'failed', 'cancelled', 'evidence-expired'].includes(op.state)) {
                unresolved = false;
              }
            }
          }
          await this.redactAssistantAttempt({
            userId: record.userId, sessionId: record.sessionId, turnId: record.originatingTurnId,
            attemptId: record.originatingAttemptId, now: nowIso,
          });
          const outcome = await proposals.tombstone({
            expectedRevision: record.revision,
            tombstone: {
              schemaVersion: 2,
              kind: 'calendar-proposal-tombstone',
              userId: record.userId,
              sessionId: record.sessionId,
              proposalId: record.proposalId,
              intentId: record.intentId,
              revision: record.revision + 1,
              reason: 'consumed',
              operationId: record.consumedBy?.operationId ?? null,
              canonicalActionHash: record.consumedBy?.canonicalActionHash ?? null,
              at: nowIso,
              unresolvedOperation: unresolved,
            },
          });
          if (outcome !== 'confirmed') throw new AppError('PERSISTENCE_ERROR', 'Calendar proposal expiry could not be confirmed.', false);
        } else if ((record.state === 'cancelled' || record.state === 'superseded') && nowMs >= Date.parse(record.contentExpiresAt)) {
          await this.redactAssistantAttempt({
            userId: record.userId, sessionId: record.sessionId, turnId: record.originatingTurnId,
            attemptId: record.originatingAttemptId, now: nowIso,
          });
          const outcome = await proposals.tombstone({
            expectedRevision: record.revision,
            tombstone: {
              schemaVersion: 2,
              kind: 'calendar-proposal-tombstone',
              userId: record.userId,
              sessionId: record.sessionId,
              proposalId: record.proposalId,
              intentId: record.intentId,
              revision: record.revision + 1,
              reason: record.state,
              operationId: null,
              canonicalActionHash: null,
              at: nowIso,
              unresolvedOperation: false,
            },
          });
          if (outcome !== 'confirmed') throw new AppError('PERSISTENCE_ERROR', 'Calendar proposal expiry could not be confirmed.', false);
        }
      }
    } else if (doc.kind === 'calendar-operation') {
      const record = decodeCalendar(compatibleCalendarOperationSchema, doc);
      if (record && record.schemaVersion === 2) {
        const redacted = redactCalendarOperation(record, nowMs);
        if (!isDeepStrictEqual(redacted, record)) {
          const operations = new MongoCalendarOperations(this.store, this.budgets, this.clock);
          const outcome = await operations.v2.compareAndSwap({
            expectedRevision: record.revision,
            next: {
              ...redacted,
              revision: record.revision + 1,
              sequence: record.sequence + 1,
              updatedAt: nowIso,
            },
          });
          if (outcome.outcome !== 'confirmed') throw new AppError('PERSISTENCE_ERROR', 'Calendar operation expiry could not be confirmed.', false);
          await this.redactAssistantAttempt({
            userId: record.userId, sessionId: record.sessionId, turnId: record.turnId,
            attemptId: record.originatingAttemptId, now: nowIso,
          });
        }
      }
    } else if (doc.kind === 'calendar-model-decision') {
      const record = decodeCalendar(compatibleSkillDecisionRecordSchema, doc);
      if (record) {
        const redacted = redactCalendarDecision(record, nowMs);
        if (!isDeepStrictEqual(redacted, record)) {
          const writeSchema = redacted.schemaVersion === 3 ? resumableSkillDecisionSchema
            : redacted.schemaVersion === 2 ? resumableDecisionV2Schema : resumableDecisionSchema;
          await this.replaceInvalidatedRecord('metadata', writeSchema, redacted, doc, this.budgets.maxDocumentBytes);
          await this.redactAssistantAttempt({
            userId: record.userId, sessionId: record.sessionId, turnId: record.turnId,
            attemptId: record.attemptId, now: nowIso,
          });
        }
      }
    } else if (doc.kind === 'calendar-tool-result') {
      const record = decodeCalendar(compatibleSkillResultRecordSchema, doc);
      if (record && record.schemaVersion !== 3) {
        const redacted = redactCalendarResult(record, nowMs);
        if (!isDeepStrictEqual(redacted, record)) {
          const writeSchema = redacted.schemaVersion === 2 ? calendarToolResultRecordV2Schema : calendarToolResultRecordSchema;
          await this.replaceInvalidatedRecord('metadata', writeSchema, redacted, doc, this.budgets.maxDocumentBytes);
          await this.redactAssistantAttempt({
            userId: record.userId, sessionId: record.sessionId, turnId: record.turnId,
            attemptId: record.attemptId, now: nowIso,
          });
        }
      }
    }
  }

  private async sweepConnectionDoc(
    doc: Document, userId: string, nowIso: string, nowMs: number,
  ): Promise<void> {
    const record = decodeCalendar(compatibleCalendarConnectionSchema, doc);
    if (!record || record.schemaVersion !== 2) return;

    const connections = new MongoCalendarConnections(this.store, this.budgets);

    // 1. Discovery snapshot retention expiry
    if (record.discovery !== null && Date.parse(record.discovery.retentionExpiresAt) <= nowMs) {
      await connections.v2.compareAndSwap({
        userId,
        expectedRevision: record.revision,
        expectedConnectionRevision: record.connectionRevision,
        expectedDefaultSettingRevision: record.defaultSetting.defaultSettingRevision,
        next: {
          ...record,
          revision: record.revision + 1,
          discovery: null,
          updatedAt: nowIso,
        },
      });
      return;
    }

    // 2. Disconnect cleanup scoped by user and original connection ID/revision
    if (record.status === 'disconnected') {
      if (record.discovery !== null || record.credentials !== null || record.enabled) {
        await connections.v2.compareAndSwap({
          userId,
          expectedRevision: record.revision,
          expectedConnectionRevision: record.connectionRevision,
          expectedDefaultSettingRevision: record.defaultSetting.defaultSettingRevision,
          next: {
            ...record,
            revision: record.revision + 1,
            credentials: null,
            enabled: false,
            discovery: null,
            updatedAt: nowIso,
          },
        });
      }
    }
  }

  private async redactDerived(userId: string, nowMs: number): Promise<void> {
    const messages = await this.store.collection('messages').find({ userId }, this.store.options()).limit(50).toArray();
    for (const doc of messages) {
      const record = decodeCalendar(messageRecordSchema, doc);
      if (!record || !doc._id) continue;
      const redacted = redactCalendarMessage(record, nowMs);
      if (redacted === record) continue;
      const { doc: next } = encodeCalendar(messageRecordSchema, redacted, String(doc._id), this.budgets.maxMessageBytes);
      next._revision = Number(doc._revision) + 1;
      await this.store.collection('messages').replaceOne({ _id: doc._id, userId, _revision: doc._revision }, next, this.store.options());
    }
    const metadata = await this.store.collection('metadata').find({
      userId, kind: { $in: ['calendar-model-decision', 'calendar-tool-result'] },
    }, this.store.options()).limit(50).toArray();
    for (const doc of metadata) {
      if (doc.kind === 'calendar-model-decision') {
        const record = decodeCalendar(compatibleSkillDecisionRecordSchema, doc);
        if (!record) continue;
        const redacted = redactCalendarDecision(record, nowMs);
        if (redacted === record) continue;
        const writeSchema = redacted.schemaVersion === 3 ? resumableSkillDecisionSchema
          : redacted.schemaVersion === 2 ? resumableDecisionV2Schema : resumableDecisionSchema;
        const { doc: next } = encodeCalendar(writeSchema, redacted, String(doc._id), this.budgets.maxDocumentBytes);
        next._revision = Number(doc._revision) + 1;
        await this.store.collection('metadata').replaceOne({ _id: doc._id, userId, _revision: doc._revision }, next, this.store.options());
      } else if (doc.kind === 'calendar-tool-result') {
        const record = decodeCalendar(compatibleSkillResultRecordSchema, doc);
        if (!record || record.schemaVersion === 3) continue;
        const redacted = redactCalendarResult(record, nowMs);
        if (redacted === record) continue;
        const writeSchema = redacted.schemaVersion === 2 ? calendarToolResultRecordV2Schema : calendarToolResultRecordSchema;
        const { doc: next } = encodeCalendar(writeSchema, redacted, String(doc._id), this.budgets.maxDocumentBytes);
        next._revision = Number(doc._revision) + 1;
        await this.store.collection('metadata').replaceOne({ _id: doc._id, userId, _revision: doc._revision }, next, this.store.options());
      }
    }
  }
}
