import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import {
  connectionRecordSchema,
  oauthStateSchema,
} from '../../src/contracts/calendar-connections.js';
import {
  operationEventSchema,
  operationRecordSchema,
} from '../../src/contracts/calendar-operations.js';
import { sourceReferenceSchema } from '../../src/contracts/calendar-sources.js';
import {
  modelDispatchSchema,
  turnBudgetRecordSchema,
} from '../../src/contracts/calendar-accounting.js';
import { sessionRecordSchema } from '../../src/contracts/session.js';
import { APP_INDEXES, CALENDAR_INDEXES } from '../../src/persistence/indexes.js';
import { RecordStore } from '../../src/persistence/store.js';
import { session } from './fixtures.js';
import {
  budget,
  connection,
  dispatch,
  oauthState,
  operation,
  operationEvent,
  source,
} from './calendar-fixtures.js';

it('fixtures obey frozen bounds', () => {
  expect(connectionRecordSchema.parse(connection())).toEqual(connection());
  expect(oauthStateSchema.parse(oauthState())).toEqual(oauthState());
  expect(operationRecordSchema.parse(operation())).toEqual(operation());
  expect(operationEventSchema.parse(operationEvent())).toEqual(operationEvent());
  expect(turnBudgetRecordSchema.parse(budget())).toEqual(budget());
  expect(modelDispatchSchema.parse(dispatch())).toEqual(dispatch());
  expect(sourceReferenceSchema.parse(source())).toEqual(source());
  expect('sessionId' in connection()).toBe(false);
  expect('sessionId' in oauthState()).toBe(false);
  expect(() => connectionRecordSchema.parse({ ...connection(), extra: true })).toThrow();
  expect(() =>
    sourceReferenceSchema.parse({ ...source(), operationIds: Array.from({ length: 7 }, () => 'op1') }),
  ).toThrow();
  expect(() => turnBudgetRecordSchema.parse({ ...budget(), modelDispatches: 9 })).toThrow();
  expect(() => modelDispatchSchema.parse({ ...dispatch(), dispatchIndex: 9 })).toThrow();
});

it('user-only keys omit undefined session scope', async () => {
  const updateOne = vi.fn(async (_filter: Record<string, unknown>, update: { $setOnInsert: Record<string, unknown> }) => {
    findOne.mockResolvedValueOnce({ ...update.$setOnInsert });
    return { acknowledged: true };
  });
  const findOne = vi.fn(async () => null);
  const replaceOne = vi.fn(async () => ({ acknowledged: true, matchedCount: 1 }));
  const store = new RecordStore(
    { collection: () => ({ updateOne, findOne, replaceOne }) } as never,
    1000,
  );
  const record = connection();
  await store.insert(
    'integration_connections',
    connectionRecordSchema,
    record,
    'cid',
    DEFAULT_BUDGETS.maxDocumentBytes,
  );
  const connectionFilter = updateOne.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(connectionFilter).toEqual({ _id: 'cid', userId: 'u1' });
  expect(Object.hasOwn(connectionFilter, 'sessionId')).toBe(false);

  const sessionRecord = session();
  await store.insert(
    'sessions',
    sessionRecordSchema,
    sessionRecord,
    'sid',
    DEFAULT_BUDGETS.maxDocumentBytes,
  );
  const sessionFilter = updateOne.mock.calls[1]?.[0] as Record<string, unknown>;
  expect(sessionFilter).toEqual({ _id: 'sid', userId: 'u1', sessionId: 's1' });

  findOne.mockResolvedValueOnce({ ...sessionRecord, _id: 'sid', _revision: 1 });
  await store.replace(
    'sessions',
    sessionRecordSchema,
    sessionRecord,
    'sid',
    0,
    DEFAULT_BUDGETS.maxDocumentBytes,
  );
  const replaceFilter = replaceOne.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(replaceFilter).toEqual({ _id: 'sid', userId: 'u1', sessionId: 's1', _revision: 0 });
});

