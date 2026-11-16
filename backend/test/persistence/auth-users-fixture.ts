/**
 * ============================================================================
 * FILE: auth-users-fixture.ts
 * LOCATION: backend/test/persistence/auth-users-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Isolate users-repository tests on a RecordStore-backed fake collection.
 *
 * ROLE IN PROJECT:
 *    Exercises real confirmed-receipt CAS without a Mongo client or a second
 *    in-memory account implementation.
 *
 * KEY COMPONENTS:
 *    - usersStore(): Fake users collection with uniqueness and paging queries.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import type { Db } from 'mongodb';
import { vi } from 'vitest';
import { RecordStore } from '../../src/persistence/store.js';
import type { StoredDocument } from '../../src/persistence/records.js';
export function usersStore() {
  const documents = new Map<string, StoredDocument>();
  const matches = (d: StoredDocument, q: Record<string, unknown>) => Object.entries(q)
    .every(([k, v]) => isDeepStrictEqual(d[k], v));
  const collection = {
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      structuredClone([...documents.values()].find(d => matches(d, filter)) ?? null)),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $setOnInsert: StoredDocument }) => {
      const existing = documents.get(String(filter._id));
      if (existing) return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
      const d = update.$setOnInsert;
      if ([...documents.values()].some(x => x.workosUserId === d.workosUserId || x.emailNormalized === d.emailNormalized))
        throw new Error('duplicate-key');
      documents.set(d._id, structuredClone(d));
      return { acknowledged: true, matchedCount: 0, upsertedCount: 1 };
    }),
    replaceOne: vi.fn(async (filter: Record<string, unknown>, next: StoredDocument) => {
      const old = documents.get(String(filter._id));
      if (!old || !matches(old, filter)) return { acknowledged: true, matchedCount: 0 };
      documents.set(next._id, structuredClone(next));
      return { acknowledged: true, matchedCount: 1 };
    }),
    find: vi.fn((filter: { $or?: [{ createdAt: { $lt: string } }, { createdAt: string; userId: { $lt: string } }] }) => {
      const branches = filter.$or;
      let rows = [...documents.values()].filter(d => !branches ||
        String(d.createdAt) < branches[0].createdAt.$lt ||
        (d.createdAt === branches[1].createdAt && String(d.userId) < branches[1].userId.$lt));
      const cursor = {
        sort: vi.fn(() => {
          rows.sort((a, b) => {
            const left = [String(a.createdAt), String(a.userId)];
            const right = [String(b.createdAt), String(b.userId)];
            return left[0]! > right[0]! ? -1 : left[0]! < right[0]! ? 1 : left[1]! > right[1]! ? -1 : left[1]! < right[1]! ? 1 : 0;
          });
          return cursor;
        }),
        limit: vi.fn((limit: number) => { rows = rows.slice(0, limit); return cursor; }),
        toArray: vi.fn(async () => structuredClone(rows)),
      };
      return cursor;
    }),
  };
  const db = { collection: () => collection } as unknown as Db;
  return { documents, collection, store: new RecordStore(db, 1000), owner: { assertExecutor: vi.fn(async () => undefined) } };
}
