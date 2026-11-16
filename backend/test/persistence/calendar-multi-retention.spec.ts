/**
 * ============================================================================
 * FILE: calendar-multi-retention.spec.ts
 * LOCATION: backend/test/persistence/calendar-multi-retention.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify multi-calendar data retention, TTL expiry sweeps, and content redaction.
 *
 * ROLE IN PROJECT:
 *    Ensures MongoCalendarRetention safely sweeps proposal and operation content
 *    without erasing consumed intent authority, receipt hashes, or unknown-operation quarantine.
 *
 * KEY COMPONENTS:
 *    - sweepMultiCalendarPage: Paginated cursor-based sweep across metadata and connections.
 *    - Preserves deduplication authority on expired proposals and operations.
 *    - Redacts sensitive event content, labels, and links while preserving causal identity.
 *    - Preserves user-authored messages from false redaction.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { calendarSourceRecordSchema, MongoCalendarRetention } from '../../src/persistence/calendar-retention.js';
import { MongoCalendarProposals } from '../../src/persistence/calendar-proposals.js';
import { MongoCalendarOperations } from '../../src/persistence/calendar-operations.js';
import { MongoCalendarConnections } from '../../src/persistence/calendar-connections.js';
import { MongoCalendarDecisions, MongoCalendarResults } from '../../src/persistence/calendar-evidence.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { directOperation, pendingProposal, acceptedReply, connectedCalendarMemory, connectionV2 } from './calendar-multi-fixtures.js';
import { at, calendarPage, entry, operationV1, sourceV1, sourceV2 } from '../contracts/calendar-multi-fixtures.js';
import { message } from './fixtures.js';
import { calendarReceiptV2Schema, operationRecordSchema } from '../../src/contracts/calendar-operations.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { calendarToolResultRecordV2Schema } from '../../src/contracts/calendar-sources.js';
import { resumableDecisionV2Schema } from '../../src/contracts/calendar-model.js';
import { sourceReferenceSchema } from '../../src/contracts/calendar-sources.js';
import { decisionKey, encodeCalendar, sourceKey } from '../../src/persistence/calendar-records.js';
import { key } from '../../src/persistence/records.js';

it('expires proposal content without erasing consumed intent or unknown-operation quarantine', async () => {
  const f = await connectedCalendarMemory(); let now = Date.parse('2026-10-22T10:01:00.000Z');
  const proposals = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => now);
  await proposals.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });
  await proposals.consume({ reply: acceptedReply(), operationId: 'proposal-op', intentId: 'intent' });
  const operations = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS);
  const op = { ...directOperation(), intentId: 'different-intent', operationId: 'op',
    originatingTurnId: 'direct-origin', originatingAcceptedMessageId: 'direct-message' };
  await operations.v2.reserveByIntent({ operation: op, consumption: null });
  const dispatched = { ...op, revision: 2, sequence: op.sequence + 1, state: 'dispatching' as const };
  await operations.v2.compareAndSwap({ expectedRevision: 1, next: dispatched });
  const unknown = { ...dispatched, revision: 3, sequence: dispatched.sequence + 1, state: 'unknown' as const };
  await operations.v2.compareAndSwap({ expectedRevision: 2, next: unknown });
  now = Date.parse('2026-10-22T10:10:00.000Z');
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => now);
  await retention.sweepMultiCalendarPage({ userId: 'u', now: new Date(now).toISOString(),
    cursor: null, limit: 20 });
  expect(await proposals.getCurrent('u', 's')).toBeNull();
  expect((await proposals.consume({ reply: acceptedReply(), operationId: 'new-op', intentId: 'intent' })).outcome)
    .toBe('existing');
  const saved = await operations.v2.getByIntent('u', 's', 'different-intent');
  expect(saved).toMatchObject({ state: 'unknown', operationId: 'op', calendarId: op.calendarId,
    googleEventId: op.googleEventId, action: null, calendarLabel: null });
  expect(saved?.requestHash).toBe(op.requestHash);
  expect(at).not.toBe(new Date(now).toISOString());
});

it('paginates 21+ records page by page with bounded cursor', async () => {
  const f = await connectedCalendarMemory();
  const now = Date.parse('2026-10-22T10:01:00.000Z');
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => now);

  // Insert 22 calendar-source records
  for (let i = 1; i <= 22; i++) {
    await retention.registerSource({
      userId: 'u',
      sessionId: 's',
      source: {
        ...sourceV2,
        sourceId: `source-${String(i).padStart(3, '0')}`,
        expiresAt: '2026-10-22T10:05:00.000Z',
      },
    });
  }

  let cursor: string | null = null;
  let pageCount = 0;
  const cursorsSeen = new Set<string>();

  do {
    const page = await retention.sweepMultiCalendarPage({
      userId: 'u',
      now: '2026-10-22T10:10:00.000Z',
      cursor,
      limit: 1,
    });
    pageCount++;
    if (page.nextCursor !== null) {
      expect(cursorsSeen.has(page.nextCursor)).toBe(false);
      cursorsSeen.add(page.nextCursor);
    }
    cursor = page.nextCursor;
  } while (cursor !== null && pageCount < 30);

  expect(pageCount).toBeGreaterThanOrEqual(22);
});

it('cleans up disconnected connections scoped by connectionId and revision', async () => {
  const f = await connectedCalendarMemory();
  const connStore = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const conn = connectionV2();

  // Mark connection disconnected
  await connStore.v2.compareAndSwap({
    userId: conn.userId,
    expectedRevision: conn.revision,
    expectedConnectionRevision: conn.connectionRevision,
    expectedDefaultSettingRevision: conn.defaultSetting.defaultSettingRevision,
    next: {
      ...conn,
      revision: conn.revision + 1,
      connectionRevision: conn.connectionRevision + 1,
      credentialVersion: conn.credentialVersion + 1,
      status: 'disconnected',
      enabled: false,
      credentials: null,
      discovery: null,
      updatedAt: '2026-10-22T10:02:00.000Z',
    },
  });

  const now = Date.parse('2026-10-22T10:10:00.000Z');
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => now);
  await retention.sweepMultiCalendarPage({
    userId: conn.userId,
    now: new Date(now).toISOString(),
    cursor: null,
    limit: 20,
  });

  const saved = await connStore.v2.get(conn.userId);
  expect(saved).not.toBeNull();
  expect(saved?.status).toBe('disconnected');
});

it('redacts sensitive fields on successful v2 receipts preserving success and identity', async () => {
  const f = await connectedCalendarMemory();
  const operations = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS);
  const op = {
    ...directOperation(),
    intentId: 'success-intent',
    operationId: 'success-op',
    originatingTurnId: 's-origin',
    originatingAcceptedMessageId: 's-message',
  };
  await operations.v2.reserveByIntent({ operation: op, consumption: null });
  const dispatched = { ...op, revision: 2, sequence: op.sequence + 1, state: 'dispatching' as const };
  await operations.v2.compareAndSwap({ expectedRevision: 1, next: dispatched });

  const receipt = calendarReceiptV2Schema.parse({
    schemaVersion: 2,
    operationId: op.operationId,
    googleEventId: op.googleEventId,
    connectionId: op.connectionId,
    connectionRevision: op.connectionRevision,
    targetRevision: op.targetRevision,
    calendarId: op.calendarId,
    calendarLabel: entry.label,
    labelExpiresAt: '2026-10-22T10:05:00.000Z',
    requestHash: op.requestHash,
    verifiedAt: at,
    source: {
      ...sourceV2,
      operationIds: [op.operationId],
      expiresAt: '2026-10-22T10:05:00.000Z',
    },
    htmlLink: 'https://calendar.google.com/event?eid=123',
  });

  const succeeded = {
    ...dispatched,
    revision: 3,
    sequence: dispatched.sequence + 1,
    state: 'succeeded' as const,
    receipt,
  };
  await operations.v2.compareAndSwap({ expectedRevision: 2, next: succeeded });

  const now = Date.parse('2026-10-22T10:10:00.000Z');
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => now);
  await retention.sweepMultiCalendarPage({
    userId: 'u',
    now: new Date(now).toISOString(),
    cursor: null,
    limit: 20,
  });

  const saved = await operations.v2.getByIntent('u', 's', 'success-intent');
  expect(saved).toMatchObject({
    state: 'succeeded',
    operationId: 'success-op',
    calendarId: op.calendarId,
    googleEventId: op.googleEventId,
    action: null,
    calendarLabel: null,
  });
  expect(saved?.receipt).toMatchObject({
    calendarLabel: null,
    labelExpiresAt: null,
    htmlLink: null,
  });
  expect(saved?.requestHash).toBe(op.requestHash);
});

it('does not redact user messages merely for mentioning a calendar', async () => {
  const f = await connectedCalendarMemory();
  const userMsg = message(0, 'u', 's');
  userMsg.content = 'Can you look up team calendar events for tomorrow?';
  const { doc } = encodeCalendar(messageRecordSchema, userMsg, 'm0', DEFAULT_BUDGETS.maxMessageBytes);
  f.rows('messages').set('m0', doc);

  const now = Date.parse('2026-10-22T10:10:00.000Z');
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => now);
  await retention.sweepMultiCalendarPage({
    userId: 'u',
    now: new Date(now).toISOString(),
    cursor: null,
    limit: 20,
  });

  const raw = await f.store.collection('messages').findOne({ _id: 'm0' });
  expect(raw?.content).toBe('Can you look up team calendar events for tomorrow?');
});

it('invalidates every retained copy for one account revision without erasing unrelated content or operation authority', async () => {
  const f = await connectedCalendarMemory();
  const account = { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' };
  const invalidationTime = '2026-10-22T10:02:00.000Z';
  const oldSource = { ...sourceV2, sourceId: 'old-source', toolCallIds: ['old-call'], operationIds: ['old-op'] };
  const unrelatedSource = { ...sourceV2, sourceId: 'new-source', connectionId: 'new-connection',
    connectionRevision: 2, toolCallIds: ['new-call'], operationIds: ['new-op'] };
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const decisions = new MongoCalendarDecisions(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const results = new MongoCalendarResults(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const messages = new MongoMessages(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const proposals = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const operations = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));

  await retention.registerSource({ userId: 'u', sessionId: 's', source: oldSource });
  const unrelatedSourceRecord = calendarSourceRecordSchema.parse({ schemaVersion: 1, kind: 'calendar-source',
    userId: 'u', sessionId: 's', sourceId: unrelatedSource.sourceId, source: unrelatedSource });
  const unrelatedSourceDoc = encodeCalendar(calendarSourceRecordSchema, unrelatedSourceRecord,
    sourceKey('u', 's', unrelatedSource.sourceId), DEFAULT_BUDGETS.maxDocumentBytes).doc;
  f.rows('metadata').set(String(unrelatedSourceDoc._id), unrelatedSourceDoc);
  await decisions.v2.put(resumableDecisionV2Schema.parse({
    schemaVersion: 2, kind: 'calendar-model-decision', userId: 'u', sessionId: 's', turnId: 't',
    attemptId: 'a', decisionId: 'decision-old', dispatchId: 'dispatch-old', configRevision: 1,
    connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v2',
    rejectedDecisionId: null,
    decision: { kind: 'text', decisionId: 'decision-old', content: 'Private calendar details', truncated: false },
    sources: [oldSource], operationId: null, intentId: null, proposalId: null, createdAt: at,
  }));
  await results.v2.put(calendarToolResultRecordV2Schema.parse({
    schemaVersion: 2, kind: 'calendar-tool-result', userId: 'u', sessionId: 's', turnId: 't',
    attemptId: 'a', decisionId: 'decision-old', eventId: 'event-old', sequence: 1,
    toolCallId: 'old-call', createdAt: at,
    resultRef: { storage: 'retained', source: oldSource, toolCallId: 'old-call', operationId: 'old-op',
      result: calendarPage },
  }));
  const oldMessageSource = sourceReferenceSchema.parse({ ...sourceV1, sourceId: 'old-source', expiresAt: '2026-10-22T10:05:00.000Z' });
  const unrelatedMessageSource = sourceReferenceSchema.parse({ ...sourceV1, sourceId: 'new-source',
    connectionId: 'new-connection', connectionRevision: 2, expiresAt: '2026-10-22T10:05:00.000Z' });
  await messages.append(messageRecordSchema.parse({ ...message(2, 'u', 's'), content: 'Private calendar details',
    sourceProvenance: [oldMessageSource] }));
  await messages.append(messageRecordSchema.parse({ ...message(3, 'u', 's'),
    messageId: key('output', 'u', 's', 'a'), turnId: 't', attemptId: 'a', content: 'Private calendar answer' }));
  await messages.append(messageRecordSchema.parse({ ...message(4, 'u', 's'), turnId: 'other-turn',
    attemptId: 'other-attempt', content: 'Unrelated current details',
    sourceProvenance: [unrelatedMessageSource] }));
  await proposals.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });

  const planned = { ...directOperation(), actionSources: [oldSource] };
  await operations.v2.reserveByIntent({ operation: planned, consumption: null });
  const dispatching = { ...planned, revision: 2, sequence: planned.sequence + 1, state: 'dispatching' as const,
    updatedAt: '2026-10-22T10:00:30.000Z' };
  await operations.v2.compareAndSwap({ expectedRevision: 1, next: dispatching });
  const unknown = { ...dispatching, revision: 3, sequence: dispatching.sequence + 1, state: 'unknown' as const,
    updatedAt: '2026-10-22T10:01:00.000Z' };
  await operations.v2.compareAndSwap({ expectedRevision: 2, next: unknown });
  const legacySource = { ...sourceV1, sourceId: 'legacy-source', operationIds: ['legacy-op'] };
  const legacyOperation = operationRecordSchema.parse({ ...operationV1, userId: 'u', sessionId: 'legacy-session',
    turnId: 'legacy-turn', operationId: 'legacy-op', actionSources: [legacySource] });
  await operations.reserve(legacyOperation);

  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await retention.invalidateAccountRevisionPage({ account, now: invalidationTime, cursor, limit: 2 });
    cursor = page.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(20);
  } while (cursor !== null);

  const sourceDoc = await f.store.raw('metadata', { _id: sourceKey('u', 's', 'old-source'), userId: 'u' });
  expect(sourceDoc?.source).toMatchObject({ redactedAt: invalidationTime, targets: [{ calendarId: entry.calendarId, calendarLabel: null }] });
  expect((await decisions.v2.get('u', 'decision-old'))).toMatchObject({ decision: null });
  expect(await results.v2.get('u', 's', 'old-call')).toMatchObject({ resultRef: { storage: 'tombstone', reason: 'disconnected' } });
  expect((await messages.get('u', 's', 'm2'))?.content).toBe('Private calendar details');
  expect((await messages.get('u', 's', key('output', 'u', 's', 'a')))?.content)
    .toBe('Private calendar answer');
  expect((await messages.get('u', 's', 'm4'))?.content).toBe('Unrelated current details');
  expect(await proposals.getAuthority('u', 's', 'p')).toMatchObject({ state: 'tombstone', tombstone: { reason: 'disconnected' } });
  expect(await operations.v2.getByIntent('u', 's', planned.intentId)).toMatchObject({
    state: 'unknown', action: null, operationId: planned.operationId, requestHash: planned.requestHash,
  });
  expect(await operations.getByTurn('u', 'legacy-session', 'legacy-turn')).toMatchObject({
    state: 'evidence-expired', action: null, operationId: 'legacy-op', requestHash: legacyOperation.requestHash,
  });
});

it('does not let a stale source writer reintroduce data after the final metadata page', async () => {
  const f = await connectedCalendarMemory();
  const connStore = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const conn = connectionV2();
  const account = { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' };
  const invalidationTime = '2026-10-22T10:02:00.000Z';
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));

  await retention.registerSource({ userId: 'u', sessionId: 's', source: {
    ...sourceV2, sourceId: 'already-stored',
  } });

  const paused = f.pauseNextUpdate();
  const staleWrite = retention.registerSource({ userId: 'u', sessionId: 's', source: {
    ...sourceV2, sourceId: 'racing-source',
  } });
  await paused.started;

  expect((await connStore.v2.compareAndSwap({
    userId: 'u', expectedRevision: conn.revision,
    expectedConnectionRevision: conn.connectionRevision,
    expectedDefaultSettingRevision: conn.defaultSetting.defaultSettingRevision,
    next: {
      ...conn, revision: conn.revision + 1, connectionRevision: conn.connectionRevision + 1,
      credentialVersion: conn.credentialVersion + 1, enabled: false, status: 'disconnected',
      credentials: null, tokenExpiresAt: null, discovery: null, updatedAt: invalidationTime,
    },
  })).outcome).toBe('confirmed');

  let cursor: string | null = null;
  do {
    cursor = (await retention.invalidateAccountRevisionPage({
      account, now: invalidationTime, cursor, limit: 1,
    })).nextCursor;
  } while (cursor !== null);

  paused.resume();
  await expect(staleWrite).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(await f.store.raw('metadata', {
    _id: sourceKey('u', 's', 'racing-source'), userId: 'u',
  })).toMatchObject({ source: { redactedAt: invalidationTime } });
});

it('redacts a stale model decision written after the account-revision scan', async () => {
  const f = await connectedCalendarMemory();
  const connStore = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const conn = connectionV2();
  const account = { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' };
  const invalidationTime = '2026-10-22T10:02:00.000Z';
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const decisions = new MongoCalendarDecisions(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const decision = resumableDecisionV2Schema.parse({
    schemaVersion: 2, kind: 'calendar-model-decision', userId: 'u', sessionId: 's', turnId: 't',
    attemptId: 'a', decisionId: 'racing-decision', dispatchId: 'dispatch-race', configRevision: 1,
    connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v2',
    rejectedDecisionId: null,
    decision: { kind: 'text', decisionId: 'racing-decision', content: 'Private account details', truncated: false },
    sources: [], operationId: null, intentId: null, proposalId: null, createdAt: at,
  });
  const paused = f.pauseNextUpdate();
  const staleWrite = decisions.v2.put(decision);
  await paused.started;

  expect((await connStore.v2.compareAndSwap({
    userId: 'u', expectedRevision: conn.revision,
    expectedConnectionRevision: conn.connectionRevision,
    expectedDefaultSettingRevision: conn.defaultSetting.defaultSettingRevision,
    next: {
      ...conn, revision: conn.revision + 1, connectionRevision: conn.connectionRevision + 1,
      credentialVersion: conn.credentialVersion + 1, enabled: false, status: 'disconnected',
      credentials: null, tokenExpiresAt: null, discovery: null, updatedAt: invalidationTime,
    },
  })).outcome).toBe('confirmed');

  let cursor: string | null = null;
  do {
    cursor = (await retention.invalidateAccountRevisionPage({
      account, now: invalidationTime, cursor, limit: 1,
    })).nextCursor;
  } while (cursor !== null);

  paused.resume();
  await expect(staleWrite).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(await f.store.raw('metadata', {
    _id: decisionKey('calendar-model-decision', 'u', 'racing-decision'), userId: 'u',
  })).toMatchObject({ decision: null });
});

it('does not expose pending proposal authority after its account revision is replaced', async () => {
  const f = await connectedCalendarMemory();
  const connStore = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const conn = connectionV2();
  const proposals = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => Date.parse('2026-10-22T10:01:00.000Z'));
  await proposals.putCurrent({ expectedProposalId: null, expectedRevision: null, proposal: pendingProposal() });

  expect((await connStore.v2.compareAndSwap({
    userId: 'u', expectedRevision: conn.revision,
    expectedConnectionRevision: conn.connectionRevision,
    expectedDefaultSettingRevision: conn.defaultSetting.defaultSettingRevision,
    next: {
      ...conn, revision: conn.revision + 1, connectionRevision: conn.connectionRevision + 1,
      credentialVersion: conn.credentialVersion + 1, enabled: false, status: 'disconnected',
      credentials: null, tokenExpiresAt: null, discovery: null, updatedAt: '2026-10-22T10:02:00.000Z',
    },
  })).outcome).toBe('confirmed');

  expect(await proposals.getCurrent('u', 's')).toBeNull();
  expect(await proposals.getAuthority('u', 's', 'p')).toEqual({ state: 'absent' });
});

it('tombstones a proposal inserted by an in-flight old-revision writer after the scan', async () => {
  const f = await connectedCalendarMemory();
  const connStore = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const conn = connectionV2();
  const account = { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' };
  const invalidationTime = '2026-10-22T10:02:00.000Z';
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const proposals = new MongoCalendarProposals(f.store, DEFAULT_BUDGETS, () => Date.parse('2026-10-22T10:01:00.000Z'));
  const paused = f.pauseNextUpdate();
  const staleWrite = proposals.putCurrent({
    expectedProposalId: null, expectedRevision: null, proposal: pendingProposal(),
  });
  await paused.started;

  expect((await connStore.v2.compareAndSwap({
    userId: 'u', expectedRevision: conn.revision,
    expectedConnectionRevision: conn.connectionRevision,
    expectedDefaultSettingRevision: conn.defaultSetting.defaultSettingRevision,
    next: {
      ...conn, revision: conn.revision + 1, connectionRevision: conn.connectionRevision + 1,
      credentialVersion: conn.credentialVersion + 1, enabled: false, status: 'disconnected',
      credentials: null, tokenExpiresAt: null, discovery: null, updatedAt: invalidationTime,
    },
  })).outcome).toBe('confirmed');

  let cursor: string | null = null;
  do {
    cursor = (await retention.invalidateAccountRevisionPage({
      account, now: invalidationTime, cursor, limit: 1,
    })).nextCursor;
  } while (cursor !== null);

  paused.resume();
  await expect(staleWrite).resolves.toMatchObject({ outcome: 'conflict' });
  expect(await proposals.getAuthority('u', 's', 'p')).toMatchObject({
    state: 'tombstone', tombstone: { reason: 'disconnected' },
  });
});

it('redacts a planned operation committed by an in-flight old-revision writer after the scan', async () => {
  const f = await connectedCalendarMemory();
  const connStore = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const conn = connectionV2();
  const account = { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' };
  const invalidationTime = '2026-10-22T10:02:00.000Z';
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const operations = new MongoCalendarOperations(f.store, DEFAULT_BUDGETS, () => Date.parse(invalidationTime));
  const operation = directOperation();
  const paused = f.pauseNextUpdate();
  const staleWrite = operations.v2.reserveByIntent({ operation, consumption: null });
  await paused.started;

  expect((await connStore.v2.compareAndSwap({
    userId: 'u', expectedRevision: conn.revision,
    expectedConnectionRevision: conn.connectionRevision,
    expectedDefaultSettingRevision: conn.defaultSetting.defaultSettingRevision,
    next: {
      ...conn, revision: conn.revision + 1, connectionRevision: conn.connectionRevision + 1,
      credentialVersion: conn.credentialVersion + 1, enabled: false, status: 'disconnected',
      credentials: null, tokenExpiresAt: null, discovery: null, updatedAt: invalidationTime,
    },
  })).outcome).toBe('confirmed');

  let cursor: string | null = null;
  do {
    cursor = (await retention.invalidateAccountRevisionPage({
      account, now: invalidationTime, cursor, limit: 1,
    })).nextCursor;
  } while (cursor !== null);

  paused.resume();
  await expect(staleWrite).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(await operations.v2.getByIntent('u', 's', operation.intentId)).toMatchObject({
    state: 'evidence-expired', action: null,
  });
});

it('queries only messages carrying the account revision being invalidated', async () => {
  const f = await connectedCalendarMemory();
  const account = { userId: 'u', connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub' };
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS);
  await new MongoMessages(f.store, DEFAULT_BUDGETS).append(messageRecordSchema.parse({
    ...message(2, 'u', 's'),
    sourceProvenance: [sourceReferenceSchema.parse({ ...sourceV1, expiresAt: '2026-10-22T10:05:00.000Z' })],
  }));

  let cursor: string | null = null;
  do {
    cursor = (await retention.invalidateAccountRevisionPage({
      account, now: '2026-10-22T10:02:00.000Z', cursor, limit: 20,
    })).nextCursor;
  } while (cursor !== null);

  const metadataQuery = f.calls.find(call => call.collection === 'metadata' && call.method === 'find')?.filter;
  expect(metadataQuery?.$or).toEqual([
    { kind: 'calendar-source', 'source.connectionId': account.connectionId,
      'source.connectionRevision': account.connectionRevision },
    { kind: 'calendar-model-decision', connectionId: account.connectionId,
      connectionRevision: account.connectionRevision },
    { kind: 'calendar-tool-result', 'resultRef.source.connectionId': account.connectionId,
      'resultRef.source.connectionRevision': account.connectionRevision },
    { kind: 'calendar-operation', connectionId: account.connectionId,
      connectionRevision: account.connectionRevision },
    { kind: 'calendar-proposal', connectionId: account.connectionId,
      connectionRevision: account.connectionRevision },
  ]);
  const query = f.calls.find(call => call.collection === 'messages' && call.method === 'find')?.filter;
  expect(query?.sourceProvenance).toEqual({ $elemMatch: {
    connectionId: account.connectionId, connectionRevision: account.connectionRevision,
  } });
});

it('source expiry clears labels and keeps the assistant archive copy linked by calendar attempt scope', async () => {
  const f = await connectedCalendarMemory();
  let now = Date.parse('2026-10-22T10:04:00.000Z');
  const source = { ...sourceV2, sourceId: 'expiry-source', toolCallIds: ['expiry-call'], operationIds: ['expiry-op'] };
  const results = new MongoCalendarResults(f.store, DEFAULT_BUDGETS, () => now);
  const messages = new MongoMessages(f.store, DEFAULT_BUDGETS, () => now);
  const retention = new MongoCalendarRetention(f.store, DEFAULT_BUDGETS, () => now);
  await retention.registerSource({ userId: 'u', sessionId: 's', source });
  await results.v2.put(calendarToolResultRecordV2Schema.parse({
    schemaVersion: 2, kind: 'calendar-tool-result', userId: 'u', sessionId: 's', turnId: 'expiry-turn',
    attemptId: 'expiry-attempt', decisionId: 'expiry-decision', eventId: 'expiry-event', sequence: 1,
    toolCallId: 'expiry-call', createdAt: at,
    resultRef: { storage: 'retained', source, toolCallId: 'expiry-call', operationId: 'expiry-op', result: calendarPage },
  }));
  const assistantMessageId = key('output', 'u', 's', 'expiry-attempt');
  await messages.append(messageRecordSchema.parse({ ...message(5, 'u', 's'),
    messageId: assistantMessageId, turnId: 'expiry-turn', attemptId: 'expiry-attempt',
    content: 'Private expired calendar details' }));

  now = Date.parse('2026-10-22T10:06:00.000Z');
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await retention.sweepMultiCalendarPage({ userId: 'u', now: new Date(now).toISOString(), cursor, limit: 20 });
    cursor = page.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(10);
  } while (cursor !== null);

  const sourceDoc = await f.store.raw('metadata', { _id: sourceKey('u', 's', 'expiry-source'), userId: 'u' });
  expect(sourceDoc?.source).toMatchObject({ redactedAt: new Date(now).toISOString(),
    targets: [{ calendarId: entry.calendarId, calendarLabel: null }] });
  expect(await results.v2.get('u', 's', 'expiry-call')).toMatchObject({
    resultRef: { storage: 'tombstone', reason: 'expired' },
  });
  expect((await messages.get('u', 's', assistantMessageId))?.content)
    .toBe('Private expired calendar details');
});
