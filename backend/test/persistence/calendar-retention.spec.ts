import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { sourceReferenceSchema } from '../../src/contracts/calendar-sources.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { MongoCalendarOperations } from '../../src/persistence/calendar-operations.js';
import { redactCalendarMessage } from '../../src/persistence/calendar-records.js';
import { MongoCalendarRetention } from '../../src/persistence/calendar-retention.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { RecordStore } from '../../src/persistence/store.js';
import { type StoredDocument } from '../../src/persistence/calendar-records.js';
import { message } from './fixtures.js';
import { later, now, operation, source } from './calendar-fixtures.js';

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  if (filter.$in && Array.isArray(filter.$in)) return false;
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$in' in (value as object)) {
      return (value as { $in: unknown[] }).$in.includes(doc[key]);
    }
    return doc[key] === value;
  });
}

function scripted(clock = () => Date.parse(now)) {
  const docs = new Map<string, StoredDocument>();
  const db = {
    collection() {
      return {
        async findOne(filter: Record<string, unknown>) {
          return [...docs.values()].find((doc) => matches(doc, filter)) ?? null;
        },
        async updateOne(filter: Record<string, unknown>, update: { $setOnInsert?: StoredDocument }) {
          if (!docs.has(filter._id as string) && update.$setOnInsert) {
            docs.set(filter._id as string, { ...update.$setOnInsert });
          }
          return { acknowledged: true };
        },
        async replaceOne(filter: Record<string, unknown>, doc: StoredDocument) {
          const old = docs.get(filter._id as string);
          if (!old || !matches(old, filter)) return { acknowledged: true, matchedCount: 0 };
          docs.set(doc._id, doc);
          return { acknowledged: true, matchedCount: 1 };
        },
        find(filter: Record<string, unknown>) {
          let rows = [...docs.values()].filter((doc) => matches(doc, filter));
          const cursor = {
            sort() { return cursor; },
            limit(count: number) { rows = rows.slice(0, count); return cursor; },
            async toArray() { return rows; },
          };
          return cursor;
        },
      };
    },
  };
  const store = new RecordStore(db as never, 1000);
  return {
    retention: new MongoCalendarRetention(store, DEFAULT_BUDGETS, clock),
    messages: new MongoMessages(store, DEFAULT_BUDGETS, clock),
    operations: new MongoCalendarOperations(store, DEFAULT_BUDGETS),
    docs, store,
  };
}

it('keeps retrieved calendar details in the visible transcript after source expiry', () => {
  const early = { ...source(), expiresAt: '2026-10-20T10:05:00.000Z' };
  const second = { ...source(), sourceId: 'src2' };
  const derived = {
    ...message(2), role: 'assistant' as const, content: 'Fetched event details',
    sourceProvenance: [early, second],
  };
  const clock = () => Date.parse('2026-10-20T10:05:00.000Z');
  expect(redactCalendarMessage(derived, clock())).toMatchObject({
    content: 'Fetched event details',
    sourceProvenance: [early, second],
  });
  expect(redactCalendarMessage(message(0), clock()).content).toBe('Hello');
  const withVoice = redactCalendarMessage({
    ...derived,
    voiceTranscripts: [{ role: 'assistant', content: 'Fetched event details' }],
  }, clock());
  expect(withVoice.voiceTranscripts?.[0]?.content).toBe('Fetched event details');
});

it('zero permission never persists Calendar content', async () => {
  const f = scripted();
  const denied = sourceReferenceSchema.parse({
    ...source(),
    permission: { content: 'volatile', minimalEvidenceAllowed: false, policyId: 'fixture-policy' },
    expiresAt: now,
  });
  await expect(f.retention.registerSource({ userId: 'u1', sessionId: 's1', source: denied }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.messages.append(messageRecordSchema.parse({
    ...message(0), sourceProvenance: [source()],
  }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

it('archive keeps expired assistant calendar details and user input', async () => {
  let nowMs = Date.parse(now);
  const f = scripted(() => nowMs);
  await f.messages.append(message(0));
  await f.messages.append(messageRecordSchema.parse({
    ...message(2), role: 'assistant', content: 'Fetched event details',
    sourceProvenance: [source()],
  }));
  nowMs = Date.parse(source().expiresAt);
  expect((await f.messages.get('u1', 's1', 'm0'))?.content).toBe('Hello');
  expect((await f.messages.get('u1', 's1', 'm2'))?.content).toBe('Fetched event details');
});

it('cleanup cannot erase unresolved create quarantine', async () => {
  const f = scripted();
  await f.operations.reserve(operation());
  const dispatching = { ...operation(), revision: 2, sequence: 2, state: 'dispatching' as const, updatedAt: later };
  await f.operations.compareAndSwap(1, dispatching);
  const unknown = { ...dispatching, revision: 3, sequence: 3, state: 'unknown' as const, updatedAt: '2026-10-20T10:04:00.000Z' };
  await f.operations.compareAndSwap(2, unknown);
  await f.retention.expireAuditPage({ userId: 'u1', now: '2026-12-01T00:00:00.000Z', cursor: null, limit: 20 });
  expect(await f.operations.getByTurn('u1', 's1', 't1')).toMatchObject({ state: 'unknown', operationId: 'op1' });
  await expect(f.operations.reserve({ ...operation(), googleEventId: '0123456789abd', operationId: 'op9' }))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
});

it('audit expiry never makes a retryable turn new', async () => {
  const f = scripted();
  await f.operations.reserve(operation());
  await f.retention.expireAuditPage({ userId: 'u1', now: '2026-12-01T00:00:00.000Z', cursor: null, limit: 20 });
  const existing = await f.operations.reserve({ ...operation(), originatingAttemptId: 'a9' });
  expect(existing.outcome).toBe('existing');
  expect(existing.record.googleEventId).toBe(operation().googleEventId);
});
