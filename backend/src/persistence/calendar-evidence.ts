/**
 * ============================================================================
 * FILE: calendar-evidence.ts
 * LOCATION: backend/src/persistence/calendar-evidence.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Persistence adapter for Google Calendar model decisions and tool results.
 *
 * ROLE IN PROJECT:
 *    Stores and retrieves model decisions and tool results in the metadata collection
 *    supporting both v1 legacy and v2 multi-calendar formats with automatic redaction.
 *
 * KEY COMPONENTS:
 *    - MongoCalendarDecisions: Stores resumable and rejected decisions with .v2 facade.
 *    - MongoCalendarResults: Stores tool result records with .v2 facade.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { Document } from 'mongodb';
import type { BudgetConfig } from '../contracts/budgets.js';
import {
  rejectedDecisionSchema,
  rejectedDecisionV2Schema,
  resumableDecisionSchema,
  resumableDecisionV2Schema,
  resumableSkillDecisionSchema,
  type CalendarRejectedDecision,
  type CalendarRejectedDecisionV2,
  type CalendarDecisionStore,
  type CalendarDecisionStoreV2,
  type ResumableCalendarDecision,
  type ResumableCalendarDecisionV2,
  type ResumableSkillDecision,
  type SkillDecisionStore,
} from '../contracts/calendar-model.js';
import {
  calendarToolResultRecordSchema,
  calendarToolResultRecordV2Schema,
  localSkillResultRecordSchema,
  type CalendarResultStore,
  type CalendarResultStoreV2,
  type CalendarToolResultRecord,
  type CalendarToolResultRecordV2,
  type SkillResultStore,
} from '../contracts/calendar-sources.js';
import {
  compatibleCalendarDecisionSchema,
  compatibleCalendarResultRecordSchema,
  compatibleSkillDecisionRecordSchema,
  compatibleSkillResultRecordSchema,
} from '../contracts/calendar-compatibility.js';
import { AppError } from '../platform/errors/app-error.js';
import {
  calendarSourceExpired,
  decisionKey,
  decodeCalendar,
  encodeCalendar,
  readCurrentCalendarAccountBinding,
  requireCalendarAccountRevision,
  redactCalendarDecision,
  redactCalendarDecisionForAccount,
  redactCalendarResult,
  redactCalendarResultForAccount,
  resultKey,
  sameCalendarAccountBinding,
} from './calendar-records.js';
import { RecordStore } from './store.js';
import { z } from 'zod';

async function replaceStaleEvidence(
  store: RecordStore,
  schema: z.ZodTypeAny,
  value: unknown,
  id: string,
  old: Document,
  limit: number,
): Promise<void> {
  const { record, doc } = encodeCalendar(schema, value, id, limit);
  doc._revision = Number(old._revision) + 1;
  try {
    const result = await store.collection('metadata').replaceOne(
      { _id: id, userId: old.userId, _revision: old._revision }, doc, store.options(),
    );
    if (result.matchedCount === 1) return;
  } catch {
    /* Confirm an ambiguous replacement by exact reread below. */
  }
  const saved = await store.raw('metadata', { _id: id, userId: old.userId });
  const decoded = decodeCalendar(schema, saved);
  if (Number(saved?._revision) >= doc._revision && decoded && isDeepStrictEqual(decoded, record)) return;
  throw new AppError('PERSISTENCE_ERROR', 'Stale Calendar evidence redaction could not be confirmed.', false);
}

function staleAccountError(): AppError {
  return new AppError('INVALID_REQUEST', 'Calendar account revision is no longer current.', false);
}

export class MongoCalendarDecisions implements CalendarDecisionStore {
  readonly v2: CalendarDecisionStoreV2 = {
    put: (record) => this.putV2(record),
    get: (userId, decisionId) => this.getV2(userId, decisionId),
    putRejected: (record) => this.putRejectedV2(record),
  };

