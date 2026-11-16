/**
 * ============================================================================
 * FILE: skill-evidence.spec.ts
 * LOCATION: backend/test/persistence/skill-evidence.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify stable skill decisions and local results persist through existing
 *    metadata adapters without new collections or authorization lookups.
 *
 * ROLE IN PROJECT:
 *    Guards the P2 persistence boundary: v3 local discovery evidence is
 *    source-free, idempotent, scoped, and checkpoint-safe.
 *
 * KEY COMPONENTS:
 *    - Local result store round-trip and isolation.
 *    - Stable discovery decision round-trip.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { skillError } from '../../src/contracts/calendar-tools.js';
import { localSkillResultRecordSchema } from '../../src/contracts/calendar-sources.js';
import { resumableSkillDecisionSchema } from '../../src/contracts/calendar-model.js';
import { MongoCalendarDecisions, MongoCalendarResults } from '../../src/persistence/calendar-evidence.js';
import { assertCalendarCheckpointSafe } from '../../src/persistence/calendar-checkpoints.js';
import { calendarMemory } from './calendar-multi-memory.js';

it('stores exact source-free local results once under existing metadata identity', async () => {
  const mem = calendarMemory();
  const results = new MongoCalendarResults(mem.store, DEFAULT_BUDGETS);
  const content = JSON.stringify(skillError('SCHEMA_NOT_LOADED', 'google-calendar', 'calendar_get_event'));
  const record = localSkillResultRecordSchema.parse({ schemaVersion: 3,
    protocolVersion: 'plugin-skills.v1', kind: 'calendar-tool-result',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd',
    eventId: 'e', sequence: 0, toolCallId: 'call', createdAt: '2026-11-04T10:00:00.000Z',
    resultRef: { storage: 'local', toolCallId: 'call', content } });
  await results.skills.put(record);
  await results.skills.put(record);
  expect(await results.skills.get('u', 's', 'call')).toEqual(record);
  expect(await results.skills.get('other', 's', 'call')).toBeNull();
  expect(await results.skills.get('u', 'other', 'call')).toBeNull();
  const changed = { ...record, resultRef: { ...record.resultRef,
    content: JSON.stringify(skillError('SCHEMA_STALE', 'google-calendar', 'calendar_get_event')) } };
  await expect(results.skills.put(changed)).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
  expect(mem.calls.filter(c => c.collection === 'integration_connections')).toHaveLength(0);
});

it('round-trips stable discovery decisions without a second authorization lookup', async () => {
  const mem = calendarMemory();
  const decisions = new MongoCalendarDecisions(mem.store, DEFAULT_BUDGETS);
  const raw = '{ "plugin":"google-calendar", "tools":["calendar_get_event"] }';
  const record = resumableSkillDecisionSchema.parse({ schemaVersion: 3,
    protocolVersion: 'plugin-skills.v1', kind: 'calendar-model-decision',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch',
    configRevision: 1, connectionId: 'connection', connectionRevision: 1, schemaRevision: 'google-calendar.v2',
    rejectedDecisionId: null, sources: [], operationId: null, intentId: null, proposalId: null,
    createdAt: '2026-11-04T10:00:00.000Z', decision: { kind: 'activate_skill', decisionId: 'd',
      assistantContent: 'Loading.', nativeCall: { id: 'call', type: 'function', function: { name: 'activate_skill', arguments: raw } },
      envelope: JSON.parse(raw), terminal: 'tool_calls' } });
  await decisions.skills.put(record);
  await decisions.skills.put(record);
  expect(await decisions.skills.get('u', 'd')).toEqual(record);
  expect(await decisions.skills.get('other', 'd')).toBeNull();
  expect(mem.calls.filter(c => c.collection === 'integration_connections')).toHaveLength(0);
});

it('admits eight scoped protocol refs but no ninth call or embedded schema', () => {
  const refs = { version: 3, protocolVersion: 'plugin-skills.v1', userId: 'u', sessionId: 's', turnId: 't',
    decisionIds: Array.from({ length: 8 }, (_, i) => `d-${i}`),
    toolCallIds: Array.from({ length: 8 }, (_, i) => `c-${i}`), operationId: null,
    intentId: null, proposalId: null, connectionId: 'conn', connectionRevision: 1, schemaRevision: 'google-calendar.v2' };
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: refs }, { userId: 'u', sessionId: 's' })).not.toThrow();
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: { ...refs, toolCallIds: [...refs.toolCallIds, 'ninth'] } },
    { userId: 'u', sessionId: 's' })).toThrow();
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: { ...refs, schemas: [{}] } },
    { userId: 'u', sessionId: 's' })).toThrow();
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: refs }, { userId: 'u', sessionId: 'other' })).toThrow();
});
