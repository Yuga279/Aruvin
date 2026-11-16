/**
 * ============================================================================
 * FILE: calendar-multi-evidence.spec.ts
 * LOCATION: backend/test/persistence/calendar-multi-evidence.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify version-compatible persistence codecs and scoped multi-calendar keys.
 *
 * ROLE IN PROJECT:
 *    Exercises deterministic Calendar storage representations against parsed
 *    contract fixtures without a database or provider dependency.
 *
 * KEY COMPONENTS:
 *    - Versioned operation and connection codec round trips.
 *    - Session- and intent-scoped deterministic identity keys.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { compatibleCalendarOperationSchema, compatibleCalendarConnectionSchema }
  from '../../src/contracts/calendar-compatibility.js';
import { decodeCalendar, encodeCalendar, proposalKey, intentOperationKey }
  from '../../src/persistence/calendar-records.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { operationV1, operationV2, sourceV2, event, entry, at, until } from '../contracts/calendar-multi-fixtures.js';
import { connectionV2 } from './calendar-multi-fixtures.js';
import { MongoCalendarConnections } from '../../src/persistence/calendar-connections.js';
import { MongoCalendarDecisions, MongoCalendarResults } from '../../src/persistence/calendar-evidence.js';
import { calendarToolResultRecordV2Schema } from '../../src/contracts/calendar-sources.js';
import { resumableDecisionV2Schema } from '../../src/contracts/calendar-model.js';
import { calendarMemory } from './calendar-multi-memory.js';

it('round trips both versions without promoting legacy authority', () => {
  for (const value of [operationV1, operationV2]) {
    const encoded = encodeCalendar(compatibleCalendarOperationSchema, value, 'fixture',
      DEFAULT_BUDGETS.maxDocumentBytes);
    expect(decodeCalendar(compatibleCalendarOperationSchema, encoded.doc)).toEqual(encoded.record);
    expect(encoded.record.schemaRevision).toBe(value.schemaRevision);
  }
  const c = connectionV2();
  expect(decodeCalendar(compatibleCalendarConnectionSchema,
    encodeCalendar(compatibleCalendarConnectionSchema, c, 'c', 262144).doc)).toEqual(c);
  expect(proposalKey('u', 's', 'p')).not.toBe(proposalKey('u', 'other', 'p'));
  expect(intentOperationKey('u', 's', 'intent')).not.toBe(intentOperationKey('u', 's', 'other'));
});

it('preserves versioned provenance and tombstones expired v2 result content', async () => {
  const f = calendarMemory(); let now = Date.parse(at);
  const connections = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  expect((await connections.v2.create(connectionV2())).outcome).toBe('confirmed');
  const results = new MongoCalendarResults(f.store, DEFAULT_BUDGETS, () => now);
  const decisions = new MongoCalendarDecisions(f.store, DEFAULT_BUDGETS, () => now);
  const r = calendarToolResultRecordV2Schema.parse({ schemaVersion: 2, kind: 'calendar-tool-result',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', eventId: 'e',
    sequence: 1, toolCallId: 'call', createdAt: at, resultRef: { storage: 'retained', source: sourceV2,
      toolCallId: 'call', operationId: 'op', result: { schemaVersion: 2, tool: 'calendar_get_event', event,
        target: { calendarId: entry.calendarId, calendarLabel: entry.label,
          discoveryRevision: 1, privateAccess: true } } } });
  await results.v2.put(r);
  expect(await results.v2.get('u', 's', 'call')).toEqual(r);
  const d = resumableDecisionV2Schema.parse({ schemaVersion: 2, kind: 'calendar-model-decision',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch',
    configRevision: 1, connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v2',
    rejectedDecisionId: null, decision: null, sources: [sourceV2], operationId: 'op',
    intentId: 'intent', proposalId: 'p', createdAt: at });
  await decisions.v2.put(d);
  now = Date.parse(until);
  const expired = await results.v2.get('u', 's', 'call');
  expect(expired?.resultRef.storage).toBe('tombstone');
  expect(JSON.stringify(expired)).not.toContain('Team');
  expect(JSON.stringify(expired)).not.toContain('Visit');
  expect((await decisions.v2.get('u', 'd'))?.decision).toBeNull();
});
