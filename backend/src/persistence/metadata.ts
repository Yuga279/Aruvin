/**
 * ============================================================================
 * FILE: metadata.ts
 * LOCATION: backend/src/persistence/metadata.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Persist immutable attempts, CAS status changes, and bounded accounting.
 *
 * ROLE IN PROJECT:
 *    Keeps attempt/accounting evidence in the metadata collection with generation
 *    mapping and acceptance-marker reads, without performing inference.
 *
 * KEY COMPONENTS:
 *    - MongoMetadata.putAttempt: Idempotent attempt insertion by request identity.
 *    - MongoMetadata.compareAttempt: Allowed-status CAS without mutating acceptance.
 *    - MongoMetadata.putAccounting: Non-regressing usage/cost evidence.
 *    - MongoMetadata.putVoiceAccounting: Scoped socket/speech admission and terminal evidence.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { Filter } from 'mongodb';
import {
  attemptRecordSchema,
  type AttemptRecord,
  type AttemptStatus,
} from '../contracts/attempt.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import { messageRecordSchema, type MessageRecord } from '../contracts/message.js';
import {
  accountingRecordSchema,
  type AccountingRecord,
} from '../contracts/metadata.js';
import type { AccountingReportingRepository, MetadataRepository, PageQuery } from '../contracts/repositories.js';
import {
  voiceDeliveryRecordSchema,
  type VoiceDeliveryRecord,
} from '../contracts/voice.js';
import { AppError } from '../platform/errors/app-error.js';
import { cursor, page } from './pagination.js';
import {
  inspectConfirmedRecord,
  type CasConfirmation,
  type ConfirmedRecord,
} from './confirmed-record.js';
import {
  acceptanceSchema,
  bounded,
  decode,
  generationSchema,
  key,
  safeSequence,
  type StoredDocument,
} from './records.js';
import { RecordStore } from './store.js';

export type VoiceDeliveryLinkage = {
  attempt: ConfirmedRecord<AttemptRecord>;
  input: ConfirmedRecord<MessageRecord>;
};
import { voiceAccountingRecordSchema, type VoiceAccountingRecord } from '../contracts/voice-accounting.js';
import type { MoneyEvidence, TimingEvidence } from '../contracts/usage-evidence.js';
import type { AccountingQuery } from '../contracts/accounting-reporting.js';
import { accountingCursor, accountingRecordFilter, checkedAccountingQuery, readAccountingTotals } from './accounting-reporting.js';
import { migrateAccountingPage, type AccountingMigrationQuery } from '../operations/accounting-migration.js';

function evidenceRegresses(old: AccountingRecord, value: AccountingRecord): boolean {
  if (old.money) {
    if (!value.money) return true;
    if (old.money.costStatus === 'known' && value.money.costStatus !== 'known') return true;
    for (const field of ['reportedAmount', 'estimatedAmount', 'pricing'] as const)
      if (old.money[field] !== null && !isDeepStrictEqual(old.money[field], value.money[field])) return true;
    if (old.money.reportedAmount !== null || old.money.estimatedAmount !== null)
      for (const field of ['source', 'observedAt', 'currency'] satisfies (keyof MoneyEvidence)[])
        if (old.money[field] !== value.money[field]) return true;
  }
  for (const field of ['cachedPromptTokens', 'cacheWriteTokens', 'reasoningOutputTokens'] as const)
    if (old[field] !== undefined && old[field] !== null && old[field] !== value[field]) return true;
  if (old.timing) {
    if (!value.timing) return true;
    for (const field of Object.keys(old.timing) as (keyof TimingEvidence)[]) {
      if (old.timing[field] === null) continue;
      if (field === 'dispatchCount') {
        if (value.timing.dispatchCount === null || value.timing.dispatchCount < old.timing.dispatchCount!) return true;
      } else if (old.timing[field] !== value.timing[field]) return true;
    }
  }
  return false;
}

export class MongoMetadata implements MetadataRepository, AccountingReportingRepository {
  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
  ) {}

  async accountingTotals(query: AccountingQuery) {
    return readAccountingTotals(this.store, checkedAccountingQuery(query, this.budgets.maxPageSize));
  }

  migrateAccountingPage(query: AccountingMigrationQuery) {
    return migrateAccountingPage(this.store, this.budgets, query);
  }

  async listAccounting(query: AccountingQuery & { userId: string }) {
    const q = checkedAccountingQuery(query, this.budgets.maxPageSize);
    const docs = await this.store.collection('metadata').find(accountingRecordFilter(q), this.store.options())
      .sort({ startedAt: 1, _id: 1 }).limit(q.limit + 1).toArray();
    const items = docs.slice(0, q.limit).map(doc => doc.kind === 'accounting'
      ? decode(accountingRecordSchema, doc)! : decode(voiceAccountingRecordSchema, doc)!);
    const last = docs.slice(0, q.limit).at(-1);
    return { items, nextCursor: docs.length > q.limit && last
      ? accountingCursor(q, 'accounting-records', last.startedAt as string, last._id) : null };
  }

  getVoiceAccounting(userId: string, sessionId: string, usageId: string) {
    return this.store.read('metadata', voiceAccountingRecordSchema, {
      _id: key('voice-accounting', userId, sessionId, usageId),
      kind: 'voice-accounting', userId, sessionId, usageId,
    });
  }

  async putVoiceAccounting(value: VoiceAccountingRecord): Promise<void> {
    const id = key('voice-accounting', value.userId, value.sessionId, value.usageId);
    const { record } = bounded(voiceAccountingRecordSchema, value, id, this.budgets.maxDocumentBytes);
    const doc = await this.store.raw('metadata', { _id: id, kind: record.kind,
      userId: record.userId, sessionId: record.sessionId });
    const old = decode(voiceAccountingRecordSchema, doc);
    if (!old) {
      if (record.status !== 'pending') throw new AppError('INVALID_REQUEST', 'Voice accounting must start pending.');
      if (record.responseId !== null) {
        const socket = await this.getVoiceAccounting(record.userId, record.sessionId, record.providerSocketId);
        if (!socket || socket.responseId !== null || socket.status !== 'pending'
          || socket.model !== record.model || socket.userTag !== record.userTag)
          throw new AppError('INVALID_REQUEST', 'Voice accounting socket linkage is invalid.');
      }
      await this.store.insert('metadata', voiceAccountingRecordSchema, record, id, this.budgets.maxDocumentBytes);
      return;
    }
    if (isDeepStrictEqual(old, record)) return;
    const binding = (r: VoiceAccountingRecord) => [r.userId, r.sessionId, r.voiceSessionId,
      r.conversationId, r.usageId, r.providerSocketId, r.userTag, r.provider, r.model,
      r.turnId, r.responseId, r.startedAt];
    if (!isDeepStrictEqual(binding(old), binding(record)) || old.status !== 'pending'
      || record.status === 'pending' || !doc)
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Voice accounting evidence cannot be replaced.');
    if (!(await this.store.replace('metadata', voiceAccountingRecordSchema, record, id,
      doc._revision, this.budgets.maxDocumentBytes)))
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Voice accounting changed while saving.');
  }

  async putAttemptConfirmed(record: AttemptRecord): Promise<ConfirmedRecord<AttemptRecord>> {
    const byId = await this.getAttempt(record.userId, record.sessionId, record.attemptId);
    if (byId && byId.idempotencyKey !== record.idempotencyKey) {
      throw new AppError(
        'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'Attempt identity is already used.',
      );
    }
    return this.store.insertConfirmed(
      'metadata',
      attemptRecordSchema,
      record,
      key('attempt', record.userId, record.sessionId, record.idempotencyKey),
      this.budgets.maxDocumentBytes,
    );
  }

  async putAttempt(record: AttemptRecord): Promise<void> {
    await this.putAttemptConfirmed(record);
  }

  getAttemptConfirmed(
    userId: string,
    sessionId: string,
    attemptId: string,
  ): Promise<ConfirmedRecord<AttemptRecord> | null> {
    return this.store.readConfirmed('metadata', attemptRecordSchema, {
      kind: 'attempt',
      userId,
      sessionId,
      attemptId,
    });
  }

  getAttempt(userId: string, sessionId: string, attemptId: string) {
    return this.store.read('metadata', attemptRecordSchema, {
      kind: 'attempt',
      userId,
      sessionId,
      attemptId,
    });
  }

  getAttemptByIdempotency(userId: string, sessionId: string, idempotencyKey: string) {
    return this.store.read('metadata', attemptRecordSchema, {
      _id: key('attempt', userId, sessionId, idempotencyKey),
      kind: 'attempt',
      userId,
      sessionId,
      idempotencyKey,
    });
  }

  async compareAttemptConfirmed(
    expected: ConfirmedRecord<AttemptRecord>,
    record: AttemptRecord,
  ): Promise<CasConfirmation<AttemptRecord>> {
    const envelope = inspectConfirmedRecord<AttemptRecord>(expected, {
      store: this.store,
      collection: 'metadata',
    });
    const old = envelope.canonical;
    const id = key('attempt', old.userId, old.sessionId, old.idempotencyKey);
    if (envelope.id !== id) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence receipt.');
    }
    if (isDeepStrictEqual(old, record)) {
      return { outcome: 'confirmed', receipt: expected };
    }
    const immutable = (value: AttemptRecord) => {
      const {
        status,
        updatedAt,
        generationId,
        truncated,
        errorCode,
        ...rest
      } = value;
      void status;
      void updatedAt;
      void generationId;
      void truncated;
      void errorCode;
      return rest;
    };
    if (!isDeepStrictEqual(immutable(old), immutable(record))) {
      throw new AppError(
        'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'Accepted attempt identity cannot change.',
      );
    }
    const allowed: Record<AttemptStatus, AttemptStatus[]> = {
      accepted: ['generating', 'failed', 'cancelled', 'interrupted'],
      generating: ['generating', 'finalizing', 'failed', 'cancelled', 'interrupted'],
      finalizing: [
        'finalizing',
        'completed',
        'truncated',
        'failed',
        'cancelled',
        'interrupted',
      ],
      completed: [],
      truncated: [],
      failed: [],
      cancelled: [],
      interrupted: [],
    };
    if (
      !allowed[old.status].includes(record.status) ||
      record.truncated !== (record.status === 'truncated') ||
      (old.generationId !== null && old.generationId !== record.generationId)
    ) {
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Invalid attempt transition.');
    }
    return this.store.replaceConfirmed(
      expected,
      attemptRecordSchema,
      record,
      this.budgets.maxDocumentBytes,
    );
  }

  async compareAttempt(
    record: AttemptRecord,
    expectedStatus: AttemptStatus,
  ): Promise<boolean> {
    const id = key('attempt', record.userId, record.sessionId, record.idempotencyKey);
    const prior = await this.store.readConfirmed('metadata', attemptRecordSchema, {
      _id: id,
      kind: 'attempt',
      userId: record.userId,
      sessionId: record.sessionId,
    });
    if (!prior) {
      return false;
    }
    const old = prior.record;
    if (isDeepStrictEqual(old, record)) {
      return true;
    }
    const immutable = (value: AttemptRecord) => {
      const {
        status,
        updatedAt,
        generationId,
        truncated,
        errorCode,
        ...rest
      } = value;
      void status;
      void updatedAt;
      void generationId;
      void truncated;
      void errorCode;
      return rest;
    };
    if (!isDeepStrictEqual(immutable(old), immutable(record))) {
      throw new AppError(
        'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'Accepted attempt identity cannot change.',
      );
    }
    if (old.status !== expectedStatus) {
      return false;
    }
    const result = await this.compareAttemptConfirmed(prior, record);
    return result.outcome === 'confirmed';
  }

  async putAccountingConfirmed(
    record: AccountingRecord,
    expected?: ConfirmedRecord<AccountingRecord>,
  ): Promise<ConfirmedRecord<AccountingRecord>> {
    const value = accountingRecordSchema.parse(record);
    for (const tokens of [value.promptTokens, value.completionTokens]) {
      if (tokens !== null) {
        safeSequence(tokens);
      }
    }
    if (value.cost !== null && !Number.isFinite(value.cost)) {
      throw new AppError('INVALID_REQUEST', 'Invalid accounting cost.');
    }
    const linked = await this.getAttempt(value.userId, value.sessionId, value.attemptId);
    if (!linked || linked.turnId !== value.turnId || linked.modelId !== value.requestedModel) {
      throw new AppError('INVALID_REQUEST', 'Accounting attempt linkage is invalid.');
    }
    if (
      value.accountingStatus === 'known' &&
      (value.cost === null ||
        value.promptTokens === null ||
        value.completionTokens === null)
    ) {
      throw new AppError('INVALID_REQUEST', 'Known accounting needs complete usage.');
    }
    if (value.generationId) {
      const claim = await this.store.read('metadata', generationSchema, {
        kind: 'generation',
        userId: value.userId,
        generationId: value.generationId,
      });
      if (
        claim &&
        (claim.sessionId !== value.sessionId || claim.attemptId !== value.attemptId)
      ) {
        throw new AppError(
          'IDEMPOTENCY_PAYLOAD_MISMATCH',
          'Generation is already assigned to another attempt.',
        );
      }
      await this.store.insert(
        'metadata',
        generationSchema,
        {
          schemaVersion: 1,
          kind: 'generation',
          userId: value.userId,
          sessionId: value.sessionId,
          attemptId: value.attemptId,
          generationId: value.generationId,
        },
        key('generation', value.userId, value.generationId),
        this.budgets.maxDocumentBytes,
      );
    }
    const id = key('accounting', value.userId, value.sessionId, value.attemptId);
    const prior = expected !== undefined
      ? (() => {
          inspectConfirmedRecord<AccountingRecord>(expected, {
            store: this.store,
            collection: 'metadata',
            id,
          });
          return expected;
        })()
      : await this.getAccountingConfirmed(value.userId, value.sessionId, value.attemptId);
    if (!prior) {
      return this.store.insertConfirmed(
        'metadata',
        accountingRecordSchema,
        value,
        id,
        this.budgets.maxDocumentBytes,
      );
    }
    const old = prior.record;
    if (isDeepStrictEqual(old, value)) {
      return prior;
    }
    if (
      old.turnId !== value.turnId ||
      evidenceRegresses(old, value) ||
      old.requestedModel !== value.requestedModel ||
      old.startedAt !== value.startedAt ||
      (
        [
          'generationId',
          'promptTokens',
          'completionTokens',
          'cost',
          'reportedModel',
          'reportedProvider',
        ] as const
      ).some((field) => old[field] !== null && old[field] !== value[field]) ||
      (old.accountingStatus === 'known' && value.accountingStatus !== 'known') ||
      (old.endedAt !== null && old.endedAt !== value.endedAt)
    ) {
      throw new AppError(
        'CONFLICT_ACTIVE_TURN',
        'Accounting evidence cannot be replaced.',
      );
    }
    const replaced = await this.store.replaceConfirmed(
      prior,
      accountingRecordSchema,
      value,
      this.budgets.maxDocumentBytes,
    );
    if (replaced.outcome !== 'confirmed') {
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Accounting changed while saving.');
    }
    return replaced.receipt;
  }

  async putAccounting(record: AccountingRecord): Promise<void> {
    await this.putAccountingConfirmed(record);
  }

  getAccountingConfirmed(
    userId: string,
    sessionId: string,
    attemptId: string,
  ): Promise<ConfirmedRecord<AccountingRecord> | null> {
    return this.store.readConfirmed('metadata', accountingRecordSchema, {
      _id: key('accounting', userId, sessionId, attemptId),
      userId,
      sessionId,
      kind: 'accounting',
    });
  }

  getAccounting(userId: string, sessionId: string, attemptId: string) {
    return this.store.read('metadata', accountingRecordSchema, {
      _id: key('accounting', userId, sessionId, attemptId),
      userId,
      sessionId,
    });
  }

  getAcceptance(userId: string, sessionId: string, attemptId: string) {
    return this.store.read('metadata', acceptanceSchema, {
      _id: key('acceptance', userId, sessionId, attemptId),
      userId,
      sessionId,
    });
  }

  async getAcceptances(userId: string, sessionId: string, attemptIds: readonly string[]) {
    if (attemptIds.length > 500) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Too many acceptance records.');
    if (!attemptIds.length) return [];
    const docs = await this.store.collection('metadata').find({ userId, sessionId, kind: 'acceptance',
      _id: { $in: attemptIds.map(id => key('acceptance', userId, sessionId, id)) },
    }, this.store.options()).limit(attemptIds.length).toArray();
    return docs.map(doc => decode(acceptanceSchema, doc)!);
  }

  async latestAttempt(userId: string, sessionId: string, turnId: string) {
    const docs = await this.store.collection('metadata').find({ userId, sessionId, turnId, kind: 'attempt' },
      this.store.options()).sort({ sequence: -1, attemptId: -1 }).limit(1).toArray();
    return docs.length ? decode(attemptRecordSchema, docs[0]) : null;
  }

  async listAttempts(userId: string, sessionId: string, query: PageQuery) {
    const { limit, after } = page(
      query,
      'attempts',
      userId,
      sessionId,
      this.budgets.maxPageSize,
    );
    const filter: Filter<StoredDocument> = { userId, sessionId, kind: 'attempt' };
    if (after) {
      filter.$or = [
        { sequence: { $lt: after.value } },
        { sequence: after.value, attemptId: { $lt: after.id } },
      ];
    }
    const docs = await this.store
      .collection('metadata')
      .find(filter, this.store.options())
      .sort({ sequence: -1, attemptId: -1 })
      .limit(limit + 1)
      .toArray();
    const items = docs.slice(0, limit).map((doc) => decode(attemptRecordSchema, doc)!);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        docs.length > limit && last
          ? cursor({
              kind: 'attempts',
              userId,
              sessionId,
              value: last.sequence,
              id: last.attemptId,
            })
          : null,
    };
  }

  getVoiceDelivery(userId: string, sessionId: string, attemptId: string) {
    return this.store.read('metadata', voiceDeliveryRecordSchema, {
      _id: key('voice-delivery', userId, sessionId, attemptId),
      kind: 'voice-delivery',
      userId,
      sessionId,
      attemptId,
    });
  }

  async getVoiceDeliveries(userId: string, sessionId: string, attemptIds: readonly string[]) {
    if (attemptIds.length > 500) throw new AppError('CONTEXT_BUDGET_EXCEEDED', 'The selected history is too large.');
    if (!attemptIds.length) return [];
    const docs = await this.store.collection('metadata').find({ userId, sessionId, kind: 'voice-delivery',
      _id: { $in: attemptIds.map(id => key('voice-delivery', userId, sessionId, id)) },
    }, this.store.options()).limit(attemptIds.length).toArray();
    return docs.map(doc => decode(voiceDeliveryRecordSchema, doc)!);
  }

  private async checkedDelivery(value: VoiceDeliveryRecord, linkage?: VoiceDeliveryLinkage) {
    const id = key('voice-delivery', value.userId, value.sessionId, value.attemptId);
    const { record } = bounded(
      voiceDeliveryRecordSchema,
      value,
      id,
      this.budgets.maxDocumentBytes,
    );
    const proof = linkage ? inspectConfirmedRecord<AttemptRecord>(linkage.attempt,
      { store: this.store, collection: 'metadata' }) : null;
    const attempt = proof?.canonical ?? await this.getAttempt(record.userId, record.sessionId, record.attemptId);
    if (!attempt || attempt.kind !== 'attempt' || attempt.userId !== record.userId || attempt.sessionId !== record.sessionId ||
      attempt.attemptId !== record.attemptId || attempt.turnId !== record.turnId ||
      (proof && proof.id !== key('attempt', record.userId, record.sessionId, attempt.idempotencyKey))) {
      throw new AppError('INVALID_REQUEST', 'Voice delivery linkage is invalid.');
    }
    const inputId = key('message', record.userId, record.sessionId, attempt.causal.userMessageId);
    const input = linkage ? inspectConfirmedRecord<MessageRecord>(linkage.input,
      { store: this.store, collection: 'messages', id: inputId }).canonical
      : await this.store.read('messages', messageRecordSchema, {
        _id: inputId,
        userId: record.userId,
        sessionId: record.sessionId,
      });
    if (
      !input ||
      input.userId !== record.userId ||
      input.sessionId !== record.sessionId ||
      input.messageId !== attempt.causal.userMessageId ||
      input.role !== 'user' ||
      input.turnId !== record.turnId ||
      input.visibility !== 'internal' ||
      input.mode !== 'live'
    ) {
      throw new AppError('INVALID_REQUEST', 'Voice delivery linkage is invalid.');
    }
    return { record, id };
  }

  async putVoiceDelivery(value: VoiceDeliveryRecord, linkage?: VoiceDeliveryLinkage): Promise<void> {
    const { record, id } = await this.checkedDelivery(value, linkage);
    if (record.status !== 'pending') {
      throw new AppError('INVALID_REQUEST', 'Initial voice delivery must be pending.');
    }
    await this.store.insert(
      'metadata',
      voiceDeliveryRecordSchema,
      record,
      id,
      this.budgets.maxDocumentBytes,
    );
  }

  async compareVoiceDelivery(
    value: VoiceDeliveryRecord,
    expectedSequence: number,
    linkage?: VoiceDeliveryLinkage,
  ): Promise<boolean> {
    safeSequence(expectedSequence);
    const { record, id } = await this.checkedDelivery(value, linkage);
    const doc = await this.store.raw('metadata', {
      _id: id,
      kind: 'voice-delivery',
      userId: record.userId,
      sessionId: record.sessionId,
      attemptId: record.attemptId,
    });
    const old = decode(voiceDeliveryRecordSchema, doc);
    if (!old || !doc) return false;
    if (isDeepStrictEqual(old, record)) return true;
    const binding = (v: VoiceDeliveryRecord) => [
      v.schemaVersion,
      v.kind,
      v.userId,
      v.sessionId,
      v.voiceSessionId,
      v.turnId,
      v.attemptId,
      v.responseId,
      v.providerSocketId,
      v.createdAt,
    ];
    if (!isDeepStrictEqual(binding(old), binding(record))) {
      throw new AppError(
        'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'Voice delivery identity cannot change.',
      );
    }
    if (old.sequence !== expectedSequence || record.sequence <= old.sequence) return false;
    const regress = (before: number | null, after: number | null) =>
      before !== null && (after === null || after < before);
    if (
      !['pending', 'unknown'].includes(old.status) ||
      record.eventId === old.eventId ||
      (old.status === 'unknown' && record.status === 'pending') ||
      record.updatedAt < old.updatedAt ||
      (old.speechId !== null && old.speechId !== record.speechId) ||
      regress(old.audioDurationMs, record.audioDurationMs) ||
      regress(old.audioPlayedMs, record.audioPlayedMs) ||
      regress(old.playedSamples, record.playedSamples) ||
      (old.textSpoken !== null &&
        (record.textSpoken === null || !record.textSpoken.startsWith(old.textSpoken))) ||
      (old.status === 'pending'
        ? !record.textGenerated.startsWith(old.textGenerated)
        : record.textGenerated !== old.textGenerated) ||
      (record.status === 'completed' &&
        (record.textSpoken !== record.textGenerated ||
          record.audioDurationMs === null ||
          record.audioPlayedMs !== record.audioDurationMs))
    ) {
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Invalid voice delivery transition.');
    }
    return this.store.replace(
      'metadata',
      voiceDeliveryRecordSchema,
      record,
      id,
      doc._revision,
      this.budgets.maxDocumentBytes,
    );
  }
}
