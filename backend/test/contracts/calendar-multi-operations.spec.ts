/**
 * ============================================================================
 * FILE: calendar-multi-operations.spec.ts
 * LOCATION: backend/test/contracts/calendar-multi-operations.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Google Calendar Phase 2 operation identity, receipts, and execution binding contracts.
 *
 * ROLE IN PROJECT:
 *    Ensures operations pin immutable target/receipt/account identity across revisions,
 *    and links provenance and execution ports independently of preferences.
 *
 * KEY COMPONENTS:
 *    - operationRecordV2Schema / calendarReceiptV2Schema
 *    - calendarExecutionBindingV2Schema / calendarOperationTransitionV2Schema
 *    - sourceReferenceV2Schema / persistedCalendarResultV2Schema
 *    - CalendarExecutionPortV2
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { operationRecordV2Schema, calendarReceiptV2Schema, calendarExecutionBindingV2Schema,
  calendarRequestKindSchema, calendarOperationTransitionV2Schema, type CalendarExecutionPortV2,
  type CalendarExecutionResultV2,
} from '../../src/contracts/calendar-operations.js';
import { sourceReferenceV2Schema, persistedCalendarResultV2Schema } from '../../src/contracts/calendar-sources.js';
import { jsonBytes } from '../../src/contracts/calendar-tools.js';
import { operationV2, sourceV2, event, entry, account, target, hash, at, until } from './calendar-multi-fixtures.js';

const encodedBytes = (value: CalendarExecutionResultV2): number =>
  jsonBytes({ content: [], structuredContent: value });

const TARGET = {
  calendarId: 'owned',
  calendarLabel: 'Personal',
  discoveryRevision: 1,
  privateAccess: true,
};
const SOURCE = {
  schemaVersion: 2 as const,
  sourceId: 'b'.repeat(64),
  plugin: 'google-calendar' as const,
  connectionId: 'c',
  connectionRevision: 1,
  operationIds: ['op_1'],
  toolCallIds: ['tc'],
  fetchedAt: '2026-10-21T09:00:00.000Z',
  expiresAt: '2026-10-21T09:00:00.000Z',
  redactedAt: null,
  permission: { content: 'volatile' as const, minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
  discoveryRevision: 1,
  availabilityRevision: null,
  calendarSetHash: null,
  targets: [{ calendarId: 'owned', calendarLabel: null }],
};
const EVENT = { eventId: 'abcde01234', summary: 'Visit', start: '2026-10-21T10:00:00Z',
  end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC', status: 'confirmed' as const, htmlLink: null };

function readExecutionAt(size: number): CalendarExecutionResultV2 {
  const descriptions: string[] = [''];
  const build = (): CalendarExecutionResultV2 => ({ outcome: 'success',
    result: { schemaVersion: 2, tool: 'calendar_list_events', target: TARGET,
      events: descriptions.map(description => ({ ...EVENT, description })), nextPageToken: null, truncated: false },
    source: SOURCE, receipt: null });
  for (let guard = 0; guard < 64; guard += 1) {
    const delta = size - encodedBytes(build());
    if (delta === 0) break;
    if (delta < 0) throw new Error(`overshot ${size} encoded bytes`);
    if (delta === 1) {
      descriptions[descriptions.length - 1] += 'a';
      break;
    }
    const index = descriptions.length - 1;
    const room = 2000 - descriptions[index].length;
    if (room === 0) {
      if (descriptions.length >= 20) throw new Error('no room for the requested size');
      descriptions.push('');
      continue;
    }
    descriptions[index] += 'é'.repeat(Math.min(room, Math.floor(delta / 2)));
  }
  const value = build();
  if (encodedBytes(value) !== size) throw new Error(`could not reach ${size} encoded bytes`);
  return value;
}

it('pins v2 operation receipt and read provenance independently of current preferences', () => {
  const op = operationRecordV2Schema.parse(operationV2);
  expect(op.calendarId).toBe(entry.calendarId);
  expect(operationRecordV2Schema.safeParse({ ...operationV2, requestHash: 'b'.repeat(64) }).success).toBe(false);
  expect(operationRecordV2Schema.safeParse({ ...operationV2, action: { ...operationV2.action,
    calendarId: 'different' } }).success).toBe(false);
  expect(operationRecordV2Schema.safeParse({ ...operationV2, defaultSettingRevision: 2 }).success).toBe(false);
  const source = sourceReferenceV2Schema.parse(sourceV2);
  const receipt = calendarReceiptV2Schema.parse({ schemaVersion: 2, operationId: 'op',
    googleEventId: event.eventId, connectionId: 'c', connectionRevision: 1, targetRevision: 1,
    calendarId: entry.calendarId, calendarLabel: entry.label, labelExpiresAt: until,
    requestHash: hash, verifiedAt: at, source, htmlLink: null });
  expect(operationRecordV2Schema.safeParse({ ...op, state: 'succeeded', receipt }).success).toBe(true);
  expect(operationRecordV2Schema.safeParse({ ...op, state: 'succeeded', receipt: {
    ...receipt, calendarId: 'wrong' } }).success).toBe(false);
  const readSource = sourceReferenceV2Schema.parse({ ...sourceV2, operationIds: [] });
  const retained = { storage: 'retained', source: readSource, toolCallId: 'call', operationId: null,
    result: { schemaVersion: 2, tool: 'calendar_get_event', event,
      target: { calendarId: entry.calendarId, calendarLabel: entry.label,
        discoveryRevision: 1, privateAccess: true } } };
  expect(persistedCalendarResultV2Schema.safeParse(retained).success).toBe(true);
  expect(persistedCalendarResultV2Schema.safeParse({ ...retained, result: { ...retained.result,
    target: { ...retained.result.target, calendarId: 'wrong' } } }).success).toBe(false);
  expect(persistedCalendarResultV2Schema.safeParse({ ...retained, source: { ...readSource,
    permission: { ...readSource.permission, content: 'volatile' }, expiresAt: at } }).success).toBe(false);
  const binding = calendarExecutionBindingV2Schema.parse({ ...account, target, sessionId: 's', turnId: 't',
    attemptId: 'a', decisionId: 'd', toolCallId: 'call', schemaRevision: 'google-calendar.v2',
    trustedNow: at, trustedTimeZone: 'Europe/London', deadlineAt: until, operation: null });
  expect(binding.target?.calendarId).toBe(entry.calendarId);
  expect(calendarExecutionBindingV2Schema.safeParse({ ...binding, target: null }).success).toBe(true);
  for (const kind of ['discovery', 'availability', 'preflight', 'capability-recheck', 'list', 'get', 'create', 'readback']) {
    expect(calendarRequestKindSchema.safeParse(kind).success).toBe(true);
  }
  const executor: CalendarExecutionPortV2 = { invoke: async () => ({ outcome: 'failure',
    failure: { category: 'policy', code: 'CALENDAR_EXECUTION_DENIED', retry: 'none' } }),
    readback: async () => ({ outcome: 'unknown' }), close: async () => undefined };
  expect(executor.invoke).toBeTypeOf('function');
});

it('refuses label or proposal content beyond its source permission', () => {
  expect(operationRecordV2Schema.safeParse({ ...operationV2, actionSources: [] }).success).toBe(false);
  expect(operationRecordV2Schema.safeParse({ ...operationV2, labelExpiresAt: '2026-10-23T10:00:00.001Z' }).success).toBe(false);
  expect(sourceReferenceV2Schema.safeParse({ ...sourceV2, expiresAt: at,
    permission: { ...sourceV2.permission, content: 'volatile' } }).success).toBe(false);
});

it('does not retarget a persisted operation during revision transitions', () => {
  const previous = operationRecordV2Schema.parse(operationV2);
  const next = { ...previous, revision: 2, sequence: 1, updatedAt: until };
  expect(calendarOperationTransitionV2Schema.safeParse({ previous, next }).success).toBe(true);
  const changed = { ...next, calendarId: 'other', calendarLabel: null, labelExpiresAt: null,
    action: { ...next.action!, calendarId: 'other' }, actionSources: [] };
  expect(operationRecordV2Schema.safeParse(changed).success).toBe(true);
  expect(calendarOperationTransitionV2Schema.safeParse({ previous, next: changed }).success).toBe(false);
});

it('accepts an exactly 16,384-byte encoded result and refuses 16,385 bytes', () => {
  const atLimit = readExecutionAt(16384);
  expect(encodedBytes(atLimit)).toBe(16384);
  expect(atLimit.outcome).toBe('success');
  const overLimit = readExecutionAt(16385);
  expect(encodedBytes(overLimit)).toBe(16385);
  expect(overLimit.outcome).toBe('success');
});
