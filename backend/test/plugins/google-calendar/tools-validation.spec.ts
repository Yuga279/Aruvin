import { describe, expect, it } from 'vitest';
import type { CalendarExecutionBinding } from '../../../src/contracts/calendar-operations.js';
import { CALENDAR_LIMITS, CALENDAR_TOOL_REVISION } from '../../../src/contracts/calendar-policy.js';
import { CALENDAR_TOOLS, forbiddenCalendarKeys } from '../../../src/contracts/calendar-tools.js';
import { calendarActionHash, calendarEventId, compareCalendarTimes, formatCalendarUtc,
  parseCalendarTimestamp, requireCreateAuthority, toolFault, validateCalendarCall }
  from '../../../src/plugins/google-calendar/tools-validation.js';
import { multiTarget, multiOperation, multiBinding } from './tools-multi-fixtures.js';

const ACTION = { summary: 'Visit', start: '2026-10-21T10:00:00Z',
  end: '2026-10-21T11:00:00Z', timeZone: 'Etc/UTC' };

const createCall = { name: 'calendar_create_event', arguments: { ...ACTION } };

function dispatchingOperation(overrides: Record<string, unknown> = {}) {
  const hash = calendarActionHash({ ...ACTION });
  return {
    schemaVersion: 1 as const, kind: 'calendar-operation' as const,
    userId: 'u1', sessionId: 's1', turnId: 't1', operationId: 'op1',
    originatingAttemptId: 'a0', revision: 1, sequence: 1,
    connectionId: 'c1', connectionRevision: 1, googleSubjectId: 'sub', calendarId: 'owned',
    targetRevision: 1, requestHash: hash, googleEventId: calendarEventId('op1'),
    schemaRevision: 'google-calendar.v1' as const, action: { ...ACTION },
    actionSources: [],
    authorization: { acceptedUserMessageId: 'm1', canonicalActionHash: hash,
      approvedAt: '2026-10-20T10:00:00.000Z', basis: 'explicit-request' as const },
    deliveryRetries: 0, createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z', auditExpiresAt: '2026-10-27T10:00:00.000Z',
    state: 'dispatching' as const, receipt: null, failure: null, ...overrides };
}

function binding(overrides: Partial<CalendarExecutionBinding> = {}): CalendarExecutionBinding {
  return { userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1', decisionId: 'd1',
    toolCallId: 'tc1', schemaRevision: 'google-calendar.v1', operation: null,
    trustedNow: '2026-10-20T10:05:00.000Z', trustedTimeZone: 'Etc/UTC',
    deadlineAt: '2026-10-20T10:05:20.000Z', connectionId: 'c1', connectionRevision: 1,
    googleSubjectId: 'sub', calendarId: 'owned', targetRevision: 1, ...overrides };
}

const listCall = (arguments_: Record<string, unknown>) =>
  ({ name: 'calendar_list_events', arguments: arguments_ });

describe('fixed Calendar catalogue', () => {
  it('validates explicit offsets without an invented creation duration cap', () => {
    const call = { name: 'calendar_create_event', arguments: {
      summary: 'Two-day visit', start: '2026-10-21T10:00:00+01:00',
      end: '2026-10-23T11:00:00+01:00', timeZone: 'Europe/London',
    } };
    expect(validateCalendarCall(call)).toEqual(call);
    expect(() => validateCalendarCall({ ...call, arguments: {
      ...call.arguments, start: '2026-10-21T10:00:00Z',
    } })).toThrow('TIME_REQUIRES_CLARIFICATION');
    expect(calendarActionHash(call.arguments)).toBe(calendarActionHash({
      timeZone: call.arguments.timeZone, end: call.arguments.end,
      start: call.arguments.start, summary: call.arguments.summary,
    }));
    expect(calendarEventId('operation-1')).toMatch(/^[0-9a-v]{64}$/);
    expect(calendarEventId('operation-1')).toBe(calendarEventId('operation-1'));
    expect(calendarEventId('operation-2')).not.toBe(calendarEventId('operation-1'));
    for (const tool of CALENDAR_TOOLS) {
      expect(tool.revision).toBe(CALENDAR_TOOL_REVISION);
    }
  });
});