  readonly skills: SkillDecisionStore = {
    put: async (record) => {
      const value = redactCalendarDecision(resumableSkillDecisionSchema.parse(record), this.clock());
      // Local disclosures have no Google content or authorization side effects.
      // Source-bearing text decisions keep the existing authoritative account race check.
      const account = value.sources.length ? await requireCalendarAccountRevision(this.store, value) : null;
      await this.store.insert('metadata', resumableSkillDecisionSchema, value,
        decisionKey('calendar-model-decision', value.userId, value.decisionId), this.budgets.maxDocumentBytes);
      if (account) await this.confirmDecisionAccount(value, account);
    },
    get: async (userId, decisionId) => {
      const parsed = decodeCalendar(compatibleSkillDecisionRecordSchema,
        await this.store.raw('metadata', {
          _id: decisionKey('calendar-model-decision', userId, decisionId),
          userId, kind: 'calendar-model-decision',
        }));
      return parsed ? redactCalendarDecision(parsed, this.clock()) : null;
    },
    putRejected: (record) => this.putRejectedV2(record),
  };

  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
    readonly clock: () => number = Date.now,
  ) {}

  async put(record: ResumableCalendarDecision): Promise<void> {
    const value = this.prepareDecision(resumableDecisionSchema.parse(record));
    const account = await requireCalendarAccountRevision(this.store, value);
    await this.store.insert(
      'metadata',
      resumableDecisionSchema,
      value,
      decisionKey('calendar-model-decision', value.userId, value.decisionId),
      this.budgets.maxDocumentBytes,
    );
    await this.confirmDecisionAccount(value, account);
  }

  async get(userId: string, decisionId: string): Promise<ResumableCalendarDecision | null> {
    const raw = await this.store.raw('metadata', {
      _id: decisionKey('calendar-model-decision', userId, decisionId),
      userId,
      kind: 'calendar-model-decision',
    });
    const parsed = decodeCalendar(resumableDecisionSchema, raw);
    return parsed ? redactCalendarDecision(parsed, this.clock()) : null;
  }

  async putRejected(record: CalendarRejectedDecision): Promise<void> {
    const value = rejectedDecisionSchema.parse(record);
    const serialized = JSON.stringify(value);
    if (serialized.includes('fixture-refresh') || /"rawJson"|reasoning|providerDump/i.test(serialized)) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    await this.store.insert(
      'metadata',
      rejectedDecisionSchema,
      value,
      decisionKey('calendar-rejected-decision', value.userId, value.decisionId),
      this.budgets.maxDocumentBytes,
    );
  }

  async putV2(record: ResumableCalendarDecisionV2): Promise<void> {
    const value = this.prepareDecisionV2(resumableDecisionV2Schema.parse(record));
    const account = await requireCalendarAccountRevision(this.store, value);
    await this.store.insert(
      'metadata',
      resumableDecisionV2Schema,
      value,
      decisionKey('calendar-model-decision', value.userId, value.decisionId),
      this.budgets.maxDocumentBytes,
    );
    await this.confirmDecisionAccount(value, account);
  }

  async getV2(userId: string, decisionId: string): Promise<ResumableCalendarDecision | ResumableCalendarDecisionV2 | null> {
    const raw = await this.store.raw('metadata', {
      _id: decisionKey('calendar-model-decision', userId, decisionId),
      userId,
      kind: 'calendar-model-decision',
    });
    const parsed = decodeCalendar(compatibleCalendarDecisionSchema, raw);
    return parsed ? redactCalendarDecision(parsed, this.clock()) : null;
  }

  async putRejectedV2(record: CalendarRejectedDecisionV2): Promise<void> {
    const value = rejectedDecisionV2Schema.parse(record);
    const serialized = JSON.stringify(value);
    if (serialized.includes('fixture-refresh') || /"rawJson"|reasoning|providerDump/i.test(serialized)) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    await this.store.insert(
      'metadata',
      rejectedDecisionV2Schema,
      value,
      decisionKey('calendar-rejected-decision', value.userId, value.decisionId),
      this.budgets.maxDocumentBytes,
    );
  }

  private prepareDecision(record: ResumableCalendarDecision): ResumableCalendarDecision {
    const nowMs = this.clock();
    if (record.sources.some((source) => !source.permission.minimalEvidenceAllowed
      || calendarSourceExpired(source, nowMs))) {
      return redactCalendarDecision({ ...record, decision: null }, nowMs);
    }
    return record;
  }

  private prepareDecisionV2(record: ResumableCalendarDecisionV2): ResumableCalendarDecisionV2 {
    const nowMs = this.clock();
    if (record.sources.some((source) => !source.permission.minimalEvidenceAllowed
      || calendarSourceExpired(source, nowMs))) {
      return redactCalendarDecision({ ...record, decision: null }, nowMs);
    }
    return record;
  }

  private async confirmDecisionAccount(
    value: ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision,
    account: Awaited<ReturnType<typeof requireCalendarAccountRevision>>,
  ): Promise<void> {
    let current: Awaited<ReturnType<typeof readCurrentCalendarAccountBinding>>;
    try {
      current = await readCurrentCalendarAccountBinding(this.store, value.userId);
    } catch {
      await this.redactDecision(value, account);
      throw new AppError('PERSISTENCE_ERROR', 'Calendar account authority could not be confirmed.', false);
    }
    if (sameCalendarAccountBinding(current, account)) return;
    await this.redactDecision(value, account);
    throw staleAccountError();
  }

  private async redactDecision(
    value: ResumableCalendarDecision | ResumableCalendarDecisionV2 | ResumableSkillDecision,
    account: Awaited<ReturnType<typeof requireCalendarAccountRevision>>,
  ): Promise<void> {
    const id = decisionKey('calendar-model-decision', value.userId, value.decisionId);
    const raw = await this.store.raw('metadata', { _id: id, userId: value.userId });
    const saved = decodeCalendar(compatibleSkillDecisionRecordSchema, raw);
    if (!raw || !saved) return;
    const redacted = redactCalendarDecisionForAccount(saved, account, this.clock());
    const schema = redacted.schemaVersion === 3 ? resumableSkillDecisionSchema
      : redacted.schemaVersion === 2 ? resumableDecisionV2Schema : resumableDecisionSchema;
    await replaceStaleEvidence(this.store, schema, redacted, id, raw, this.budgets.maxDocumentBytes);
  }
}

