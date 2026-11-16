/**
 * ============================================================================
 * FILE: store.ts
 * LOCATION: backend/src/persistence/store.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Perform scoped document reads, immutable upserts, and revision CAS writes.
 *
 * ROLE IN PROJECT:
 *    Centralizes low-level MongoDB access for P2 adapters so ambiguous writes
 *    are confirmed by reread rather than blind retries or cross-collection
 *    transactions.
 *
 * KEY COMPONENTS:
 *    - RecordStore.read/raw: Scoped collection lookups with decoded payloads.
 *    - RecordStore.insert: Idempotent `$setOnInsert` upserts with content compare.
 *    - RecordStore.replace: Revision-checked replacements without upsert.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { Db, Document, Filter } from 'mongodb';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from '../platform/errors/app-error.js';
import {
  inspectConfirmedRecord,
  issueConfirmedRecord,
  type CasConfirmation,
  type ConfirmedRecord,
} from './confirmed-record.js';
import { bounded, decode, type StoredDocument } from './records.js';

const WRITE_OPS = new Set([
  'updateOne',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'insertOne',
  'findOneAndUpdate',
  'bulkWrite',
]);

export class RecordStore {
  onCommand?: (kind: 'read' | 'write', elapsedMs: number) => void;
  beforeMutation?: () => void;

  constructor(
    readonly db: Db,
    readonly timeoutMs: number,
  ) {}

  collection(name: string) {
    const col = this.db.collection<StoredDocument>(name);
    if (!this.onCommand && !this.beforeMutation) return col;
    return new Proxy(col, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        const method = String(prop);
        if (method === 'findOne') {
          return (...args: unknown[]) => {
            const started = performance.now();
            return Promise.resolve(Reflect.apply(value, target, args)).finally(() => {
              this.onCommand?.('read', performance.now() - started);
            });
          };
        }
        if (method === 'find') {
          return (...args: unknown[]) => {
            const cursor = Reflect.apply(value, target, args) as Record<string, unknown>;
            if (!cursor || typeof cursor !== 'object' || typeof cursor.toArray !== 'function') {
              return cursor;
            }
            return new Proxy(cursor, {
              get: (cTarget, cProp, cReceiver) => {
                const cVal = Reflect.get(cTarget, cProp, cReceiver);
                if (cProp === 'toArray' && typeof cVal === 'function') {
                  return (...cArgs: unknown[]) => {
                    const started = performance.now();
                    return Promise.resolve(Reflect.apply(cVal, cTarget, cArgs)).finally(() => {
                      this.onCommand?.('read', performance.now() - started);
                    });
                  };
                }
                return typeof cVal === 'function' ? cVal.bind(cTarget) : cVal;
              },
            });
          };
        }
        if (WRITE_OPS.has(method)) {
          return (...args: unknown[]) => {
            this.beforeMutation?.();
            const started = performance.now();
            return Promise.resolve(Reflect.apply(value, target, args)).finally(() => {
              this.onCommand?.('write', performance.now() - started);
            });
          };
        }
        return value.bind(target);
      },
    });
  }

  options() {
    return { maxTimeMS: this.timeoutMs };
  }

  async raw(
    collection: string,
    filter: Filter<StoredDocument>,
  ): Promise<StoredDocument | null> {
    try {
      return await this.collection(collection).findOne(filter, this.options());
    } catch {
      throw new AppError('PERSISTENCE_ERROR', 'The chat could not be read.');
    }
  }

  async read<T>(
    collection: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    filter: Filter<StoredDocument>,
  ): Promise<T | null> {
    return decode(schema, await this.raw(collection, filter));
  }

  async readConfirmed<T>(
    collection: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    filter: Filter<StoredDocument>,
  ): Promise<ConfirmedRecord<T> | null> {
    const doc = await this.raw(collection, filter);
    const record = decode(schema, doc);
    if (!doc || !record) return null;
    return issueConfirmedRecord({
      store: this,
      collection,
      id: doc._id,
      revision: doc._revision,
      record,
      encoded: doc,
    });
  }

  async insertConfirmed<T extends Document>(
    collection: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    value: T,
    id: string,
    limit: number,
  ): Promise<ConfirmedRecord<T>> {
    const { record, doc } = bounded(schema, value, id, limit);
    const scope = 'userId' in record
      ? { userId: record.userId, ...('sessionId' in record ? { sessionId: record.sessionId } : {}) }
      : {};
    const filter = { _id: id, ...scope };
    let failed = false;
    try {
      const result = await this.collection(collection).updateOne(
        filter,
        { $setOnInsert: doc },
        { upsert: true, ...this.options() },
      );
      // Acknowledged insertion proves this exact immutable payload won. Existing
      // records and ambiguous outcomes still require content confirmation.
      if (result.acknowledged && result.upsertedCount === 1) {
        return issueConfirmedRecord({
          store: this,
          collection,
          id,
          revision: 0,
          record,
          encoded: doc,
        });
      }
    } catch {
      failed = true;
    }
    const rawDoc = await this.raw(collection, filter);
    const saved = decode(schema, rawDoc);
    if (saved && rawDoc && isDeepStrictEqual(saved, record)) {
      return issueConfirmedRecord({
        store: this,
        collection,
        id: rawDoc._id,
        revision: rawDoc._revision,
        record: saved,
        encoded: rawDoc,
      });
    }
    if (saved) {
      throw new AppError(
        'IDEMPOTENCY_PAYLOAD_MISMATCH',
        'The request identity already has different data.',
      );
    }
    throw new AppError(
      'PERSISTENCE_ERROR',
      failed ? 'The save could not be confirmed.' : 'The record could not be saved.',
    );
  }

  async insert<T extends Document>(
    collection: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    value: T,
    id: string,
    limit: number,
  ): Promise<T> {
    const confirmed = await this.insertConfirmed(collection, schema, value, id, limit);
    return confirmed.record as T;
  }

  async replaceConfirmed<T extends Document>(
    expected: ConfirmedRecord<T>,
    schema: ZodType<T, ZodTypeDef, unknown>,
    value: T,
    limit: number,
  ): Promise<CasConfirmation<T>> {
    const envelope = inspectConfirmedRecord<T>(expected, { store: this });
    const { record, doc } = bounded(schema, value, envelope.id, limit);
    const prevObj = envelope.canonical as Record<string, unknown>;
    const nextObj = record as Record<string, unknown>;
    if (
      ('userId' in prevObj && prevObj.userId !== nextObj.userId) ||
      ('sessionId' in prevObj && prevObj.sessionId !== nextObj.sessionId)
    ) {
      throw new AppError('INVALID_REQUEST', 'Invalid persistence receipt.');
    }
    const nextRevision = envelope.revision + 1;
    doc._revision = nextRevision;
    const scope = 'userId' in record
      ? { userId: record.userId, ...('sessionId' in record ? { sessionId: record.sessionId } : {}) }
      : {};
    const filter = { _id: envelope.id, ...scope, _revision: envelope.revision };
    let failed = false;
    try {
      const result = await this.collection(envelope.collection).replaceOne(
        filter,
        doc,
        this.options(),
      );
      if (result.acknowledged === true && result.matchedCount === 1) {
        return {
          outcome: 'confirmed',
          receipt: issueConfirmedRecord({
            store: this,
            collection: envelope.collection,
            id: envelope.id,
            revision: nextRevision,
            record,
            encoded: doc,
          }),
        };
      }
    } catch {
      failed = true;
    }
    let saved: StoredDocument | null = null;
    try {
      saved = await this.raw(envelope.collection, { _id: envelope.id, ...scope });
    } catch {
      return { outcome: 'uncertain' };
    }
    if (!saved) {
      return { outcome: failed ? 'uncertain' : 'conflict' };
    }
    const decoded = decode(schema, saved);
    if (saved._revision === nextRevision && decoded && isDeepStrictEqual(decoded, record)) {
      return {
        outcome: 'confirmed',
        receipt: issueConfirmedRecord({
          store: this,
          collection: envelope.collection,
          id: envelope.id,
          revision: nextRevision,
          record: decoded,
          encoded: saved,
        }),
      };
    }
    return { outcome: failed && saved._revision === envelope.revision ? 'uncertain' : 'conflict' };
  }

  async replace<T extends Document>(
    collection: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    value: T,
    id: string,
    expectedRevision: number,
    limit: number,
  ): Promise<boolean> {
    const { record, doc } = bounded(schema, value, id, limit);
    doc._revision = expectedRevision + 1;
    const scope = 'userId' in record
      ? { userId: record.userId, ...('sessionId' in record ? { sessionId: record.sessionId } : {}) }
      : {};
    const filter = { _id: id, ...scope, _revision: expectedRevision };
    try {
      const result = await this.collection(collection).replaceOne(
        filter,
        doc,
        this.options(),
      );
      if (result.acknowledged === true && result.matchedCount === 1) {
        return true;
      }
    } catch {
      /* The write might already be durable; verify the exact revision. */
    }
    const saved = await this.raw(collection, { _id: id, ...scope });
    return (
      saved?._revision === expectedRevision + 1 &&
      isDeepStrictEqual(decode(schema, saved), record)
    );
  }
}