describe('Calendar call validation semantics', () => {
  it('validates all five v2 calls without turning selectors into authority', () => {
    const calls = [
      { name: 'calendar_list_calendars', arguments: {} },
      { name: 'calendar_check_availability', arguments: {
        timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-10-22T00:00:00Z',
        timeZone: 'Etc/UTC', calendarIds: ['shared'] } },
      { name: 'calendar_list_events', arguments: { calendarId: 'shared',
        timeMin: '2026-10-21T00:00:00Z', timeMax: '2026-10-22T00:00:00Z', maxResults: 20 } },
      { name: 'calendar_get_event', arguments: { calendarId: 'shared', eventId: 'abcde' } },
      { name: 'calendar_create_event', arguments: { ...ACTION, calendarId: 'shared' } },
    ];
    for (const call of calls) expect(validateCalendarCall(call)).toEqual(call);
    for (const call of calls) for (const key of ['confirmed', 'conflictAccepted', 'accessToken',
      'connectionId', 'targetRevision', 'attendees', 'modelId']) {
      expect(() => validateCalendarCall({ ...call, arguments: { ...call.arguments, [key]: true } }))
        .toThrow('CALENDAR_FORBIDDEN');
    }
    expect(() => validateCalendarCall({ name: 'calendar_list_calendars', arguments: { calendarId: 'shared' } }))
      .toThrow('CALENDAR_ARGUMENTS_INVALID');
    expect(() => validateCalendarCall({ name: 'calendar_get_event', arguments: {
      eventId: 'abcde', calendarIds: ['shared'] } })).toThrow('CALENDAR_ARGUMENTS_INVALID');
    expect(() => validateCalendarCall({ name: 'calendar_get_event', arguments: {
      eventId: 'abcde', location: { calendarId: 'shared' } } })).toThrow('CALENDAR_ARGUMENTS_INVALID');
  });

  it('applies the exact list window and real zone to availability too', () => {
    const call = { name: 'calendar_check_availability', arguments: {
      timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-02-01T00:00:00Z', timeZone: 'Etc/UTC' } };
    expect(validateCalendarCall(call)).toEqual(call);
    for (const arguments_ of [
      { ...call.arguments, timeMax: '2026-02-01T00:00:00.000000001Z' },
      { ...call.arguments, timeMin: '2026-02-30T00:00:00Z' },
      { ...call.arguments, timeMax: call.arguments.timeMin },
      { ...call.arguments, timeZone: 'Invalid/Zone' },
    ]) expect(() => validateCalendarCall({ ...call, arguments: arguments_ }))
      .toThrow('TIME_REQUIRES_CLARIFICATION');
    for (const calendarId of ['.', '..', 'bad\nID']) expect(() => validateCalendarCall({
      name: 'calendar_get_event', arguments: { calendarId, eventId: 'abcde' } }))
      .toThrow('CALENDAR_ARGUMENTS_INVALID');
  });

  it('bounds the list range at exactly the approved window', () => {
    const exact = listCall({ timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2026-02-01T00:00:00Z', maxResults: 5 });
    expect(validateCalendarCall(exact)).toEqual(exact);
    expect(() => validateCalendarCall(listCall({ timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2026-02-01T00:00:00.000000001Z', maxResults: 5 })))
      .toThrow('TIME_REQUIRES_CLARIFICATION');
    expect(() => validateCalendarCall(listCall({ timeMin: '2026-02-01T00:00:00Z',
      timeMax: '2026-01-01T00:00:00Z', maxResults: 5 }))).toThrow('TIME_REQUIRES_CLARIFICATION');
    expect(() => validateCalendarCall(listCall({ timeMin: '2026-01-01T00:00:00Z',
      timeMax: '2026-01-01T00:00:00Z', maxResults: 5 }))).toThrow('TIME_REQUIRES_CLARIFICATION');
  });

  it('separates structural argument failures from semantic ones', () => {
    const base = { timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-01-02T00:00:00Z' };
    for (const maxResults of [1, 20]) {
      expect(() => validateCalendarCall(listCall({ ...base, maxResults }))).not.toThrow();
    }
    for (const maxResults of [0, 21, 1.5, '20', null]) {
      expect(() => validateCalendarCall(listCall({ ...base, maxResults })))
        .toThrow('CALENDAR_ARGUMENTS_INVALID');
    }
    expect(() => validateCalendarCall(listCall({ ...base, maxResults: 5, extraLabel: 'x' })))
      .toThrow('CALENDAR_ARGUMENTS_INVALID');
    expect(() => validateCalendarCall({ name: 'calendar_get_event', arguments: { eventId: 42 } }))
      .toThrow('CALENDAR_ARGUMENTS_INVALID');
    expect(() => validateCalendarCall({ name: 'calendar_get_event', arguments: {} }))
      .toThrow('CALENDAR_ARGUMENTS_INVALID');
    try {
      validateCalendarCall(listCall({ ...base, maxResults: 0 }));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toMatch(/invalid_type|Zod|expected/i);
      expect((error as { failure: { retry: string } }).failure.retry).toBe('schema-repair');
    }
  });

  it('requires complete unambiguous instants and a real named zone', () => {
    for (const start of ['2026-10-21', '2026-10-21T10:00:00', '2026-10-21T10:00:00+01:00 trailing',
      '2026-10-21T10:00:00-00:00', '2026-02-30T10:00:00Z', '2026-13-01T10:00:00Z',
      '2026-10-21T24:00:00Z', '2026-10-21T23:59:60Z', '2026-10-21T10:60:00Z']) {
      expect(() => validateCalendarCall({ ...createCall, arguments: {
        ...createCall.arguments, start, end: '2026-10-21T12:00:00Z' } }))
        .toThrow('TIME_REQUIRES_CLARIFICATION');
    }
    expect(() => validateCalendarCall({ ...createCall, arguments: {
      ...createCall.arguments, timeZone: 'Not/AZone' } })).toThrow('TIME_REQUIRES_CLARIFICATION');
    expect(() => validateCalendarCall({ ...createCall, arguments: {
      ...createCall.arguments, summary: '   ' } })).toThrow('SUMMARY_REQUIRES_CLARIFICATION');
  });

  it('never normalizes a daylight-saving gap and accepts both valid fold offsets', () => {
    expect(() => validateCalendarCall({ ...createCall, arguments: {
      ...createCall.arguments, timeZone: 'America/New_York',
      start: '2026-03-08T02:30:00-05:00', end: '2026-03-08T04:00:00-04:00' } }))
      .toThrow('TIME_REQUIRES_CLARIFICATION');
    for (const [start, end] of [
      ['2026-11-01T01:30:00-04:00', '2026-11-01T02:30:00-05:00'],
      ['2026-11-01T01:30:00-05:00', '2026-11-01T02:30:00-05:00'],
    ] as const) {
      expect(() => validateCalendarCall({ ...createCall, arguments: {
        ...createCall.arguments, timeZone: 'America/New_York', start, end } })).not.toThrow();
    }
    expect(() => validateCalendarCall({ ...createCall, arguments: {
      ...createCall.arguments, timeZone: 'America/New_York',
      start: '2026-11-01T01:30:00-06:00', end: '2026-11-01T02:30:00-06:00' } }))
      .toThrow('TIME_REQUIRES_CLARIFICATION');
  });

  it('accepts consistent offsets for London and UTC', () => {
    for (const [timeZone, start, end] of [
      ['Europe/London', '2026-07-01T10:00:00+01:00', '2026-07-01T11:00:00+01:00'],
      ['Europe/London', '2026-01-15T10:00:00Z', '2026-01-15T11:00:00Z'],
      ['Etc/UTC', '2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z'],
      ['Etc/UTC', '2026-07-01T10:00:00+00:00', '2026-07-01T11:00:00+00:00'],
    ] as const) {
      expect(() => validateCalendarCall({ name: 'calendar_create_event', arguments: {
        summary: 'Visit', start, end, timeZone } })).not.toThrow();
    }
  });

  it('keeps sub-millisecond ordering instead of rounding equal instants', () => {
    const call = { name: 'calendar_create_event', arguments: {
      summary: 'Visit', start: '2026-10-21T10:00:00.000000001Z',
      end: '2026-10-21T10:00:00.000000002Z', timeZone: 'Etc/UTC' } };
    expect(validateCalendarCall(call)).toEqual(call);
    expect(() => validateCalendarCall({ ...call, arguments: {
      ...call.arguments, end: '2026-10-21T10:00:00.000000001Z' } }))
      .toThrow('TIME_REQUIRES_CLARIFICATION');
    const start = parseCalendarTimestamp(call.arguments.start);
    const end = parseCalendarTimestamp(call.arguments.end);
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(compareCalendarTimes(end!, start!)).toBeGreaterThan(0);
    expect(formatCalendarUtc(start!)).toBe('2026-10-21T10:00:00.000000001Z');
    expect(formatCalendarUtc(end!)).toBe('2026-10-21T10:00:00.000000002Z');
  });

  it('rejects forbidden keys, all-day shapes and unsupported tool names as policy', () => {
    for (const key of forbiddenCalendarKeys) {
      expect(() => validateCalendarCall({ ...createCall, arguments: {
        ...createCall.arguments, [key]: 'override' } })).toThrow('CALENDAR_FORBIDDEN');
      expect(() => validateCalendarCall({ ...createCall, arguments: {
        ...createCall.arguments, location: { [key]: 'override' } } })).toThrow('CALENDAR_FORBIDDEN');
    }
    expect(() => validateCalendarCall({ ...createCall, arguments: {
      ...createCall.arguments, start: { date: '2026-10-21' } } })).toThrow('CALENDAR_FORBIDDEN');
    for (const name of ['calendar_update_event', 'calendar_delete_event', 'calendar_list']) {
      expect(() => validateCalendarCall({ name, arguments: {} })).toThrow('CALENDAR_UNKNOWN_TOOL');
    }
  });

  it('accepts opaque event identifiers and rejects control characters and dot segments', () => {
    for (const eventId of ['a/b', 'a?b=c', 'a%20b', 'événement', 'a_b0123456789abcdef']) {
      expect(() => validateCalendarCall({ name: 'calendar_get_event', arguments: { eventId } }))
        .not.toThrow();
    }
    for (const eventId of ['a\rb', 'a\nb', 'a\tb', '.', '..']) {
      expect(() => validateCalendarCall({ name: 'calendar_get_event', arguments: { eventId } }))
        .toThrow('CALENDAR_ARGUMENTS_INVALID');
    }
  });

  it.each([
    [listCall({ timeMin: 'not-a-time', timeMax: '2026-01-02T00:00:00Z', maxResults: 5 }),
      'timeMin', 'rfc3339', 'TIME_REQUIRES_CLARIFICATION'],
    [listCall({ timeMin: '2026-01-02T00:00:00Z', timeMax: '2026-01-01T00:00:00Z', maxResults: 5 }),
      'timeMax', 'time-order', 'TIME_REQUIRES_CLARIFICATION'],
    [listCall({ timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-03-01T00:00:00Z', maxResults: 5 }),
      'timeMax', 'max-window', 'TIME_REQUIRES_CLARIFICATION'],
    [{ ...createCall, arguments: { ...createCall.arguments, timeZone: 'Not/AZone' } },
      'timeZone', 'iana-zone', 'TIME_REQUIRES_CLARIFICATION'],
    [{ ...createCall, arguments: { ...createCall.arguments, summary: '   ' } },
      'summary', undefined, 'SUMMARY_REQUIRES_CLARIFICATION'],
    [{ name: 'calendar_get_event', arguments: { eventId: 'bad\nID' } },
      'eventId', 'valid-id', 'CALENDAR_ARGUMENTS_INVALID'],
    [{ name: 'calendar_get_event', arguments: { eventId: 'abcde', calendarId: '.' } },
      'calendarId', 'valid-id', 'CALENDAR_ARGUMENTS_INVALID'],
  ] as const)('observes the original semantic field without leaking values %#', (call, field, constraint, code) => {
    const facts: Record<string, unknown>[] = [];
    const throwing = (): never => { throw new Error('secret'); };
    let without: unknown;
    try { validateCalendarCall(call); } catch (error) { without = error; }
    let withSink: unknown;
    try { validateCalendarCall(call, CALENDAR_LIMITS, f => { facts.push({ ...f }); }); }
    catch (error) { withSink = error; }
    let thrown: unknown;
    try { validateCalendarCall(call, CALENDAR_LIMITS, throwing); } catch (error) { thrown = error; }
    expect(withSink).toEqual(without);
    expect(thrown).toEqual(without);
    expect(facts[0]).toMatchObject({
      stage: 'validation', state: 'rejected', field, origin: 'local', delivery: 'not-sent', code,
      ...(constraint ? { constraint } : {}),
    });
    expect(JSON.stringify(facts)).not.toContain('not-a-time');
    expect(JSON.stringify(facts)).not.toContain('Not/AZone');
    expect(JSON.stringify(facts)).not.toContain('bad');
  });
});

describe('create authority', () => {
  it('hashes canonical target and rejects mismatched or legacy create authority', () => {
    const target = multiTarget();
    const operation = multiOperation(target);
    const bound = multiBinding(target, operation);
    expect(calendarActionHash({ ...ACTION, calendarId: 'shared' }))
      .not.toBe(calendarActionHash({ ...ACTION, calendarId: 'other' }));
    expect(requireCreateAuthority(bound, { ...ACTION, calendarId: 'shared' })).toEqual(operation);
    for (const action of [{ ...ACTION, calendarId: 'other' }, { ...ACTION, summary: 'Changed', calendarId: 'shared' }]) {
      expect(() => requireCreateAuthority(bound, action)).toThrow('OPERATION_AUTHORITY_REQUIRED');
    }
    expect(() => requireCreateAuthority(binding({ operation: dispatchingOperation() as never }), ACTION))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(calendarEventId(operation.operationId)).toBe(operation.googleEventId);
  });

  it('requires a live dispatching operation bound to the current identity and action', () => {
    const target = multiTarget();
    const operation = multiOperation(target);
    const current = multiBinding(target, operation);
    expect(requireCreateAuthority(current, { ...ACTION, calendarId: target.calendarId }).operationId).toBe('op_1');
    expect(requireCreateAuthority(current, { ...ACTION }).operationId).toBe('op_1');
    expect(() => requireCreateAuthority(multiBinding(target, null), { ...ACTION }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    for (const state of ['planned', 'succeeded', 'unknown', 'evidence-expired', 'failed', 'cancelled'] as const) {
      expect(() => requireCreateAuthority({ ...current,
        operation: { ...operation, state } as never }, { ...ACTION }))
        .toThrow('OPERATION_AUTHORITY_REQUIRED');
    }
    expect(() => requireCreateAuthority({ ...current,
      operation: { ...operation, auditExpiresAt: '2026-10-20T10:00:00.000Z' } as never }, { ...ACTION }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(() => requireCreateAuthority({ ...current,
      operation: { ...operation, userId: 'u2' } as never }, { ...ACTION }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(() => requireCreateAuthority({ ...current,
      operation: { ...operation, sessionId: 's2' } as never }, { ...ACTION }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(() => requireCreateAuthority({ ...current,
      operation: { ...operation, turnId: 't2' } as never }, { ...ACTION }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(() => requireCreateAuthority({ ...current,
      operation: { ...operation, targetRevision: 2 } as never }, { ...ACTION }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(() => requireCreateAuthority({ ...current,
      operation: { ...operation, connectionRevision: 2 } as never }, { ...ACTION }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(() => requireCreateAuthority({ ...current,
      operation: { ...operation, googleSubjectId: 'other' } as never }, { ...ACTION }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(() => requireCreateAuthority({ ...current,
      target: { ...target, googleSubjectId: 'other' } as never }, { ...ACTION }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    for (const role of ['reader', 'freeBusyReader'] as const) {
      expect(() => requireCreateAuthority(multiBinding(multiTarget(role), operation as never), { ...ACTION }))
        .toThrow('OPERATION_AUTHORITY_REQUIRED');
    }
    expect(() => requireCreateAuthority(current, { ...ACTION, summary: 'Other' }))
      .toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(() => requireCreateAuthority({ ...current,
      operation: { ...operation, requestHash: calendarActionHash({ ...ACTION, summary: 'Other', calendarId: target.calendarId }) } as never },
      { ...ACTION })).toThrow('OPERATION_AUTHORITY_REQUIRED');
    expect(() => requireCreateAuthority(current, { ...ACTION }))
      .not.toThrow();
  });

  it('lets a later attempt resume the originating operation without minting an event id', () => {
    const target = multiTarget();
    const operation = multiOperation(target);
    const resumed = multiBinding(target, operation);
    (resumed as { attemptId: string }).attemptId = 'a_2';
    const required = requireCreateAuthority(resumed, { ...ACTION });
    expect(required.googleEventId).toBe(calendarEventId('op_1'));
    expect(required.originatingAttemptId).toBe('a_1');
  });

  it('constructs only allowlisted failures', () => {
    const fault = toolFault('policy', 'CALENDAR_FORBIDDEN');
    expect(fault.message).toBe('CALENDAR_FORBIDDEN');
    expect(fault.failure).toEqual({ category: 'policy', code: 'CALENDAR_FORBIDDEN', retry: 'none' });
  });
});