export class MongoCalendarResults implements CalendarResultStore {
  readonly v2: CalendarResultStoreV2 = {
    put: (record) => this.putV2(record),
    get: (userId, sessionId, toolCallId) => this.getV2(userId, sessionId, toolCallId),
  };

  readonly skills: SkillResultStore = {
    put: async (record) => {
      if (record.schemaVersion === 2) return this.putV2(record);
      const value = localSkillResultRecordSchema.parse(record);
      await this.store.insert('metadata', localSkillResultRecordSchema, value,
        resultKey(value.userId, value.sessionId, value.toolCallId), this.budgets.maxDocumentBytes);
    },
    get: async (userId, sessionId, toolCallId) => {
      const parsed = decodeCalendar(compatibleSkillResultRecordSchema,
        await this.store.raw('metadata', { _id: resultKey(userId, sessionId, toolCallId),
          userId, sessionId, kind: 'calendar-tool-result' }));
      return !parsed || parsed.schemaVersion === 3 ? parsed : redactCalendarResult(parsed, this.clock());
    },
  };

  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
    readonly clock: () => number = Date.now,
  ) {}

  async put(record: CalendarToolResultRecord): Promise<void> {
    const value = calendarToolResultRecordSchema.parse(record);
    const account = await requireCalendarAccountRevision(this.store, {
      userId: value.userId,
      connectionId: value.resultRef.source.connectionId,
      connectionRevision: value.resultRef.source.connectionRevision,
    });
    const nowMs = this.clock();
    if (value.resultRef.storage === 'retained' && (
      value.resultRef.source.permission.content !== 'retained'
      || calendarSourceExpired(value.resultRef.source, nowMs)
    )) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    await this.store.insert(
      'metadata',
      calendarToolResultRecordSchema,
      value,
      resultKey(value.userId, value.sessionId, value.toolCallId),
      this.budgets.maxDocumentBytes,
    );
    await this.confirmResultAccount(value, account);
  }

  async get(userId: string, sessionId: string, toolCallId: string): Promise<CalendarToolResultRecord | null> {
    const raw = await this.store.raw('metadata', {
      _id: resultKey(userId, sessionId, toolCallId),
      userId, sessionId, kind: 'calendar-tool-result',
    });
    const parsed = decodeCalendar(calendarToolResultRecordSchema, raw);
    return parsed ? redactCalendarResult(parsed, this.clock()) : null;
  }

  async putV2(record: CalendarToolResultRecordV2): Promise<void> {
    const value = calendarToolResultRecordV2Schema.parse(record);
    const account = await requireCalendarAccountRevision(this.store, {
      userId: value.userId,
      connectionId: value.resultRef.source.connectionId,
      connectionRevision: value.resultRef.source.connectionRevision,
    });
    const nowMs = this.clock();
    if (value.resultRef.storage === 'retained' && (
      value.resultRef.source.permission.content !== 'retained'
      || calendarSourceExpired(value.resultRef.source, nowMs)
    )) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    await this.store.insert(
      'metadata',
      calendarToolResultRecordV2Schema,
      value,
      resultKey(value.userId, value.sessionId, value.toolCallId),
      this.budgets.maxDocumentBytes,
    );
    await this.confirmResultAccount(value, account);
  }

  async getV2(userId: string, sessionId: string, toolCallId: string): Promise<CalendarToolResultRecord | CalendarToolResultRecordV2 | null> {
    const raw = await this.store.raw('metadata', {
      _id: resultKey(userId, sessionId, toolCallId),
      userId, sessionId, kind: 'calendar-tool-result',
    });
    const parsed = decodeCalendar(compatibleCalendarResultRecordSchema, raw);
    return parsed ? redactCalendarResult(parsed, this.clock()) : null;
  }

  private async confirmResultAccount(
    value: CalendarToolResultRecord | CalendarToolResultRecordV2,
    account: Awaited<ReturnType<typeof requireCalendarAccountRevision>>,
  ): Promise<void> {
    let current: Awaited<ReturnType<typeof readCurrentCalendarAccountBinding>>;
    try {
      current = await readCurrentCalendarAccountBinding(this.store, value.userId);
    } catch {
      await this.redactResult(value, account);
      throw new AppError('PERSISTENCE_ERROR', 'Calendar account authority could not be confirmed.', false);
    }
    if (sameCalendarAccountBinding(current, account)) return;
    await this.redactResult(value, account);
    throw staleAccountError();
  }

  private async redactResult(
    value: CalendarToolResultRecord | CalendarToolResultRecordV2,
    account: Awaited<ReturnType<typeof requireCalendarAccountRevision>>,
  ): Promise<void> {
    const id = resultKey(value.userId, value.sessionId, value.toolCallId);
    const raw = await this.store.raw('metadata', { _id: id, userId: value.userId });
    const saved = decodeCalendar(compatibleCalendarResultRecordSchema, raw);
    if (!raw || !saved) return;
    const redacted = redactCalendarResultForAccount(saved, account, this.clock());
    const schema = redacted.schemaVersion === 2 ? calendarToolResultRecordV2Schema : calendarToolResultRecordSchema;
    await replaceStaleEvidence(this.store, schema, redacted, id, raw, this.budgets.maxDocumentBytes);
  }
}
