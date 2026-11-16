/**
 * ============================================================================
 * FILE: calendar-multi-memory.ts
 * LOCATION: backend/test/persistence/calendar-multi-memory.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Collection-separated, fault-injectable in-memory storage adapter for tests.
 *
 * ROLE IN PROJECT:
 *    Simulates MongoDB operations for unit tests with pre/post-write, read,
 *    CAS-mismatch, held-write, and bulk-item fault injection capabilities
 *    plus wire-event monitoring without requiring an actual database instance.
 *
 * KEY COMPONENTS:
 *    - calendarMemory: Factory providing a RecordStore instance with simulated
 *      collections, cursor query/sort/project/limit/aggregate, wire EventEmitter,
 *      and controllable fault triggers.
 * ============================================================================
 */

import { EventEmitter } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import { BSON, type Db, type Document } from 'mongodb';
import { RecordStore } from '../../src/persistence/store.js';
import type { DependencyProbe, ProbeKind } from '../performance/dependency-probe.js';

const copy = <T extends Document>(v: T): T => BSON.deserialize(BSON.serialize(v)) as T;
function compare(a: unknown, b: unknown): number {
  if (isDeepStrictEqual(a, b)) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (typeof a === 'string' && typeof b === 'string') return a > b ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a > b ? 1 : -1;
  throw new Error('fixture comparison requires matching scalar types');
}
function field(d: Document, k: string): unknown {
  return k.split('.').reduce<unknown>((v, part) =>
    v && typeof v === 'object' ? (v as Document)[part] : undefined, d);
}
function setPath(record: Record<string, any>, path: string, value: unknown): void {
  const keys = path.split('.');
  let target = record;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys[keys.length - 1]!] = value;
}
function deletePath(record: Record<string, any>, path: string): void {
  const keys = path.split('.');
  let target = record;
  for (const key of keys.slice(0, -1)) {
    if (!target || typeof target !== 'object') return;
    target = target[key];
  }
  if (target && typeof target === 'object') delete target[keys[keys.length - 1]!];
}
function projectDocument(record: Document, projection?: Document): Document {
  const cloned = copy(record);
  if (!projection || !Object.keys(projection).length) return cloned;
  const entries = Object.entries(projection).filter(([k]) => k !== '_id');
  const inclusive = entries.some(([, v]) => Boolean(v));
  if (!inclusive) {
    for (const [k, v] of Object.entries(projection)) if (!v) deletePath(cloned, k);
    return cloned;
  }
  const out: Document = {};
  if (projection._id !== 0 && projection._id !== false && '_id' in cloned) out._id = cloned._id;
  for (const [k, v] of entries) {
    if (!v) continue;
    const val = field(cloned, k);
    if (val !== undefined) setPath(out, k, val);
  }
  return out;
}
function applyUpdate(record: Document, update: Document): Document {
  const next = copy(record);
  for (const path of Object.keys(update.$unset ?? {})) deletePath(next, path);
  for (const [path, value] of Object.entries(update.$set ?? {})) setPath(next, path, value);
  for (const [path, value] of Object.entries(update.$inc ?? {}))
    setPath(next, path, Number(field(next, path) ?? 0) + Number(value));
  for (const [path, value] of Object.entries(update.$max ?? {})) {
    const previous = field(next, path);
    if (previous === undefined || compare(previous, value) < 0) setPath(next, path, value);
  }
  return next;
}
function matches(d: Document, f: Document): boolean {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return (v as Document[]).some(x => matches(d, x));
    if (k === '$and') return (v as Document[]).every(x => matches(d, x));
    const a = field(d, k);
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v as { _bsontype?: string })._bsontype) {
      return Object.entries(v).every(([op, b]) => {
        if (op === '$in') return (b as unknown[]).some(x => isDeepStrictEqual(a, x));
        if (op === '$exists') return (a !== undefined) === b;
        if (op === '$ne') return b === null ? a !== null && a !== undefined : !isDeepStrictEqual(a, b);
        if (op === '$gt') return a !== undefined && compare(a, b) > 0;
        if (op === '$gte') return a !== undefined && compare(a, b) >= 0;
        if (op === '$lt') return a !== undefined && compare(a, b) < 0;
        if (op === '$lte') return a !== undefined && compare(a, b) <= 0;
        if (op === '$elemMatch') return Array.isArray(a) && a.some(item => matches(item as Document, b as Document));
        return isDeepStrictEqual(a, v);
      });
    }
    return v === null ? a === null || a === undefined : isDeepStrictEqual(a, v);
  });
}

