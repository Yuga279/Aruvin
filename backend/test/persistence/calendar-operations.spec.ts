import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import {
  calendarReceiptSchema,
  operationRecordSchema,
} from '../../src/contracts/calendar-operations.js';
import { MongoCalendarOperations } from '../../src/persistence/calendar-operations.js';
import {
  encodeOperationEventCursor,
  operationKey,
  type StoredDocument,
} from '../../src/persistence/calendar-records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { later, operation, operationEvent, sha, source } from './calendar-fixtures.js';

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  if (filter.$or && Array.isArray(filter.$or)) {
    const rest = { ...filter };
    delete rest.$or;
    return matches(doc, rest) && filter.$or.some((part) => matches(doc, part as Record<string, unknown>));
  }
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return true;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>;
      if ('$gt' in ops) return doc[key] > ops.$gt;
      if ('$lte' in ops) return String(doc[key]) <= String(ops.$lte);
    }
    return doc[key] === value;
  });
}

function scripted() {
  const docs = new Map<string, StoredDocument>();
  const calls = { findOne: [] as unknown[], updateOne: [] as unknown[], replaceOne: [] as unknown[] };
  let failUpdate = false;
  const db = {
    collection() {
      return {
        async findOne(filter: Record<string, unknown>) {
          calls.findOne.push(filter);
          return [...docs.values()].find((doc) => matches(doc, filter)) ?? null;
        },
        async updateOne(filter: Record<string, unknown>, update: { $setOnInsert?: StoredDocument }, options?: unknown) {
          calls.updateOne.push({ filter, update, options });
          if (failUpdate) { failUpdate = false; throw new Error('ACK lost'); }
          if (!docs.has(filter._id as string) && update.$setOnInsert) {
            docs.set(filter._id as string, { ...update.$setOnInsert });
          }
          return { acknowledged: true };
        },
        async replaceOne(filter: Record<string, unknown>, doc: StoredDocument) {
          calls.replaceOne.push({ filter, doc });
          const old = docs.get(filter._id as string);
          if (!old || !matches(old, filter)) return { acknowledged: true, matchedCount: 0 };
          docs.set(doc._id, doc);
          return { acknowledged: true, matchedCount: 1 };
        },
        async findOneAndUpdate(filter: Record<string, unknown>, update: { $set?: Record<string, unknown>; $inc?: Record<string, number> }) {
          const old = [...docs.values()].find((doc) => matches(doc, filter));
          if (!old) return null;
          const next = { ...old, ...update.$set };
          for (const [key, amount] of Object.entries(update.$inc ?? {})) next[key] = Number(next[key] ?? 0) + amount;
          docs.set(String(next._id), next);
          return old;
        },
        find(filter: Record<string, unknown>) {
          let rows = [...docs.values()].filter((doc) => matches(doc, filter));
          const cursor = {
            sort(spec: Record<string, number>) {
              const keys = Object.entries(spec);
              rows = [...rows].sort((a, b) => {
                for (const [key, dir] of keys) {
                  if (a[key] === b[key]) continue;
                  return (a[key] > b[key] ? 1 : -1) * dir;
                }
                return 0;
              });
              return cursor;
            },
            limit(count: number) {
              rows = rows.slice(0, count);
              return cursor;
            },
            async toArray() { return rows; },
          };
          return cursor;
        },
      };
    },
  };
  return {
    operations: new MongoCalendarOperations(new RecordStore(db as never, 1000), DEFAULT_BUDGETS),
    docs, calls, loseInsert: () => { failUpdate = true; },
  };
}

const receipt = () => calendarReceiptSchema.parse({
  operationId: 'op1', googleEventId: '0123456789abc', connectionId: 'c1',
  connectionRevision: 1, targetRevision: 1, calendarIdHash: sha, requestHash: sha,
  verifiedAt: later, source: source(), htmlLink: null,
});

