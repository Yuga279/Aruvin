import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { connectionRecordSchema } from '../../src/contracts/calendar-connections.js';
import { rejectedDecisionSchema, resumableDecisionSchema } from '../../src/contracts/calendar-model.js';
import { calendarToolResultRecordSchema, sourceReferenceSchema } from '../../src/contracts/calendar-sources.js';
import { MongoCalendarDecisions, MongoCalendarResults } from '../../src/persistence/calendar-evidence.js';
import { connectionKey, encodeCalendar, type StoredDocument } from '../../src/persistence/calendar-records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { connection, later, now, sha, source } from './calendar-fixtures.js';

function scripted(clock = () => Date.parse(now)) {
  const docs = new Map<string, StoredDocument>();
  const savedDriverPayloads: unknown[] = [];
  const currentConnection = connection();
  const connectionDoc = encodeCalendar(connectionRecordSchema, currentConnection, connectionKey('u1'),
    DEFAULT_BUDGETS.maxDocumentBytes).doc;
  docs.set(connectionDoc._id, connectionDoc);
  const db = {
    collection() {
      return {
        async findOne(filter: Record<string, unknown>) {
          return [...docs.values()].find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) ?? null;
        },
        async updateOne(filter: Record<string, unknown>, update: { $setOnInsert?: StoredDocument }) {
          savedDriverPayloads.push(update.$setOnInsert);
          if (!docs.has(filter._id as string) && update.$setOnInsert) {
            docs.set(filter._id as string, { ...update.$setOnInsert });
          }
          return { acknowledged: true };
        },
      };
    },
  };
  const store = new RecordStore(db as never, 1000);
  return {
    decisions: new MongoCalendarDecisions(store, DEFAULT_BUDGETS, clock),
    results: new MongoCalendarResults(store, DEFAULT_BUDGETS, clock),
    savedDriverPayloads, docs,
  };
}

const rejected = () => rejectedDecisionSchema.parse({
  schemaVersion: 1, kind: 'calendar-rejected-decision', userId: 'u1', sessionId: 's1',
  turnId: 't1', attemptId: 'a1', decisionId: 'dec1', dispatchId: 'd1', dispatchIndex: 1,
  repairsUsed: 0, rawArgumentsSha256: sha,
  diagnostics: [{ path: 'start', code: 'wrong-type', expected: 'string' }], createdAt: now,
});

const event = {
  eventId: '0123456789abc', summary: 'Fixture event', start: '2026-10-21T10:00:00Z',
  end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC', status: 'confirmed' as const, htmlLink: null,
};

const retainedResult = () => calendarToolResultRecordSchema.parse({
  schemaVersion: 1, kind: 'calendar-tool-result', userId: 'u1', sessionId: 's1', turnId: 't1',
  attemptId: 'a1', decisionId: 'dec1', eventId: 'e1', sequence: 1, toolCallId: 'tc1',
  createdAt: now, resultRef: {
    storage: 'retained', source: source(), toolCallId: 'tc1', operationId: 'op1',
    result: { tool: 'calendar_get_event', event },
  },
});

it('rejected decisions persist hashes and bounded diagnostics only', async () => {
  const f = scripted();
  await f.decisions.putRejected(rejected());
  await f.decisions.putRejected(rejected());
  await expect(f.decisions.putRejected({ ...rejected(), rawArgumentsSha256: 'b'.repeat(64) }))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  expect(JSON.stringify(f.savedDriverPayloads)).not.toContain('fixture-refresh');
  expect(() => rejectedDecisionSchema.parse({
    ...rejected(),
    diagnostics: Array.from({ length: 11 }, () => ({ path: 'start', code: 'wrong-type', expected: 'string' })),
  })).toThrow();
  expect(() => rejectedDecisionSchema.parse({
    ...rejected(),
    diagnostics: [{ path: 'start', code: 'wrong-type', expected: 'string', extra: 'x'.repeat(2048) }],
  })).toThrow();
});

it('decision and result links cannot be reassigned', async () => {
  const f = scripted();
  const decision = resumableDecisionSchema.parse({
    schemaVersion: 1, kind: 'calendar-model-decision', userId: 'u1', sessionId: 's1', turnId: 't1',
    attemptId: 'a1', decisionId: 'dec1', dispatchId: 'd1', configRevision: 1, connectionId: 'c1',
    connectionRevision: 1, schemaRevision: 'google-calendar.v1', rejectedDecisionId: null,
    decision: { kind: 'text', decisionId: 'dec1', content: 'Hello', truncated: false },
    sources: [], operationId: 'op1', createdAt: now,
  });
  await f.decisions.put(decision);
  await f.decisions.put(decision);
  await expect(f.decisions.put({ ...decision, dispatchId: 'd2' }))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  await f.results.put(retainedResult());
  await expect(f.results.put({ ...retainedResult(), decisionId: 'dec2' }))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
});

it('volatile content never enters durable evidence', async () => {
  const f = scripted();
  const volatile = sourceReferenceSchema.parse({
    ...source(), expiresAt: now,
    permission: { content: 'volatile', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
  });
  expect(() => calendarToolResultRecordSchema.parse({
    ...retainedResult(), resultRef: { ...retainedResult().resultRef, source: volatile },
  })).toThrow();
  expect(() => calendarToolResultRecordSchema.parse({
    ...retainedResult(),
    resultRef: { ...retainedResult().resultRef, source: { ...source(), operationIds: ['other'] } },
  })).toThrow();
  expect(() => calendarToolResultRecordSchema.parse({
    ...retainedResult(),
    resultRef: {
      ...retainedResult().resultRef,
      source: { ...source(), permission: { ...source().permission, minimalEvidenceAllowed: false } },
    },
  })).toThrow();
  await f.results.put(retainedResult());
  expect(JSON.stringify(f.savedDriverPayloads)).not.toContain('fixture-refresh');
  expect(() => calendarToolResultRecordSchema.parse({
    ...retainedResult(),
    resultRef: {
      ...retainedResult().resultRef,
      result: { tool: 'calendar_get_event', event: { ...event, description: 'x'.repeat(16000) } },
    },
  })).toThrow();
});

it('expired results read as source-linked tombstones', async () => {
  let nowMs = Date.parse(now);
  const f = scripted(() => nowMs);
  await f.results.put(retainedResult());
  nowMs = Date.parse(later) + 3_600_000;
  const read = await f.results.get('u1', 's1', 'tc1');
  expect(read?.resultRef.storage).toBe('tombstone');
  expect(read?.resultRef).toMatchObject({
    storage: 'tombstone', reason: 'expired', operationId: 'op1', toolCallId: 'tc1',
  });
  expect(JSON.stringify(read)).not.toContain('Fixture event');
  const decision = resumableDecisionSchema.parse({
    schemaVersion: 1, kind: 'calendar-model-decision', userId: 'u1', sessionId: 's1', turnId: 't1',
    attemptId: 'a1', decisionId: 'dec2', dispatchId: 'd2', configRevision: 1, connectionId: 'c1',
    connectionRevision: 1, schemaRevision: 'google-calendar.v1', rejectedDecisionId: null,
    decision: { kind: 'text', decisionId: 'dec2', content: 'Fetched event details', truncated: false },
    sources: [source()], operationId: 'op1', createdAt: now,
  });
  nowMs = Date.parse(now);
  await f.decisions.put(decision);
  nowMs = Date.parse(source().expiresAt);
  expect(await f.decisions.get('u1', 'dec2')).toMatchObject({ decision: null });
});
