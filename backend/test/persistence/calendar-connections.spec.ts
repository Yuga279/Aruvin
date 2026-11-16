import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { connectionRecordSchema } from '../../src/contracts/calendar-connections.js';
import { MongoCalendarConnections } from '../../src/persistence/calendar-connections.js';
import {
  connectionKey,
  oauthKey,
  type StoredDocument,
} from '../../src/persistence/calendar-records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { connection, later, oauthState, sha, secretEnvelope } from './calendar-fixtures.js';

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>;
      if ('$lte' in ops) return String(doc[key]) <= String(ops.$lte);
      if ('$gt' in ops) return String(doc[key]) > String(ops.$gt);
      if ('$gte' in ops) return String(doc[key]) >= String(ops.$gte);
      if ('$lt' in ops) return String(doc[key]) < String(ops.$lt);
    }
    return doc[key] === value;
  });
}

function scripted() {
  const docs = new Map<string, StoredDocument>();
  const calls = {
    findOne: [] as unknown[],
    updateOne: [] as unknown[],
    replaceOne: [] as unknown[],
    findOneAndUpdate: [] as unknown[],
  };
  let failUpdate = false;
  let failReplace = false;
  let failConsume = false;
  const db = {
    collection() {
      return {
        async findOne(filter: Record<string, unknown>) {
          calls.findOne.push(filter);
          return [...docs.values()].find((doc) => matches(doc, filter)) ?? null;
        },
        async updateOne(filter: Record<string, unknown>, update: { $setOnInsert?: StoredDocument }, options?: unknown) {
          calls.updateOne.push({ filter, update, options });
          if (failUpdate) {
            failUpdate = false;
            throw new Error('ACK lost');
          }
          if (!docs.has(filter._id as string) && update.$setOnInsert) {
            docs.set(filter._id as string, { ...update.$setOnInsert });
          }
          return { acknowledged: true, matchedCount: docs.has(filter._id as string) ? 1 : 0, upsertedCount: 1 };
        },
        async replaceOne(filter: Record<string, unknown>, doc: StoredDocument, options?: unknown) {
          calls.replaceOne.push({ filter, doc, options });
          const old = docs.get(filter._id as string);
          if (!old || !matches(old, filter)) {
            if (failReplace) {
              failReplace = false;
              throw new Error('ACK lost');
            }
            return { acknowledged: true, matchedCount: 0 };
          }
          docs.set(doc._id, doc);
          if (failReplace) {
            failReplace = false;
            throw new Error('ACK lost');
          }
          return { acknowledged: true, matchedCount: 1 };
        },
        async findOneAndUpdate(
          filter: Record<string, unknown>,
          update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown>; $inc?: Record<string, number> },
          options?: Record<string, unknown>,
        ) {
          calls.findOneAndUpdate.push({ filter, update, options });
          const old = [...docs.values()].find((doc) => matches(doc, filter));
          if (failConsume) {
            failConsume = false;
            throw new Error('ACK lost');
          }
          if (!old) return null;
          const next: StoredDocument = { ...old, ...update.$set };
          for (const key of Object.keys(update.$unset ?? {})) delete next[key];
          for (const [key, amount] of Object.entries(update.$inc ?? {})) {
            next[key] = Number(next[key] ?? 0) + amount;
          }
          docs.set(String(next._id), next);
          return options?.returnDocument === 'after' ? next : old;
        },
      };
    },
  };
  const store = new MongoCalendarConnections(new RecordStore(db as never, 1000), DEFAULT_BUDGETS);
  return {
    store, docs, calls,
    loseInsert: () => { failUpdate = true; },
    loseReplace: () => { failReplace = true; },
    loseConsume: () => { failConsume = true; },
  };
}

it('one owner key survives connection replacement', async () => {
  const f = scripted();
  const first = connection();
  expect((await f.store.create(first)).outcome).toBe('confirmed');
  expect(f.calls.updateOne[0]).toMatchObject({
    filter: { _id: connectionKey('u1'), userId: 'u1' },
  });
  expect(Object.hasOwn((f.calls.updateOne[0] as { filter: object }).filter, 'sessionId')).toBe(false);
  const otherConnection = connectionRecordSchema.parse({ ...first, connectionId: 'c2' });
  expect((await f.store.create(otherConnection)).outcome).toBe('conflict');
  const replaced = connectionRecordSchema.parse({
    ...first, revision: 2, connectionRevision: 2, googleSubjectId: 'google-sub2',
    accountEmail: 'other@example.invalid', calendarId: 'other-calendar', targetRevision: 2,
    updatedAt: later,
  });
  expect((await f.store.compareAndSwap('u1', 1, replaced)).outcome).toBe('confirmed');
  expect([...f.docs.values()].filter((doc) => doc.userId === 'u1')).toHaveLength(1);
  expect(f.docs.get(connectionKey('u1'))).toMatchObject({ connectionId: 'c1', googleSubjectId: 'google-sub2' });
  const otherUser = connectionRecordSchema.parse({ ...first, userId: 'u2' });
  expect((await f.store.create(otherUser)).outcome).toBe('confirmed');
  expect(await f.store.get('u1')).toMatchObject({ userId: 'u1', googleSubjectId: 'google-sub2' });
  expect(await f.store.get('u2')).toMatchObject({ userId: 'u2' });
  expect(f.calls.findOne.some((filter) => {
    const row = filter as Record<string, unknown>;
    return row._id === connectionKey('u1') && row.userId === 'u1' && row.provider === 'google-calendar';
  })).toBe(true);
});

