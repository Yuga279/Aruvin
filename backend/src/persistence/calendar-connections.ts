/**
 * ============================================================================
 * FILE: calendar-connections.ts
 * LOCATION: backend/src/persistence/calendar-connections.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Persistence adapter for Google Calendar connection, default, and OAuth records.
 *
 * ROLE IN PROJECT:
 *    Manages integration_connections storage for v1 legacy and v2 multi-calendar
 *    connections with independent default settings and single-document CAS.
 *
 * KEY COMPONENTS:
 *    - MongoCalendarConnections: Concrete adapter implementing CalendarConnectionStore
 *      and exposing v2 facade typed CalendarConnectionStoreV2.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { BudgetConfig } from '../contracts/budgets.js';
import {
  connectionRecordSchema,
  oauthStateSchema,
  sha256Schema,
  type CalendarConnectionCas,
  type CalendarConnectionRecord,
  type CalendarConnectionStore,
  type CalendarOAuthState,
} from '../contracts/calendar-connections.js';
import {
  calendarConnectionV2Schema,
  calendarConnectionTransitionV2Schema,
  type CalendarConnectionRecordV2,
  type CalendarConnectionStoreV2,
} from '../contracts/calendar-discovery.js';
import {
  compatibleCalendarConnectionSchema,
} from '../contracts/calendar-compatibility.js';
import { idSchema, isoDateSchema } from '../contracts/identifiers.js';
import { AppError } from '../platform/errors/app-error.js';
import { projectLegacyCalendarConnection } from './calendar-migration.js';
import {
  confirmCalendarRecord,
  connectionKey,
  decodeCalendar,
  encodeCalendar,
  oauthKey,
  type StoredDocument,
} from './calendar-records.js';
import { RecordStore } from './store.js';

const consumeInputSchema = z.object({
  userId: idSchema,
  stateHash: sha256Schema,
  browserHash: sha256Schema,
  now: isoDateSchema,
}).strict();

export class MongoCalendarConnections implements CalendarConnectionStore {
  readonly v2: CalendarConnectionStoreV2 = {
    get: (userId) => this.getCompatible(userId),
    create: (record) => this.createV2(record),
    compareAndSwap: (input) => this.compareAndSwapV2(input),
  };

  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
  ) {}

  async get(userId: string): Promise<CalendarConnectionRecord | null> {
    const raw = await this.store.raw('integration_connections', {
      _id: connectionKey(userId),
      userId,
      provider: 'google-calendar',
    });
    return decodeCalendar(connectionRecordSchema, raw);
  }

  async getCompatible(userId: string): Promise<CalendarConnectionRecord | CalendarConnectionRecordV2 | null> {
    const raw = await this.store.raw('integration_connections', {
      _id: connectionKey(userId),
      userId,
      provider: 'google-calendar',
    });
    return decodeCalendar(compatibleCalendarConnectionSchema, raw);
  }

  async create(record: CalendarConnectionRecord): Promise<CalendarConnectionCas> {
    const value = this.parseConnection(record);
    if (value.revision !== 1) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const id = connectionKey(value.userId);
    const { record: boundedRecord, doc } = encodeCalendar(
      connectionRecordSchema, value, id, this.budgets.maxDocumentBytes,
    );
    try {
      await this.store.collection('integration_connections').updateOne(
        { _id: id, userId: value.userId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      return this.confirmConnection(value.userId, boundedRecord);
    }
    return this.confirmConnection(value.userId, boundedRecord);
  }

  async createV2(record: CalendarConnectionRecordV2): Promise<
    | { outcome: 'confirmed'; record: CalendarConnectionRecordV2 }
    | { outcome: 'conflict'; currentRevision: number; currentDefaultSettingRevision: number }
    | { outcome: 'uncertain' }
  > {
    const value = this.parseConnectionV2(record);
    if (value.revision !== 1 || value.defaultSetting.defaultSettingRevision !== 1) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const id = connectionKey(value.userId);
    const { record: boundedRecord, doc } = encodeCalendar(
      calendarConnectionV2Schema, value, id, this.budgets.maxDocumentBytes,
    );
    try {
      await this.store.collection('integration_connections').updateOne(
        { _id: id, userId: value.userId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      return this.confirmConnectionV2(value.userId, boundedRecord);
    }
    return this.confirmConnectionV2(value.userId, boundedRecord);
  }

  async compareAndSwap(
    userId: string,
    expectedRevision: number,
    next: CalendarConnectionRecord,
  ): Promise<CalendarConnectionCas> {
    const value = this.parseConnection(next);
    if (value.userId !== userId) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const id = connectionKey(userId);
    const raw = await this.store.raw('integration_connections', {
      _id: id, userId, provider: 'google-calendar',
    });
    if (raw && (raw.schemaVersion === 2 || raw.schemaVersion === '2')) {
      return { outcome: 'conflict', currentRevision: typeof raw.revision === 'number' ? raw.revision : 1 };
    }
    const current = decodeCalendar(connectionRecordSchema, raw);
    if (current && isDeepStrictEqual(current, value)) {
      return { outcome: 'confirmed', record: current };
    }
    if (!current || !raw) return { outcome: 'uncertain' };
    if (current.revision !== expectedRevision) {
      return { outcome: 'conflict', currentRevision: current.revision };
    }
    this.assertTransition(current, value, expectedRevision);
    const { record, doc } = encodeCalendar(
      connectionRecordSchema, value, id, this.budgets.maxDocumentBytes,
    );
    doc._revision = raw._revision + 1;
    try {
      const result = await this.store.collection('integration_connections').replaceOne(
        {
          _id: id, userId, provider: 'google-calendar',
          revision: expectedRevision, _revision: raw._revision,
        },
        doc,
        this.store.options(),
      );
      if (result.matchedCount === 1) return { outcome: 'confirmed', record };
    } catch {
      /* Ambiguous ACK is confirmed only by an exact reread. */
    }
    return this.confirmConnection(userId, record);
  }

  async compareAndSwapV2(input: {
    userId: string;
    expectedRevision: number;
    expectedConnectionRevision: number;
    expectedDefaultSettingRevision: number;
    next: CalendarConnectionRecordV2;
  }): Promise<
    | { outcome: 'confirmed'; record: CalendarConnectionRecordV2 }
    | { outcome: 'conflict'; currentRevision: number; currentDefaultSettingRevision: number }
    | { outcome: 'uncertain' }
  > {
    const value = this.parseConnectionV2(input.next);
    if (value.userId !== input.userId) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const id = connectionKey(input.userId);
    let raw: StoredDocument | null;
    try {
      raw = await this.store.raw('integration_connections', {
        _id: id, userId: input.userId, provider: 'google-calendar',
      });
    } catch {
      return { outcome: 'uncertain' };
    }
    if (!raw) return { outcome: 'uncertain' };
    const current = decodeCalendar(compatibleCalendarConnectionSchema, raw);
    if (!current) return { outcome: 'uncertain' };

    // Idempotent retry confirmed by exact match
    if (current.schemaVersion === 2 && isDeepStrictEqual(current, value)) {
      return { outcome: 'confirmed', record: current };
    }

    if (current.schemaVersion === 1) {
      return {
        outcome: 'conflict',
        currentRevision: current.revision,
        currentDefaultSettingRevision: 0,
      };
    }

    if (
      current.revision !== input.expectedRevision
      || current.connectionRevision !== input.expectedConnectionRevision
      || current.defaultSetting.defaultSettingRevision !== input.expectedDefaultSettingRevision
    ) {
      return {
        outcome: 'conflict',
        currentRevision: current.revision,
        currentDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
      };
    }

    try {
      calendarConnectionTransitionV2Schema.parse({ previous: current, next: value });
    } catch {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    this.assertTransitionV2(current, value);

    const { record, doc } = encodeCalendar(
      calendarConnectionV2Schema, value, id, this.budgets.maxDocumentBytes,
    );
    doc._revision = raw._revision + 1;

    const filter = {
      _id: connectionKey(input.userId),
      userId: input.userId,
      provider: 'google-calendar',
      schemaVersion: 2,
      revision: input.expectedRevision,
      connectionRevision: input.expectedConnectionRevision,
      'defaultSetting.defaultSettingRevision': input.expectedDefaultSettingRevision,
      credentialVersion: current.credentialVersion,
      _revision: raw._revision,
    };

    try {
      const result = await this.store.collection('integration_connections').replaceOne(
        filter,
        doc,
        this.store.options(),
      );
      if (result.matchedCount === 1) return { outcome: 'confirmed', record };
    } catch {
      /* Ambiguous write failures confirmed only by exact compatible reread. */
    }
    return this.confirmConnectionV2(input.userId, record);
  }

  async putState(record: CalendarOAuthState): Promise<void> {
    const value = oauthStateSchema.parse(record);
    if (value.consumedAt !== null) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const id = oauthKey(value.stateHash);
    const { record: boundedRecord, doc } = encodeCalendar(
      oauthStateSchema, value, id, this.budgets.maxDocumentBytes,
    );
    try {
      await this.store.collection('metadata').updateOne(
        { _id: id, userId: value.userId },
        { $setOnInsert: doc },
        { upsert: true, ...this.store.options() },
      );
    } catch {
      /* Confirm below. */
    }
    const saved = await this.store.raw('metadata', { _id: id, userId: value.userId });
    if (!saved) {
      throw new AppError('PERSISTENCE_ERROR', 'The record could not be saved.');
    }
    if (saved.kind === 'calendar-oauth-state-tombstone') {
      throw new AppError('INVALID_REQUEST', 'OAuth state cannot be replaced.');
    }
    const decoded = decodeCalendar(oauthStateSchema, saved);
    if (!decoded || !isDeepStrictEqual(decoded, boundedRecord)) {
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'The request identity already has different data.');
    }
  }

  async consumeState(input: {
    userId: string; stateHash: string; browserHash: string; now: string;
  }): Promise<CalendarOAuthState | null> {
    let parsed: { userId: string; stateHash: string; browserHash: string; now: string };
    try {
      parsed = consumeInputSchema.parse(input);
    } catch {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const id = oauthKey(parsed.stateHash);
    const raw = await this.store.raw('metadata', { _id: id, userId: parsed.userId });
    if (!raw || raw.kind === 'calendar-oauth-state-tombstone') return null;
    decodeCalendar(oauthStateSchema, raw);
    try {
      const saved = await this.store.collection('metadata').findOneAndUpdate({
        _id: id, kind: 'calendar-oauth-state', userId: parsed.userId,
        stateHash: parsed.stateHash, browserHash: parsed.browserHash, consumedAt: null,
        createdAt: { $lte: parsed.now }, expiresAt: { $gt: parsed.now },
        _revision: raw._revision,
      }, {
        $set: { kind: 'calendar-oauth-state-tombstone', consumedAt: parsed.now, reason: 'consumed' },
        $unset: { encryptedVerifier: '', browserHash: '', oidcNonceHash: '', redirectUri: '' },
        $inc: { _revision: 1 },
      }, { ...this.store.options(), returnDocument: 'before', includeResultMetadata: false });
      if (!saved) return null;
      return decodeCalendar(oauthStateSchema, saved);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('PERSISTENCE_ERROR', 'The save could not be confirmed.');
    }
  }

  private parseConnection(record: CalendarConnectionRecord): CalendarConnectionRecord {
    const parsed = connectionRecordSchema.safeParse(record);
    if (!parsed.success || parsed.data.provider !== 'google-calendar') {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    return parsed.data;
  }

  private parseConnectionV2(record: CalendarConnectionRecordV2): CalendarConnectionRecordV2 {
    const parsed = calendarConnectionV2Schema.safeParse(record);
    if (!parsed.success || parsed.data.provider !== 'google-calendar') {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    return parsed.data;
  }

  async migrateLegacy(input: {
    userId: string;
    expectedRevision: number;
    expectedConnectionRevision: number;
    legacy: CalendarConnectionRecord;
    now: string;
    admissionStopped: boolean;
    executorDrained: boolean;
  }): Promise<{ outcome: 'confirmed'; record: CalendarConnectionRecordV2 } | { outcome: 'conflict' } | { outcome: 'uncertain' }> {
    if (!input.admissionStopped || !input.executorDrained) {
      throw new AppError('INVALID_REQUEST', 'Migration preconditions not met.');
    }
    const legacy = connectionRecordSchema.parse(input.legacy);
    if (
      legacy.userId !== input.userId
      || legacy.revision !== input.expectedRevision
      || legacy.connectionRevision !== input.expectedConnectionRevision
    ) {
      throw new AppError('INVALID_REQUEST', 'Scope or revision mismatch.');
    }

    const projected = projectLegacyCalendarConnection(legacy, input.now);
    const id = connectionKey(input.userId);

    let raw: StoredDocument | null;
    try {
      raw = await this.store.raw('integration_connections', {
        _id: id,
        userId: input.userId,
        provider: 'google-calendar',
      });
    } catch {
      return { outcome: 'uncertain' };
    }
    if (!raw) return { outcome: 'conflict' };

    if (raw.schemaVersion === 2) {
      const currentV2 = decodeCalendar(calendarConnectionV2Schema, raw);
      if (currentV2 && isDeepStrictEqual(currentV2, projected)) {
        return { outcome: 'confirmed', record: currentV2 };
      }
      return { outcome: 'conflict' };
    }

    const currentV1 = decodeCalendar(connectionRecordSchema, raw);
    if (!currentV1 || !isDeepStrictEqual(currentV1, legacy)) {
      return { outcome: 'conflict' };
    }

    const { record, doc } = encodeCalendar(
      calendarConnectionV2Schema,
      projected,
      id,
      this.budgets.maxDocumentBytes,
    );
    doc._revision = raw._revision + 1;

    try {
      const res = await this.store.collection('integration_connections').replaceOne(
        {
          _id: id,
          userId: input.userId,
          provider: 'google-calendar',
          schemaVersion: 1,
          revision: input.expectedRevision,
          connectionRevision: input.expectedConnectionRevision,
          _revision: raw._revision,
        },
        doc,
        this.store.options(),
      );
      if (res.matchedCount === 1) return { outcome: 'confirmed', record };
    } catch {
      /* confirm below */
    }

    let confirmRaw: StoredDocument | null;
    try {
      confirmRaw = await this.store.raw('integration_connections', {
        _id: id,
        userId: input.userId,
        provider: 'google-calendar',
      });
    } catch {
      return { outcome: 'uncertain' };
    }
    if (!confirmRaw) return { outcome: 'uncertain' };
    const saved = decodeCalendar(calendarConnectionV2Schema, confirmRaw);
    if (saved && isDeepStrictEqual(saved, record)) {
      return { outcome: 'confirmed', record: saved };
    }
    return { outcome: 'conflict' };
  }

  private assertTransition(
    current: CalendarConnectionRecord,
    next: CalendarConnectionRecord,
    expectedRevision: number,
  ): void {
    if (next.provider !== current.provider || next.userId !== current.userId) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (next.revision !== expectedRevision + 1) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (next.connectionRevision < current.connectionRevision
      || next.targetRevision < current.targetRevision
      || next.credentialVersion < current.credentialVersion) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    const tokensChanged = !isDeepStrictEqual(current.credentials, next.credentials);
    if (tokensChanged) {
      if (next.credentialVersion !== current.credentialVersion + 1) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
      if (next.status !== 'disconnected' && (!next.credentials?.access || !next.credentials.refresh)) {
        throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
      }
    }
    const subjectChanged = next.googleSubjectId !== current.googleSubjectId;
    const connectionChanged = next.connectionId !== current.connectionId;
    const targetChanged = next.calendarId !== current.calendarId;
    const disconnected = current.status !== 'disconnected' && next.status === 'disconnected';
    const invalidateConnection = subjectChanged || connectionChanged || targetChanged || disconnected;
    if (invalidateConnection && next.connectionRevision !== current.connectionRevision + 1) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
    if (targetChanged && next.targetRevision !== current.targetRevision + 1) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
  }

  private assertTransitionV2(
    p: CalendarConnectionRecordV2,
    n: CalendarConnectionRecordV2,
  ): void {
    const replaced = p.connectionId !== n.connectionId || p.googleSubjectId !== n.googleSubjectId;
    const authorityChanged = replaced || p.enabled !== n.enabled || p.status !== n.status
      || !isDeepStrictEqual([...p.grantedScopes].sort(), [...n.grantedScopes].sort());
    const tokensChanged = !isDeepStrictEqual(p.credentials, n.credentials);
    const discoveryChanged = !isDeepStrictEqual(p.discovery, n.discovery);
    const retentionShortened = p.discovery && n.discovery
      && Date.parse(n.discovery.retentionExpiresAt) <= Date.parse(p.discovery.retentionExpiresAt)
      && isDeepStrictEqual({ ...n.discovery, retentionExpiresAt: p.discovery.retentionExpiresAt }, p.discovery);
    const valid = Date.parse(n.updatedAt) >= Date.parse(p.updatedAt)
      && n.connectionRevision === p.connectionRevision + (authorityChanged ? 1 : 0)
      && n.credentialVersion === p.credentialVersion + (tokensChanged ? 1 : 0)
      && (!replaced || tokensChanged)
      && (!authorityChanged || n.discovery === null)
      && (!discoveryChanged || retentionShortened || n.discovery === null ||
        (n.discovery.discoveryRevision === n.revision
          && n.discovery.discoveryRevision > (p.discovery?.discoveryRevision ?? 0)
          && Date.parse(n.discovery.fetchedAt) >= Date.parse(p.discovery?.fetchedAt ?? p.updatedAt)))
      && (!(p.discovery?.complete && n.discovery && !n.discovery.complete));
    if (!valid) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
    }
  }

  private confirmConnection(userId: string, expected: CalendarConnectionRecord): Promise<CalendarConnectionCas> {
    return confirmCalendarRecord(() => this.get(userId), expected, (record) => record.revision);
  }

  private async confirmConnectionV2(
    userId: string,
    expected: CalendarConnectionRecordV2,
  ): Promise<
    | { outcome: 'confirmed'; record: CalendarConnectionRecordV2 }
    | { outcome: 'conflict'; currentRevision: number; currentDefaultSettingRevision: number }
    | { outcome: 'uncertain' }
  > {
    let raw: StoredDocument | null;
    try {
      raw = await this.store.raw('integration_connections', {
        _id: connectionKey(userId),
        userId,
        provider: 'google-calendar',
      });
    } catch {
      return { outcome: 'uncertain' };
    }
    if (!raw) return { outcome: 'uncertain' };
    const current = decodeCalendar(compatibleCalendarConnectionSchema, raw);
    if (!current) return { outcome: 'uncertain' };
    if (current.schemaVersion === 2 && isDeepStrictEqual(current, expected)) {
      return { outcome: 'confirmed', record: current };
    }
    if (current.schemaVersion === 1) {
      return {
        outcome: 'conflict',
        currentRevision: current.revision,
        currentDefaultSettingRevision: 0,
      };
    }
    return {
      outcome: 'conflict',
      currentRevision: current.revision,
      currentDefaultSettingRevision: current.defaultSetting.defaultSettingRevision,
    };
  }
}