it('same accepted turn reserves one operation across attempts', async () => {
  const f = scripted();
  const original = operation();
  const first = await f.operations.reserve(original);
  const retry = await f.operations.reserve({ ...original, originatingAttemptId: 'a2' });
  expect(first.outcome).toBe('created');
  expect(retry.outcome).toBe('existing');
  expect(retry.record.originatingAttemptId).toBe('a1');
  expect(retry.record.googleEventId).toBe(original.googleEventId);
  await f.operations.appendEvent(operationEvent());
  await f.operations.appendEvent(operationEvent());
  await expect(f.operations.appendEvent({ ...operationEvent(), eventId: 'oe2' }))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  await expect(f.operations.reserve(operationRecordSchema.parse({
    ...original, operationId: 'op2', googleEventId: '0123456789abd',
  }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  expect(f.calls.updateOne[0]).toMatchObject({
    filter: { _id: operationKey('u1', 's1', 't1'), userId: 'u1', sessionId: 's1' },
  });
  expect(await f.operations.getByTurn('u2', 's1', 't1')).toBeNull();
});

it('terminal receipt cannot be replaced', async () => {
  const f = scripted();
  const original = operation();
  await f.operations.reserve(original);
  const dispatching = operationRecordSchema.parse({
    ...original, revision: 2, sequence: 2, state: 'dispatching', updatedAt: later,
  });
  expect((await f.operations.compareAndSwap(1, dispatching)).outcome).toBe('confirmed');
  const succeeded = operationRecordSchema.parse({
    ...dispatching, revision: 3, sequence: 3, state: 'succeeded', receipt: receipt(),
    updatedAt: '2026-10-20T10:04:00.000Z',
  });
  expect((await f.operations.compareAndSwap(2, succeeded)).outcome).toBe('confirmed');
  const otherReceipt = calendarReceiptSchema.parse({
    ...receipt(), htmlLink: null, verifiedAt: '2026-10-20T10:05:00.000Z',
  });
  await expect(f.operations.compareAndSwap(3, operationRecordSchema.parse({
    ...succeeded, revision: 4, sequence: 4, receipt: otherReceipt,
    updatedAt: '2026-10-20T10:05:00.000Z',
  }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect((await f.operations.compareAndSwap(3, succeeded)).outcome).toBe('confirmed');
  await expect(f.operations.compareAndSwap(3, operationRecordSchema.parse({
    ...succeeded, revision: 4, sequence: 4, state: 'planned', receipt: null, action: original.action,
    updatedAt: '2026-10-20T10:05:00.000Z',
  }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('operation events reject duplicate sequence with different content', async () => {
  const f = scripted();
  await f.operations.reserve(operation());
  await f.operations.appendEvent(operationEvent());
  await expect(f.operations.appendEvent({ ...operationEvent(), eventId: 'oe2' }))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  await expect(f.operations.appendEvent({ ...operationEvent(), sequence: 2, eventId: 'oe2' }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  const listed = await f.operations.listEvents({ userId: 'u1', operationId: 'op1', cursor: null, limit: 1 });
  expect(listed.items).toEqual([operationEvent()]);
  expect(listed.nextCursor).toBeNull();
  const foreign = encodeOperationEventCursor('u2', 'op1', 1, 'oe1');
  await expect(f.operations.listEvents({ userId: 'u1', operationId: 'op1', cursor: foreign, limit: 1 }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  const dispatching = operationRecordSchema.parse({
    ...operation(), revision: 2, sequence: 2, state: 'dispatching', updatedAt: later,
  });
  expect((await f.operations.compareAndSwap(1, dispatching)).outcome).toBe('confirmed');
  await f.operations.appendEvent({ ...operationEvent(), sequence: 2, eventId: 'oe2', state: 'dispatching' });
  await f.operations.appendEvent({ ...operationEvent(), sequence: 2, eventId: 'oe2', state: 'dispatching' });
  expect((await f.operations.reserve(operation())).outcome).toBe('existing');
});

it('unknown and expired authority never authorize a new create', async () => {
  const expiredStore = scripted();
  await expiredStore.operations.reserve(operation());
  const expired = operationRecordSchema.parse({
    ...operation(), revision: 2, sequence: 2, state: 'evidence-expired', action: null,
    updatedAt: later,
  });
  expect((await expiredStore.operations.compareAndSwap(1, expired)).outcome).toBe('confirmed');
  await expect(expiredStore.operations.reserve(operation())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  const unknownStore = scripted();
  await unknownStore.operations.reserve(operation());
  const dispatching = operationRecordSchema.parse({
    ...operation(), revision: 2, sequence: 2, state: 'dispatching', updatedAt: later,
  });
  expect((await unknownStore.operations.compareAndSwap(1, dispatching)).outcome).toBe('confirmed');
  const unknown = operationRecordSchema.parse({
    ...dispatching, revision: 3, sequence: 3, state: 'unknown',
    updatedAt: '2026-10-20T10:04:00.000Z',
  });
  expect((await unknownStore.operations.compareAndSwap(2, unknown)).outcome).toBe('confirmed');
  const reused = await unknownStore.operations.reserve({ ...operation(), originatingAttemptId: 'a9' });
  expect(reused.outcome).toBe('existing');
  expect(reused.record.state).toBe('unknown');
  expect(reused.record.googleEventId).toBe(operation().googleEventId);
  await expect(unknownStore.operations.compareAndSwap(3, operationRecordSchema.parse({
    ...unknown, revision: 4, sequence: 4, state: 'planned',
    updatedAt: '2026-10-20T10:05:00.000Z',
  }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

  const corrupt = scripted();
  corrupt.docs.set(operationKey('u1', 's1', 't1'), {
    ...operation(), _id: operationKey('u1', 's1', 't1'), _revision: 0, schemaVersion: 2,
  } as StoredDocument);
  await expect(corrupt.operations.getByTurn('u1', 's1', 't1')).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
  await expect(corrupt.operations.reserve(operation())).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
});