it('rotation CAS never restores a stale token', async () => {
  const f = scripted();
  const first = connection();
  expect((await f.store.create(first)).outcome).toBe('confirmed');
  const rotated = connectionRecordSchema.parse({
    ...first, revision: 2, credentialVersion: 2, updatedAt: later,
    credentials: {
      access: { ...secretEnvelope, ciphertext: 'Yg==' },
      refresh: { ...secretEnvelope, ciphertext: 'Yw==' },
    },
  });
  expect((await f.store.compareAndSwap('u1', 1, rotated)).outcome).toBe('confirmed');
  expect(f.calls.replaceOne[0]).toMatchObject({
    filter: {
      _id: connectionKey('u1'), userId: 'u1', provider: 'google-calendar',
      revision: 1, _revision: 0,
    },
  });
  expect((await f.store.compareAndSwap('u1', 1, { ...rotated, credentialVersion: 3 })).outcome).toBe('conflict');
  expect((await f.store.compareAndSwap('u1', 1, rotated)).outcome).toBe('confirmed');
  await expect(f.store.compareAndSwap('u1', 2, connectionRecordSchema.parse({
    ...rotated, revision: 3, updatedAt: '2026-10-20T10:04:00.000Z',
    credentials: first.credentials,
  }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.store.compareAndSwap('u1', 2, connectionRecordSchema.parse({
    ...rotated, revision: 3, credentialVersion: 2, updatedAt: '2026-10-20T10:04:00.000Z',
    googleSubjectId: 'google-sub2',
  }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  const disconnected = connectionRecordSchema.parse({
    ...rotated, revision: 3, connectionRevision: 2, credentialVersion: 3,
    enabled: false, status: 'disconnected', credentials: null, tokenExpiresAt: null,
    updatedAt: '2026-10-20T10:04:00.000Z',
  });
  expect((await f.store.compareAndSwap('u1', 2, disconnected)).outcome).toBe('confirmed');
  expect(await f.store.get('u1')).toMatchObject({ status: 'disconnected', credentials: null, enabled: false });
});

it('state is consumed once only before expiry', async () => {
  const f = scripted();
  const first = connection();
  expect((await f.store.create(first)).outcome).toBe('confirmed');
  const rotated = { ...first, revision: 2, credentialVersion: 2, updatedAt: later };
  expect((await f.store.compareAndSwap('u1', 1, rotated)).outcome).toBe('confirmed');
  expect((await f.store.compareAndSwap('u1', 1, { ...rotated, credentialVersion: 3 })).outcome).toBe('conflict');
  await f.store.putState(oauthState());
  expect(f.calls.updateOne.some((call) => {
    const row = call as { filter: Record<string, unknown> };
    return row.filter._id === oauthKey(sha) && row.filter.userId === 'u1' && !Object.hasOwn(row.filter, 'sessionId');
  })).toBe(true);
  const request = { userId: 'u1', stateHash: sha, browserHash: 'b'.repeat(64), now: later };
  expect(await f.store.consumeState(request)).toEqual(oauthState());
  expect(f.calls.findOneAndUpdate[0]).toMatchObject({
    filter: {
      _id: oauthKey(sha), kind: 'calendar-oauth-state', userId: 'u1',
      stateHash: sha, browserHash: 'b'.repeat(64), consumedAt: null,
      createdAt: { $lte: later }, expiresAt: { $gt: later },
    },
    update: {
      $set: { kind: 'calendar-oauth-state-tombstone', consumedAt: later, reason: 'consumed' },
      $unset: { encryptedVerifier: '', browserHash: '', oidcNonceHash: '', redirectUri: '' },
      $inc: { _revision: 1 },
    },
    options: { returnDocument: 'before', includeResultMetadata: false },
  });
  expect(await f.store.consumeState(request)).toBeNull();
  const tombstone = f.docs.get(oauthKey(sha));
  expect(tombstone).toMatchObject({ kind: 'calendar-oauth-state-tombstone', reason: 'consumed' });
  expect(tombstone).not.toHaveProperty('encryptedVerifier');
  expect(tombstone).not.toHaveProperty('browserHash');
  await expect(f.store.putState(oauthState())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('unknown writes never authorize token exchange', async () => {
  const f = scripted();
  await f.store.putState(oauthState());
  expect(await f.store.consumeState({
    userId: 'u2', stateHash: sha, browserHash: 'b'.repeat(64), now: later,
  })).toBeNull();
  expect(await f.store.consumeState({
    userId: 'u1', stateHash: sha, browserHash: 'd'.repeat(64), now: later,
  })).toBeNull();
  expect(await f.store.consumeState({
    userId: 'u1', stateHash: sha, browserHash: 'b'.repeat(64), now: oauthState().expiresAt,
  })).toBeNull();
  f.docs.set(oauthKey(sha), {
    ...oauthState(), _id: oauthKey(sha), _revision: 0, schemaVersion: 2, kind: 'calendar-oauth-state',
  } as StoredDocument);
  const beforeCorrupt = f.calls.findOneAndUpdate.length;
  await expect(f.store.consumeState({
    userId: 'u1', stateHash: sha, browserHash: 'b'.repeat(64), now: later,
  })).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  expect(f.calls.findOneAndUpdate).toHaveLength(beforeCorrupt);
  f.loseInsert();
  const missing = scripted();
  missing.loseInsert();
  expect((await missing.store.create(connection())).outcome).toBe('uncertain');
  const raced = scripted();
  await raced.store.create(connection());
  raced.loseReplace();
  const rotated = connectionRecordSchema.parse({
    ...connection(), revision: 2, credentialVersion: 2, updatedAt: later,
  });
  raced.docs.set(connectionKey('u1'), { ...connection(), _id: connectionKey('u1'), _revision: 0, revision: 3 } as StoredDocument);
  expect((await raced.store.compareAndSwap('u1', 1, rotated)).outcome).toBe('conflict');
});