export type FakeFaultPhase = 'before-write' | 'after-write' | 'read' | 'cas-mismatch';
export type FakeWireCall = {
  requestId: number;
  commandName: string;
  collection: string;
  kind: ProbeKind;
  failed: boolean;
  durationMs: number;
};

export function calendarMemory(probe?: DependencyProbe, options?: { databaseName?: string }) {
  const databaseName = options?.databaseName ?? 'synthetic';
  const collections = new Map<string, Map<string, Document>>();
  const calls: { collection: string; method: string; filter: Document }[] = [];
  const wireCalls: FakeWireCall[] = [];
  const commandSource = new EventEmitter();
  let fault: FakeFaultPhase | null = null;
  let faultMatch: { collection?: string; method?: string } | undefined;
  let bulkFault: { index: number; phase: 'before-write' | 'after-write' } | null = null;
  let nextId = 0;
  let nextReqId = 0;
  let writeGate: { started: () => void; wait: Promise<void> } | null = null;
  const rows = (name: string) => {
    let result = collections.get(name);
    if (!result) { result = new Map(); collections.set(name, result); }
    return result;
  };
  const matchesFault = (collection: string, method: string) => {
    if (faultMatch?.collection && faultMatch.collection !== collection) return false;
    if (faultMatch?.method && faultMatch.method !== method) return false;
    return true;
  };
  const fail = (phase: FakeFaultPhase, collection: string, method: string) => {
    if (fault === phase && matchesFault(collection, method)) {
      fault = null;
      faultMatch = undefined;
      throw new Error('fixture acknowledgement unavailable');
    }
  };
  const takeCasMismatch = (collection: string, method: string): boolean => {
    if (fault === 'cas-mismatch' && matchesFault(collection, method)) {
      fault = null;
      faultMatch = undefined;
      return true;
    }
    return false;
  };
  const db = { collection(name: string) {
    const data = rows(name);
    const dispatch = <T>(kind: ProbeKind, method: string, wireCommand: string, run: () => T | Promise<T>): Promise<T> => {
      const requestId = ++nextReqId;
      const startedAt = probe ? probe.elapsedMs : 0;
      commandSource.emit('commandStarted', {
        requestId,
        databaseName,
        commandName: wireCommand,
        command: { [wireCommand]: name },
      });
      const execute = async () => {
        try {
          const val = await run();
          const duration = probe ? Math.max(0, probe.elapsedMs - startedAt) : 0;
          wireCalls.push({ requestId, commandName: wireCommand, collection: name, kind, failed: false, durationMs: duration });
          commandSource.emit('commandSucceeded', { requestId, commandName: wireCommand, duration });
          return val;
        } catch (err) {
          const duration = probe ? Math.max(0, probe.elapsedMs - startedAt) : 0;
          wireCalls.push({ requestId, commandName: wireCommand, collection: name, kind, failed: true, durationMs: duration });
          commandSource.emit('commandFailed', { requestId, commandName: wireCommand, duration });
          throw err;
        }
      };
      if (!probe) return execute();
      return probe.command(kind, method, name, execute) as Promise<T>;
    };
    const runUpdate = async (filter: Document, update: Document, opts?: { upsert?: boolean; bulkIndex?: number }) => {
      calls.push({ collection: name, method: 'updateOne', filter });
      fail('before-write', name, 'updateOne');
      if (opts?.bulkIndex !== undefined && bulkFault?.index === opts.bulkIndex && bulkFault.phase === 'before-write') {
        bulkFault = null;
        throw new Error('fixture bulk item failure');
      }
      if (writeGate) {
        const gate = writeGate;
        writeGate = null;
        gate.started();
        await gate.wait;
      }
      if (takeCasMismatch(name, 'updateOne')) {
        return { acknowledged: true, matchedCount: 0, upsertedCount: 0 };
      }
      const old = [...data.values()].find(d => matches(d, filter));
      if (old) data.set(String(old._id), applyUpdate(old, update));
      if (!old && (update.$setOnInsert || opts?.upsert)) {
        const base: Document = {};
        for (const [key, value] of Object.entries(filter)) if (!key.startsWith('$') &&
          (value === null || typeof value !== 'object')) setPath(base, key, value);
        const id = filter._id ?? `fixture-${++nextId}`;
        base._id = id;
        Object.assign(base, update.$setOnInsert ?? {});
        if (data.has(String(id))) throw new Error('duplicate fixture key');
        data.set(String(id), applyUpdate(base, update));
      }
      if (opts?.bulkIndex !== undefined && bulkFault?.index === opts.bulkIndex && bulkFault.phase === 'after-write') {
        bulkFault = null;
        throw new Error('fixture bulk item failure');
      }
      fail('after-write', name, 'updateOne');
      return { acknowledged: true, matchedCount: old ? 1 : 0,
        upsertedCount: !old && (update.$setOnInsert || opts?.upsert) ? 1 : 0 };
    };
    return {
      async createIndex() { return 'fixture-index'; },
      // Note: bulkWrite models an ordered update batch as one synthetic probe wave and one wire 'update' command.
      async bulkWrite(operations: Array<{ updateOne: { filter: Document; update: Document; upsert?: boolean } }>) {
        return dispatch('write', 'bulkWrite', 'update', async () => {
          for (const [idx, operation] of operations.entries()) {
            const { filter, update, upsert } = operation.updateOne;
            await runUpdate(filter, update, { upsert, bulkIndex: idx });
          }
          return { acknowledged: true };
        });
      },
      async insertOne(doc: Document) {
        return dispatch('write', 'insertOne', 'insert', () => {
          calls.push({ collection: name, method: 'insertOne', filter: { _id: doc._id } });
          fail('before-write', name, 'insertOne');
          if (data.has(String(doc._id))) throw new Error('duplicate fixture key');
          data.set(String(doc._id), copy(doc));
          fail('after-write', name, 'insertOne');
          return { acknowledged: true, insertedId: doc._id };
        });
      },
      async deleteOne(filter: Document) {
        return dispatch('write', 'deleteOne', 'delete', () => {
          calls.push({ collection: name, method: 'deleteOne', filter });
          fail('before-write', name, 'deleteOne');
          const found = [...data.values()].find(d => matches(d, filter));
          if (found) data.delete(String(found._id));
          fail('after-write', name, 'deleteOne');
          return { acknowledged: true, deletedCount: found ? 1 : 0 };
        });
      },
      async findOneAndUpdate(filter: Document, update: Document, opts?: { returnDocument?: string }) {
        return dispatch('write', 'findOneAndUpdate', 'findAndModify', () => {
          calls.push({ collection: name, method: 'findOneAndUpdate', filter });
          fail('before-write', name, 'findOneAndUpdate');
          if (takeCasMismatch(name, 'findOneAndUpdate')) return null;
          const old = [...data.values()].find(d => matches(d, filter));
          if (!old) return null;
          const before = copy(old);
          const next = applyUpdate(old, update);
          data.set(String(old._id), copy(next));
          fail('after-write', name, 'findOneAndUpdate');
          return opts?.returnDocument === 'after' ? copy(next) : before;
        });
      },
      async findOne(filter: Document, opts?: { projection?: Document }) {
        return dispatch('read', 'findOne', 'find', () => {
          calls.push({ collection: name, method: 'findOne', filter });
          fail('read', name, 'findOne');
          const found = [...data.values()].find(d => matches(d, filter));
          return found ? projectDocument(found, opts?.projection) : null;
        });
      },
      async updateOne(filter: Document, update: Document, opts?: { upsert?: boolean }) {
        return dispatch('write', 'updateOne', 'update', () => runUpdate(filter, update, opts));
      },
      async replaceOne(filter: Document, next: Document) {
        return dispatch('write', 'replaceOne', 'update', () => {
          calls.push({ collection: name, method: 'replaceOne', filter });
          fail('before-write', name, 'replaceOne');
          if (takeCasMismatch(name, 'replaceOne')) return { acknowledged: true, matchedCount: 0 };
          const old = [...data.values()].find(d => matches(d, filter));
          if (old) data.set(String(old._id), copy(next));
          fail('after-write', name, 'replaceOne');
          return { acknowledged: true, matchedCount: old ? 1 : 0 };
        });
      },
      find(filter: Document, findOpts?: { projection?: Document; sort?: Document; limit?: number }) {
        let result: Document[] = [];
        let sort: Document = findOpts?.sort ?? {};
        let projection: Document | undefined = findOpts?.projection;
        let limit = findOpts?.limit ?? Infinity;
        let initialized: Promise<void> | undefined;
        const initialize = () => initialized ??= dispatch('read', 'find', 'find', () => {
          calls.push({ collection: name, method: 'find', filter });
          fail('read', name, 'find');
          result = [...data.values()].filter(d => matches(d, filter));
          result.sort((a, b) => {
            for (const [key, direction] of Object.entries(sort)) {
              const x = field(a, key), y = field(b, key);
              if (!isDeepStrictEqual(x, y)) return compare(x, y) * Number(direction);
            }
            return 0;
          });
          result = result.slice(0, limit).map(d => projectDocument(d, projection));
        });
        const cursor = {
          sort(spec: Document | string, direction?: number) {
            sort = typeof spec === 'string' ? { [spec]: direction ?? 1 } : spec;
            return cursor;
          },
          project(spec: Document) {
            projection = spec;
            return cursor;
          },
          limit(n: number) { limit = n; return cursor; },
          async toArray() { await initialize(); return result.splice(0).map(copy); },
          async hasNext() { await initialize(); return result.length > 0; },
          async next() { await initialize(); const row = result.shift(); return row ? copy(row) : null; },
          async close() { result = []; },
          async *[Symbol.asyncIterator]() { await initialize(); while (result.length) yield copy(result.shift()!); },
        };
        return cursor;
      },
      aggregate(pipeline: Document[] = []) {
        let result: Document[] = [];
        let initialized: Promise<void> | undefined;
        const initialize = () => initialized ??= dispatch('read', 'aggregate', 'aggregate', () => {
          calls.push({ collection: name, method: 'aggregate', filter: { pipeline } });
          fail('read', name, 'aggregate');
          let current = [...data.values()].map(copy);
          for (const stage of pipeline) {
            if (stage.$match) current = current.filter(d => matches(d, stage.$match as Document));
            else if (stage.$sort) {
              const sortSpec = stage.$sort as Document;
              current.sort((a, b) => {
                for (const [key, direction] of Object.entries(sortSpec)) {
                  const x = field(a, key), y = field(b, key);
                  if (!isDeepStrictEqual(x, y)) return compare(x, y) * Number(direction);
                }
                return 0;
              });
            } else if (typeof stage.$limit === 'number') {
              current = current.slice(0, stage.$limit);
            } else if (stage.$project) {
              current = current.map(d => projectDocument(d, stage.$project as Document));
            }
          }
          result = current;
        });
        const cursor = {
          async toArray() { await initialize(); return result.splice(0).map(copy); },
          async hasNext() { await initialize(); return result.length > 0; },
          async next() { await initialize(); const row = result.shift(); return row ? copy(row) : null; },
          async close() { result = []; },
          async *[Symbol.asyncIterator]() { await initialize(); while (result.length) yield copy(result.shift()!); },
        };
        return cursor;
      },
    };
  } };
  return {
    store: new RecordStore(db as unknown as Db, 1000),
    rows,
    calls,
    wireCalls,
    commandSource,
    failNext: (phase: FakeFaultPhase, match?: { collection?: string; method?: string }) => {
      fault = phase;
      faultMatch = match;
    },
    failBulkItem: (index: number, phase: 'before-write' | 'after-write' = 'before-write') => {
      bulkFault = { index, phase };
    },
    pauseNextUpdate() {
      let started!: () => void;
      let release!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      writeGate = { started, wait };
      return { started: ready, resume: release };
    },
  };
}
