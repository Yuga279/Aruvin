/**
 * ============================================================================
 * FILE: checkpoints.ts
 * LOCATION: backend/src/persistence/checkpoints.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Wrap the standard MongoDB saver with scope, bounds, and executor guards.
 *
 * ROLE IN PROJECT:
 *    Preserves stock checkpoint serialization while refusing unscoped threads,
 *    oversized envelopes, TTL/custom uniqueness, and writes without a live lease.
 *
 * KEY COMPONENTS:
 *    - ScopedMongoSaver: Guarded put/putWrites/getTuple/list over stock storage.
 *    - MongoCheckpointFactory: Setup facade that fails closed on saver errors.
 * ============================================================================
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import {
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';
import { Binary, type MongoClient } from 'mongodb';
import type { BudgetConfig } from '../contracts/budgets.js';
import type {
  CheckpointerSetup,
  CheckpointStoreFactory,
  ExecutionLease,
} from '../contracts/repositories.js';
import { AppError } from '../platform/errors/app-error.js';
import { MongoOwnership } from './ownership.js';
import { assertCalendarCheckpointSafe } from './calendar-checkpoints.js';
import { assertBytes, graphThreadId } from './records.js';

export interface ScopedMongoSaverOptions {
  readonly enableReadFacade?: boolean;
}

function wrapCursor(rawCursor: any, onToArray: () => Promise<any>, onLimit?: (limit: number) => void) {
  const cursorProxy: any = new Proxy(rawCursor, {
    get(cursorTarget, cursorProp, cursorReceiver) {
      if (cursorProp === 'limit' && onLimit) {
        return (limit: number) => {
          onLimit(limit);
          return cursorReceiver;
        };
      }
      if (cursorProp === 'toArray') {
        return onToArray;
      }
      const val = Reflect.get(cursorTarget, cursorProp, cursorReceiver);
      if (typeof val === 'function') {
        return (...args: any[]) => {
          const result = val.apply(cursorTarget, args);
          return result === cursorTarget ? cursorReceiver : result;
        };
      }
      return val;
    },
  });
  return cursorProxy;
}

export function createBoundedSaverClient(
  client: MongoClient,
  dbName: string,
  lease: ExecutionLease,
  budgets: BudgetConfig,
): MongoClient {
  const expectedThreadId = graphThreadId(lease.userId, lease.sessionId);
  const rawDb = client.db(dbName);

  const wrapCheckpointsCollection = (rawCol: any) => {
    return new Proxy(rawCol, {
      get(target, prop, receiver) {
        if (prop === 'find') {
          return (filter: any = {}, options: any = {}) => {
            if (filter.thread_id !== expectedThreadId || (filter.checkpoint_ns !== undefined && filter.checkpoint_ns !== '')) {
              throw new AppError('INVALID_REQUEST', 'Invalid graph persistence scope.');
            }
            if (filter.checkpoint_id !== undefined && (typeof filter.checkpoint_id !== 'string' || filter.checkpoint_id.length > 128)) {
              throw new AppError('INVALID_REQUEST', 'Invalid graph persistence scope.');
            }
            const rawCursor = target.find(filter, options);
            return wrapCursor(rawCursor, async () => {
              const rows = await rawCursor.toArray();
              if (!rows.length) return [];
              const doc = rows[0];
              assertBytes(doc, budgets.maxDocumentBytes);
              if (doc.thread_id !== expectedThreadId || doc.checkpoint_ns !== '') {
                throw new AppError('PERSISTENCE_ERROR', 'Checkpoint scope is invalid.');
              }
              if (!doc.checkpoint || typeof doc.checkpoint.value !== 'function') {
                throw new AppError('PERSISTENCE_ERROR', 'Checkpoint binary is invalid.');
              }
              if (doc.metadata && typeof doc.metadata.value !== 'function') {
                throw new AppError('PERSISTENCE_ERROR', 'Checkpoint metadata binary is invalid.');
              }
              return [doc];
            });
          };
        }
        const val = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  };

  const wrapCheckpointWritesCollection = (rawCol: any) => {
    return new Proxy(rawCol, {
      get(target, prop, receiver) {
        if (prop === 'find') {
          return (filter: any = {}, options: any = {}) => {
            if (filter.thread_id !== expectedThreadId || (filter.checkpoint_ns !== undefined && filter.checkpoint_ns !== '')) {
              throw new AppError('INVALID_REQUEST', 'Invalid graph persistence scope.');
            }
            if (typeof filter.checkpoint_id !== 'string' || filter.checkpoint_id.length > 128) {
              throw new AppError('INVALID_REQUEST', 'Invalid graph persistence scope.');
            }
            const rawCursor = target.find(filter, options).limit(81);
            return wrapCursor(
              rawCursor,
              async () => {
                const rows = await rawCursor.toArray();
                if (rows.length > 80) {
                  throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Saved graph writes exceed their limit.');
                }
                let totalBytes = 0;
                for (const row of rows) {
                  if (row.thread_id !== expectedThreadId || row.checkpoint_ns !== ''
                    || row.checkpoint_id !== filter.checkpoint_id) {
                    throw new AppError('PERSISTENCE_ERROR', 'Graph write scope is invalid.');
                  }
                  if (typeof row.task_id !== 'string' || row.task_id.length > 128) {
                    throw new AppError('PERSISTENCE_ERROR', 'Graph write task ID is invalid.');
                  }
                  if (typeof row.idx !== 'number' || !Number.isInteger(row.idx)) {
                    throw new AppError('PERSISTENCE_ERROR', 'Graph write index is invalid.');
                  }
                  if (typeof row.channel !== 'string') {
                    throw new AppError('PERSISTENCE_ERROR', 'Graph write channel is invalid.');
                  }
                  if (!row.value || typeof row.value.value !== 'function') {
                    throw new AppError('PERSISTENCE_ERROR', 'Graph write binary is invalid.');
                  }
                  totalBytes += assertBytes(row, budgets.maxDocumentBytes);
                }
                if (totalBytes > budgets.maxDocumentBytes) {
                  throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Saved graph writes exceed their limit.');
                }
                return rows;
              },
              (limit: number) => {
                rawCursor.limit(Math.min(limit, 81));
              },
            );
          };
        }
        const val = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  };

  const dbProxy = new Proxy(rawDb, {
    get(target, prop, receiver) {
      if (prop === 'collection') {
        return (colName: string) => {
          if (colName === 'checkpoints') return wrapCheckpointsCollection(target.collection('checkpoints'));
          if (colName === 'checkpoint_writes') return wrapCheckpointWritesCollection(target.collection('checkpoint_writes'));
          throw new AppError('INVALID_REQUEST', 'Invalid collection scope.');
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'db') {
        return (targetDbName: string) => {
          if (targetDbName !== dbName) throw new AppError('INVALID_REQUEST', 'Invalid database scope.');
          return dbProxy;
        };
      }
      if (prop === 'appendMetadata') {
        return typeof (target as any).appendMetadata === 'function'
          ? (target as any).appendMetadata.bind(target)
          : undefined;
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  }) as MongoClient;
}

export class ScopedMongoSaver extends MongoDBSaver {
  constructor(
    client: MongoClient,
    dbName: string,
    readonly owner: MongoOwnership,
    readonly lease: ExecutionLease,
    readonly budgets: BudgetConfig,
    readonly options?: ScopedMongoSaverOptions,
  ) {
    const effectiveClient = options?.enableReadFacade
      ? createBoundedSaverClient(client, dbName, lease, budgets)
      : client;
    super({
      client: effectiveClient,
      dbName,
      checkpointCollectionName: 'checkpoints',
      checkpointWritesCollectionName: 'checkpoint_writes',
    });
  }

  private scope(config: RunnableConfig): void {
    const configurable = config.configurable;
    if (
      configurable?.thread_id !== graphThreadId(this.lease.userId, this.lease.sessionId) ||
      (configurable.checkpoint_ns !== undefined && configurable.checkpoint_ns !== '') ||
      (configurable.checkpoint_id !== undefined &&
        (typeof configurable.checkpoint_id !== 'string' ||
          configurable.checkpoint_id.length > 128))
    ) {
      throw new AppError('INVALID_REQUEST', 'Invalid graph persistence scope.');
    }
  }

  private async withCachedDumps<T>(
    entries: Iterable<readonly [unknown, [string, Uint8Array]]>,
    work: () => Promise<T>,
  ): Promise<T> {
    const cache = new Map<unknown, [string, Uint8Array]>(entries);
    const prevSerde = this.serde;
    const original = prevSerde.dumpsTyped.bind(prevSerde);
    this.serde = {
      ...prevSerde,
      dumpsTyped: async (val: unknown) => cache.get(val) ?? original(val),
    };
    try {
      return await work();
    } finally {
      this.serde = prevSerde;
    }
  }

  override async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    this.scope(config);
    assertCalendarCheckpointSafe(checkpoint, { userId: this.lease.userId, sessionId: this.lease.sessionId });
    assertCalendarCheckpointSafe(metadata, { userId: this.lease.userId, sessionId: this.lease.sessionId });
    return this.owner.run(this.lease, async () => {
      const [checkpointEntry, metadataEntry] =
        await Promise.all([
          this.serde.dumpsTyped(checkpoint),
          this.serde.dumpsTyped(metadata),
        ]);
      const [type, serializedCheckpoint] = checkpointEntry;
      const [metaType, serializedMetadata] = metadataEntry;
      if (type !== metaType) {
        throw new AppError('PERSISTENCE_ERROR', 'Graph state could not be saved.');
      }
      assertBytes(
        {
          _id: 'x'.repeat(64),
          thread_id: config.configurable!.thread_id,
          checkpoint_ns: '',
          checkpoint_id: checkpoint.id,
          parent_checkpoint_id: config.configurable?.checkpoint_id,
          type,
          checkpoint: new Binary(serializedCheckpoint),
          metadata: new Binary(serializedMetadata),
          metadata_search: metadata,
        },
        this.budgets.maxDocumentBytes,
      );
      return this.withCachedDumps(
        [
          [checkpoint, checkpointEntry],
          [metadata, metadataEntry],
        ],
        () => super.put(config, checkpoint, metadata),
      );
    });
  }

  override async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    this.scope(config);
    assertCalendarCheckpointSafe(writes, { userId: this.lease.userId, sessionId: this.lease.sessionId });
    if (taskId.length > 128 || writes.length > 80) {
      throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Graph writes exceed their limit.');
    }
    await this.owner.run(this.lease, async () => {
      if (!writes.length) {
        return;
      }
      const configurable = config.configurable!;
      if (typeof configurable.checkpoint_id !== 'string' || configurable.checkpoint_ns !== '') {
        throw new AppError('INVALID_REQUEST', 'Graph write identity is missing.');
      }
      const query = {
        thread_id: configurable.thread_id,
        checkpoint_ns: '',
        checkpoint_id: configurable.checkpoint_id,
      };
      const existing = await this.db
        .collection('checkpoint_writes')
        .find(query)
        .limit(81)
        .toArray();
      const identities = new Set(
        existing.map((doc) => JSON.stringify([doc.task_id, doc.idx])),
      );
      const sizes = new Map(
        existing.map((doc) => [
          JSON.stringify([doc.task_id, doc.idx]),
          assertBytes(doc, this.budgets.maxDocumentBytes),
        ]),
      );
      const cachedWrites: Array<readonly [unknown, [string, Uint8Array]]> = [];
      for (const [index, [channel, value]] of writes.entries()) {
        const idx = WRITES_IDX_MAP[channel] ?? index;
        identities.add(JSON.stringify([taskId, idx]));
        const dumped = await this.serde.dumpsTyped(value);
        cachedWrites.push([value, dumped]);
        const [type, serialized] = dumped;
        const bytes = assertBytes(
          {
            _id: 'x'.repeat(64),
            ...query,
            task_id: taskId,
            idx,
            channel,
            type,
            value: new Binary(serialized),
          },
          this.budgets.maxDocumentBytes,
        );
        const identity = JSON.stringify([taskId, idx]);
        sizes.set(identity, Math.max(sizes.get(identity) ?? 0, bytes));
      }
      if (
        identities.size > 80 ||
        [...sizes.values()].reduce((sum, size) => sum + size, 0) >
          this.budgets.maxDocumentBytes
      ) {
        throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Graph writes exceed their limit.');
      }
      await this.withCachedDumps(cachedWrites, () => super.putWrites(config, writes, taskId));
    });
  }

  override async getTuple(config: RunnableConfig) {
    this.scope(config);
    if (this.options?.enableReadFacade) {
      return super.getTuple(config);
    }
    const configurable = config.configurable!;
    const latest = await this.db
      .collection('checkpoints')
      .find({
        thread_id: configurable.thread_id,
        checkpoint_ns: '',
        ...(configurable.checkpoint_id
          ? { checkpoint_id: configurable.checkpoint_id }
          : {}),
      })
      .sort({ checkpoint_id: -1 })
      .limit(1)
      .toArray();
    if (!latest[0]) {
      return undefined;
    }
    assertBytes(latest[0], this.budgets.maxDocumentBytes);
    const pending = await this.db
      .collection('checkpoint_writes')
      .find({
        thread_id: configurable.thread_id,
        checkpoint_ns: '',
        checkpoint_id: latest[0].checkpoint_id,
      })
      .limit(81)
      .toArray();
    if (
      pending.length > 80 ||
      pending.reduce(
        (sum, doc) => sum + assertBytes(doc, this.budgets.maxDocumentBytes),
        0,
      ) > this.budgets.maxDocumentBytes
    ) {
      throw new AppError(
        'STORAGE_BUDGET_EXCEEDED',
        'Saved graph writes exceed their limit.',
      );
    }
    // ponytail: stock @langchain/langgraph-checkpoint-mongodb@1.4.1 getTuple has no public preloaded-doc hook; keep stock getTuple for non-empty checkpoints
    return super.getTuple(config);
  }

  override async *list(config: RunnableConfig, options: CheckpointListOptions = {}) {
    this.scope(config);
    if (options.before) {
      this.scope(options.before);
    }
    const limit = options.limit ?? this.budgets.defaultPageSize;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > this.budgets.maxPageSize ||
      options.filter
    ) {
      throw new AppError('INVALID_REQUEST', 'Invalid graph history query.');
    }
    const configurable = config.configurable!;
    const docs = await this.db
      .collection('checkpoints')
      .find({
        thread_id: configurable.thread_id,
        checkpoint_ns: '',
        ...(options.before?.configurable?.checkpoint_id
          ? { checkpoint_id: { $lt: options.before.configurable.checkpoint_id } }
          : {}),
      })
      .project({ checkpoint_id: 1 })
      .sort({ checkpoint_id: -1 })
      .limit(limit)
      .toArray();
    for (const doc of docs) {
      const tuple = await this.getTuple({
        configurable: {
          thread_id: configurable.thread_id,
          checkpoint_ns: '',
          checkpoint_id: doc.checkpoint_id,
        },
      });
      if (tuple) {
        yield tuple;
      }
    }
  }

  override async deleteThread(_threadId: string): Promise<void> {
    void _threadId;
    throw new AppError(
      'INVALID_REQUEST',
      'Graph deletion requires an operational retention procedure.',
    );
  }
}

export class MongoCheckpointFactory implements CheckpointStoreFactory {
  constructor(
    readonly client: MongoClient,
    readonly dbName: string,
    readonly owner: MongoOwnership,
    readonly budgets: BudgetConfig,
    readonly options?: ScopedMongoSaverOptions,
  ) {}

  async create(): Promise<
    CheckpointerSetup & { bind(lease: ExecutionLease): ScopedMongoSaver }
  > {
    const setupSaver = new MongoDBSaver({
      client: this.client,
      dbName: this.dbName,
      checkpointCollectionName: 'checkpoints',
      checkpointWritesCollectionName: 'checkpoint_writes',
    });
    return {
      async setup(): Promise<void> {
        const errors = await setupSaver.setup();
        if (errors.length) {
          throw new AppError('NOT_READY', 'Graph storage setup failed.');
        }
      },
      bind: (lease) =>
        new ScopedMongoSaver(this.client, this.dbName, this.owner, lease, this.budgets, this.options),
    };
  }
}
