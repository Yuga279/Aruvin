/**
 * ============================================================================
 * FILE: config.ts
 * LOCATION: backend/src/persistence/config.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Persist one bounded application configuration document with revision CAS.
 *
 * ROLE IN PROJECT:
 *    Adapts the admitted MongoDB store for admin configuration without using
 *    the generic record codec, a second client, or unguarded collection APIs.
 *
 * KEY COMPONENTS:
 *    - MongoConfigRepository.read: Strict singleton lookup with byte bounds.
 *    - createIfAbsent / compareAndSwap: Atomic whole-document revision writes.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { Collection } from 'mongodb';
import {
  APP_CONFIG_ID,
  storedConfigDocumentSchema,
  type StoredConfigDocument,
} from '../contracts/admin-config.js';
import { COLLECTIONS } from '../contracts/collections.js';
import type { ConfigCasResult, ConfigRepository } from '../contracts/config-runtime.js';
import { AdminConfigFault } from '../admin-config/errors.js';
import { assertBytes } from './records.js';
import type { MongoOwnership } from './ownership.js';
import type { RecordStore } from './store.js';

const MAX_EXPECTED_REVISION = Number.MAX_SAFE_INTEGER - 1;

export class MongoConfigRepository implements ConfigRepository {
  private readonly collection: Collection<StoredConfigDocument>;

  constructor(
    private readonly store: RecordStore,
    private readonly owner: Pick<MongoOwnership, 'assertExecutor'>,
    private readonly documentByteLimit: number,
  ) {
    this.collection = store.db.collection<StoredConfigDocument>(COLLECTIONS.config);
  }

  async read(): Promise<StoredConfigDocument | null> {
    let raw: StoredConfigDocument | null;
    try {
      raw = await this.collection.findOne(
        { _id: APP_CONFIG_ID },
        { ...this.store.options(), timeoutMS: this.store.timeoutMs },
      );
    } catch {
      throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
    }
    if (raw === null) return null;
    return this.parseStored(raw);
  }

  async createIfAbsent(document: StoredConfigDocument): Promise<ConfigCasResult> {
    const candidate = this.validateWrite(document, 1);
    await this.assertWritable();
    let dispatched = false;
    try {
      dispatched = true;
      const result = await this.collection.updateOne(
        { _id: APP_CONFIG_ID },
        { $setOnInsert: candidate },
        { ...this.writeOptions(), upsert: true },
      );
      if (!result.acknowledged) return this.resolveAmbiguous(candidate);
      if ((result.upsertedCount ?? 0) === 1) return this.confirm(candidate);
      return { outcome: 'conflict', currentRevision: await this.readCurrentRevision() };
    } catch (error) {
      return this.afterDispatchFailure(dispatched, error, candidate);
    }
  }

  async compareAndSwap(
    expectedRevision: number,
    document: StoredConfigDocument,
  ): Promise<ConfigCasResult> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1
      || expectedRevision > MAX_EXPECTED_REVISION) {
      throw new AdminConfigFault('INVALID_CONFIG_REQUEST');
    }
    const candidate = this.validateWrite(document, expectedRevision + 1);
    await this.assertWritable();
    let dispatched = false;
    try {
      dispatched = true;
      const result = await this.collection.replaceOne(
        { _id: APP_CONFIG_ID, revision: expectedRevision },
        candidate,
        { ...this.writeOptions(), upsert: false },
      );
      if (!result.acknowledged) return this.resolveAmbiguous(candidate);
      if (result.matchedCount === 1) return this.confirm(candidate);
      return { outcome: 'conflict', currentRevision: await this.readCurrentRevision() };
    } catch (error) {
      return this.afterDispatchFailure(dispatched, error, candidate);
    }
  }

  private validateWrite(document: StoredConfigDocument, revision: number): StoredConfigDocument {
    const parsed = storedConfigDocumentSchema.safeParse(document);
    if (!parsed.success || parsed.data._id !== APP_CONFIG_ID || parsed.data.schemaVersion !== 1
      || parsed.data.revision !== revision) {
      throw new AdminConfigFault('CONFIG_STORED_INVALID');
    }
    try {
      assertBytes(parsed.data, this.documentByteLimit);
    } catch {
      throw new AdminConfigFault('CONFIG_STORED_INVALID');
    }
    return parsed.data;
  }

  private parseStored(raw: StoredConfigDocument): StoredConfigDocument {
    const parsed = storedConfigDocumentSchema.safeParse(raw);
    if (!parsed.success) throw new AdminConfigFault('CONFIG_STORED_INVALID');
    try {
      assertBytes(parsed.data, this.documentByteLimit);
    } catch {
      throw new AdminConfigFault('CONFIG_STORED_INVALID');
    }
    return structuredClone(parsed.data);
  }

  private async readCurrentRevision(): Promise<number> {
    const current = await this.read();
    return current?.revision ?? 0;
  }

  private writeOptions() {
    return {
      ...this.store.options(),
      timeoutMS: this.store.timeoutMs,
      writeConcern: { w: 'majority' as const, j: true },
    };
  }

  private async assertWritable(): Promise<void> {
    try {
      await this.owner.assertExecutor();
    } catch (error) {
      if (error instanceof AdminConfigFault) throw error;
      throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
    }
  }

  private async confirm(candidate: StoredConfigDocument): Promise<ConfigCasResult> {
    try {
      await this.owner.assertExecutor();
      return { outcome: 'confirmed', document: structuredClone(candidate) };
    } catch {
      return { outcome: 'uncertain' };
    }
  }

  private afterDispatchFailure(
    dispatched: boolean,
    error: unknown,
    candidate: StoredConfigDocument,
  ): Promise<ConfigCasResult> {
    if (!dispatched) {
      if (error instanceof AdminConfigFault) throw error;
      throw new AdminConfigFault('CONFIG_STORAGE_UNAVAILABLE');
    }
    return this.resolveAmbiguous(candidate);
  }

  private async resolveAmbiguous(candidate: StoredConfigDocument): Promise<ConfigCasResult> {
    let raw: StoredConfigDocument | null;
    try {
      raw = await this.collection.findOne(
        { _id: APP_CONFIG_ID },
        { ...this.store.options(), timeoutMS: this.store.timeoutMs },
      );
    } catch {
      return { outcome: 'uncertain' };
    }
    let parsed: StoredConfigDocument | null;
    try {
      parsed = raw === null ? null : this.parseStored(raw);
    } catch {
      return { outcome: 'uncertain' };
    }
    try {
      await this.owner.assertExecutor();
    } catch {
      return { outcome: 'uncertain' };
    }
    if (parsed !== null && isDeepStrictEqual(parsed, candidate)) {
      return { outcome: 'confirmed', document: structuredClone(candidate) };
    }
    const expectedRevision = candidate.revision - 1;
    if (parsed !== null && parsed.revision > expectedRevision) {
      return { outcome: 'conflict', currentRevision: parsed.revision };
    }
    return { outcome: 'uncertain' };
  }
}
