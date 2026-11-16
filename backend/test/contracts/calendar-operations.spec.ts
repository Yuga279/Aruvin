import { describe, expect, it } from 'vitest';
import { operationRecordSchema, operationEventSchema, type CalendarOperationStore,
  type CalendarExecutionPort } from '../../src/contracts/calendar-operations.js';
const at = '2026-10-20T10:00:00.000Z';
const intent = { schemaVersion: 1, kind: 'calendar-operation', userId: 'u', sessionId: 's',
  turnId: 't', operationId: 'o', originatingAttemptId: 'a', revision: 1, sequence: 0,
  connectionId: 'c', connectionRevision: 1, googleSubjectId: 'sub', calendarId: 'owned', targetRevision: 1,
  requestHash: 'a'.repeat(64), googleEventId: 'abcde01234', schemaRevision: 'google-calendar.v1',
  action: { summary: 'Visit', start: '2026-10-21T10:00:00Z', end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' },
  authorization: { acceptedUserMessageId: 'm', canonicalActionHash: 'a'.repeat(64),
    approvedAt: at, basis: 'explicit-request' }, deliveryRetries: 0,
  createdAt: at, updatedAt: at, auditExpiresAt: '2026-11-19T10:00:00.000Z',
  state: 'planned', receipt: null, failure: null };
describe('Calendar operation authority', () => {
  it('requires stable write authority and does not confuse success with narration', () => {
    expect(operationRecordSchema.safeParse(intent).success).toBe(true);
    expect(operationRecordSchema.safeParse({ ...intent, state: 'succeeded' }).success).toBe(false);
    expect(operationRecordSchema.safeParse({ ...intent, googleEventId: 'bad-ID' }).success).toBe(false);
    expect(operationRecordSchema.safeParse({ ...intent, deliveryRetries: 3 }).success).toBe(false);
    expect(operationRecordSchema.safeParse({ ...intent, requestHash: 'b'.repeat(64) }).success).toBe(false);
    expect(operationEventSchema.safeParse({ schemaVersion: 1, kind: 'calendar-operation-event',
      userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', operationId: 'o', eventId: 'e',
      sequence: 1, state: 'unknown', createdAt: at, failure: { category: 'uncertain',
        code: 'WRITE_OUTCOME_UNKNOWN', retry: 'readback' } }).success).toBe(true);
  });
  it('exposes no unsafe create-again fallback to storage or MCP consumers', async () => {
    const store: CalendarOperationStore = { getByTurn: async () => null,
      reserve: async record => ({ outcome: 'existing', record }),
      compareAndSwap: async () => ({ outcome: 'uncertain' }),
      appendEvent: async () => undefined, listEvents: async () => ({ items: [], nextCursor: null }) };
    const execute: CalendarExecutionPort = { invoke: async () => ({ outcome: 'failure',
      failure: { category: 'credential', code: 'RECONNECT_REQUIRED', retry: 'none' } }),
      readback: async () => ({ outcome: 'unknown' }), close: async () => undefined };
    expect(await store.getByTurn('u', 's', 't')).toBeNull();
    expect(execute.readback).toBeTypeOf('function');
  });
});
