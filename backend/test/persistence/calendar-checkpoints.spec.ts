/**
 * ============================================================================
 * FILE: calendar-checkpoints.spec.ts
 * LOCATION: backend/test/persistence/calendar-checkpoints.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for calendar checkpoint safety validation and reference schema parsing.
 *
 * ROLE IN PROJECT:
 *    Ensures LangGraph checkpoint channels do not leak calendar tokens or content,
 *    and supports both v1 and v2 checkpoint references.
 *
 * KEY COMPONENTS:
 *    - assertCalendarCheckpointSafe tests (v1 rejection and acceptance, v2 acceptance).
 * ============================================================================
 */

import { assertCalendarCheckpointSafe, calendarCheckpointRefsSchema } from '../../src/persistence/calendar-checkpoints.js';

const scope = { userId: 'u1', sessionId: 's1' };
const refs = () => calendarCheckpointRefsSchema.parse({
  version: 1, userId: 'u1', sessionId: 's1', turnId: 't1',
  decisionIds: ['dec1'], toolCallIds: ['tc1'], operationId: 'op1',
});

it('Calendar checkpoint channel rejects content and retains bounded references only', () => {
  expect(() => assertCalendarCheckpointSafe({
    channel_values: { calendarRefs: refs() },
  }, scope)).not.toThrow();
  expect(() => assertCalendarCheckpointSafe({
    channel_values: { calendarRefs: { ...refs(), content: 'Fetched event details' } },
  }, scope)).toThrow();
  expect(() => assertCalendarCheckpointSafe({
    channel_values: { calendarRefs: { ...refs(), userId: 'u2' } },
  }, scope)).toThrow();
  expect(() => assertCalendarCheckpointSafe({
    channel_values: { calendarRefs: { ...refs(), decisionIds: Array.from({ length: 9 }, (_, i) => `d${i}`) } },
  }, scope)).toThrow();
  expect(() => assertCalendarCheckpointSafe({
    channel_values: { credentials: { refresh: 'secret' } },
  }, scope)).toThrow();
  expect(() => assertCalendarCheckpointSafe({
    channel_values: { assistant: { tool_calls: [{ id: 'tc1' }] } },
  }, scope)).toThrow();
  expect(() => assertCalendarCheckpointSafe({
    channel_values: { messages: [{ role: 'user', content: 'Hello' }] },
  }, scope)).not.toThrow();
  expect(() => assertCalendarCheckpointSafe({
    channel_values: { calendarRefs: null },
  }, scope)).not.toThrow();
  expect(() => assertCalendarCheckpointSafe({
    channel_values: { __start__: { calendarRefs: null } },
  }, scope)).not.toThrow();
  expect(() => assertCalendarCheckpointSafe([
    ['calendarRefs', null],
  ], scope)).not.toThrow();
  expect(() => assertCalendarCheckpointSafe([
    ['calendarRefs', { ...refs(), result: 'body' }],
  ], scope)).toThrow();
});

it('accepts scoped v2 references without admitting content or upgrading v1 refs', () => {
  const v2 = { version: 2, userId: 'u1', sessionId: 's1', turnId: 't1', decisionIds: ['d'],
    toolCallIds: ['call'], operationId: 'op', intentId: 'intent', proposalId: 'p',
    connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v2' };
  expect(() => assertCalendarCheckpointSafe({ channel_values: { calendarRefs: v2 } }, scope)).not.toThrow();
  expect(() => assertCalendarCheckpointSafe([['calendarRefs', { ...v2, action: {} }]], scope)).toThrow();
  expect(() => assertCalendarCheckpointSafe({ calendarRefs: { ...v2, sessionId: 'other' } }, scope)).toThrow();
  expect(calendarCheckpointRefsSchema.parse(refs()).version).toBe(1);
});

it('admits stock LangGraph version maps for the calendarRefs channel', () => {
  const v2 = { version: 2, userId: 'u1', sessionId: 's1', turnId: 't1', decisionIds: ['d'],
    toolCallIds: ['call'], operationId: 'op', intentId: 'intent', proposalId: 'p',
    connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v2' };
  expect(() => assertCalendarCheckpointSafe({
    v: 4, id: 'checkpoint', ts: '2026-10-26T12:44:43.000Z',
    channel_values: { calendarRefs: v2, calendarCursor: null },
    channel_versions: { calendarRefs: 1, calendarCursor: 1 },
    versions_seen: { prepare: { calendarRefs: 1 }, calendar_decide: { calendarRefs: 1 } },
  }, scope)).not.toThrow();
});
