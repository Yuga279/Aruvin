/**
 * ============================================================================
 * FILE: calendar-view.spec.ts
 * LOCATION: backend/test/contracts/calendar-view.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validate bounded calendar snapshot and hydration contracts.
 *
 * ROLE IN PROJECT:
 *    Guards strict view schemas, legacy wire compatibility, and the UTF-8 cap
 *    without services, credentials, or a second execution path.
 *
 * KEY COMPONENTS:
 *    - Completion/message round trip: Assistant archive and stream agreement.
 *    - Strict entry rules: Date-only all-day, safe links, entry and byte caps.
 *    - Protocol compatibility: v3-only presentation and old frame parsing.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarViewSchema } from '../../src/contracts/calendar-view.js';
import { calendarMultiStreamEnvelopeSchema, calendarStreamEnvelopeSchema }
  from '../../src/contracts/calendar-wire.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { visibleMessageSchema } from '../../src/contracts/api.js';
import { completedEventSchema } from '../../src/contracts/stream.js';
import { message } from '../persistence/fixtures.js';
import { agendaFixture } from './calendar-view.fixture.js';

it('round-trips a calendar snapshot on assistant records and the existing completion', () => {
  const calendarView = agendaFixture();
  const record = messageRecordSchema.parse({ ...message(2), role: 'assistant', calendarView });
  expect(record.calendarView).toEqual(calendarView);
  const { messageId, turnId, eventId, sequence, role, content, createdAt, completionStatus, truncated } = record;
  expect(visibleMessageSchema.parse({ messageId, turnId, eventId, sequence, role, content,
    createdAt, completionStatus, truncated, calendarView }).calendarView).toEqual(calendarView);
  expect(completedEventSchema.parse({ type: 'completed', assistantMessageId: messageId,
    outcome: 'completed', calendarView }).calendarView).toEqual(calendarView);
  expect(messageRecordSchema.safeParse({ ...record, role: 'user' }).success).toBe(false);
  expect(messageRecordSchema.safeParse({ ...message(2), role: 'assistant' }).success).toBe(true);
});

it('keeps date-only exclusive ends, strict fields, and the UTF-8 view cap', () => {
  const entry = { eventId: 'event-1', summary: 'Holiday', start: '2026-11-11', end: '2026-11-13',
    allDay: true, timeZone: null, status: 'confirmed', htmlLink: null };
  const agenda = agendaFixture({ entries: [entry] });
  expect(calendarViewSchema.parse(agenda)).toEqual(agenda);
  expect(calendarViewSchema.safeParse({ ...agenda, entries: [{ ...entry, end: '2026-11-11' }] }).success).toBe(false);
  expect(calendarViewSchema.safeParse({ ...agenda, entries: [{ ...entry, start: '2026-02-30' }] }).success).toBe(false);
  expect(calendarViewSchema.safeParse({ ...agenda, entries: [{ ...entry, htmlLink: 'javascript:alert(1)' }] }).success).toBe(false);
  expect(calendarViewSchema.safeParse({ ...agenda, entries: Array(21).fill(entry) }).success).toBe(false);
  expect(calendarViewSchema.safeParse({ ...agenda, secret: 'never' }).success).toBe(false);
  expect(calendarViewSchema.safeParse({ ...agenda, entries: Array.from({ length: 20 }, (_, n) =>
    ({ ...entry, eventId: String(n), description: '界'.repeat(2000) })) }).success).toBe(false);
});

it('adds calendar-view only to protocol 3 and leaves old frames parseable', () => {
  const frame = { protocolVersion: 3, sessionId: 's', turnId: 't', attemptId: 'a', sequence: 0,
    event: { type: 'calendar-view', view: agendaFixture() } };
  expect(calendarMultiStreamEnvelopeSchema.safeParse(frame).success).toBe(true);
  expect(calendarStreamEnvelopeSchema.safeParse({ ...frame, protocolVersion: 2 }).success).toBe(false);
  expect(calendarStreamEnvelopeSchema.safeParse({ ...frame, protocolVersion: 2,
    event: { type: 'calendar-progress', phase: 'executing' } }).success).toBe(true);
});