it('Calendar indexes are additive partial unique indexes without TTL', () => {
  const appIndexes = APP_INDEXES.filter((index) => index.collection !== 'users');
  expect(appIndexes).toHaveLength(11);
  expect(appIndexes.every((index) => index.options.unique !== true)).toBe(true);
  expect(appIndexes.every((index) => index.options.partialFilterExpression === undefined)).toBe(true);
  expect(appIndexes.every((index) => index.options.expireAfterSeconds === undefined)).toBe(true);
  expect(CALENDAR_INDEXES.map((index) => index.options.name)).toEqual([
    'calendar_owner',
    'calendar_connection_identity',
    'calendar_oauth_hash',
    'calendar_operation_turn',
    'calendar_operation_identity',
    'calendar_operation_event_sequence',
    'calendar_operation_event_identity',
    'calendar_budget_turn',
    'calendar_dispatch_identity',
    'calendar_dispatch_order',
    'calendar_dispatch_generation',
    'calendar_aggregate_attempt',
    'calendar_decision_identity',
    'calendar_result_identity',
    'calendar_source_identity',
    'calendar_message_source',
    'calendar_audit_expiry',
    'calendar_pending_proposal_session',
    'calendar_proposal_identity',
    'calendar_operation_intent',
    'calendar_intent_reservation',
    'calendar_consumption_intent',
    'calendar_consumption_proposal',
    'calendar_content_expiry',
    'calendar_invalidation_source',
    'calendar_invalidation_decision',
    'calendar_invalidation_result',
    'calendar_invalidation_operation',
    'calendar_invalidation_proposal',
    'calendar_invalidation_message',
  ]);
  expect(CALENDAR_INDEXES.every((index) => index.options.expireAfterSeconds === undefined)).toBe(true);
  expect(CALENDAR_INDEXES.find((index) => index.options.name === 'calendar_owner')).toMatchObject({
    collection: 'integration_connections',
    keys: { userId: 1, provider: 1 },
    options: { unique: true },
  });
  expect(CALENDAR_INDEXES.find((index) => index.options.name === 'calendar_oauth_hash')).toMatchObject({
    collection: 'metadata',
    keys: { stateHash: 1 },
    options: {
      unique: true,
      partialFilterExpression: { kind: 'calendar-oauth-state' },
    },
  });
  expect(CALENDAR_INDEXES.find((index) => index.options.name === 'calendar_operation_turn')).toMatchObject({
    keys: { userId: 1, sessionId: 1, turnId: 1 },
    options: {
      unique: true,
      partialFilterExpression: {
        kind: { $in: ['calendar-operation', 'calendar-operation-tombstone'] },
      },
    },
  });
  expect(CALENDAR_INDEXES.find((index) => index.options.name === 'calendar_dispatch_generation')).toMatchObject({
    keys: { userId: 1, generationId: 1 },
    options: {
      unique: true,
      partialFilterExpression: {
        kind: 'calendar-model-dispatch',
        generationId: { $type: 'string' },
      },
    },
  });
  const messageSource = CALENDAR_INDEXES.find((index) => index.options.name === 'calendar_message_source');
  expect(messageSource).toMatchObject({
    collection: 'messages',
    keys: { userId: 1, sessionId: 1, 'sourceProvenance.sourceId': 1 },
  });
  expect(messageSource?.options.unique).not.toBe(true);
  const auditExpiry = CALENDAR_INDEXES.find((index) => index.options.name === 'calendar_audit_expiry');
  expect(auditExpiry).toMatchObject({
    collection: 'metadata',
    keys: { kind: 1, '_calendarAudit.expiresAt': 1, _id: 1 },
  });
  expect(auditExpiry?.options.unique).not.toBe(true);
  expect(auditExpiry?.options.expireAfterSeconds).toBeUndefined();
});
