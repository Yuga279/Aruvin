import { describe, expect, it } from 'vitest';
import { calendarStatusResponseSchema, calendarDisconnectRequestSchema, calendarSettingsRequestSchema,
  calendarStreamEnvelopeSchema, parseCalendarCompatibleFrame,
  calendarTurnStateSchema } from '../../src/contracts/calendar-wire.js';
import { streamEnvelopeSchema } from '../../src/contracts/stream.js';
import { turnStatusResponseSchema, submitTurnRequestSchema, retryTurnRequestSchema } from '../../src/contracts/api.js';
describe('Calendar compatible wire', () => {
  it('reads old streams and new progress without leaking implementation payloads', () => {
    const old = { protocolVersion: 1, sessionId: 's', turnId: 't', attemptId: 'a', sequence: 1,
      event: { type: 'delta', text: 'Hello' } };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(old)}`)).toEqual(streamEnvelopeSchema.parse(old));
    const frame = { ...old, protocolVersion: 2, event: { type: 'calendar-progress', phase: 'repairing' } };
    expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(frame)}`)).toEqual(frame);
    expect(streamEnvelopeSchema.safeParse(frame).success).toBe(false);
    for (const field of ['accessToken', 'refreshToken', 'arguments', 'checkpoint', 'diagnostics']) {
      expect(calendarStreamEnvelopeSchema.safeParse({ ...frame, event: { ...frame.event, [field]: 'secret' } }).success).toBe(false);
    }
    const oldStatus = { sessionId: 's', turnId: 't', attemptId: 'a', status: 'completed', truncated: false, error: null };
    expect(turnStatusResponseSchema.parse(oldStatus)).toEqual(oldStatus);
    const submit = { sessionId: null, content: 'Hello', idempotencyKey: 'idempotency_1' };
    expect(submitTurnRequestSchema.parse(submit)).toEqual(submit);
    expect(submitTurnRequestSchema.safeParse({ ...submit, calendarProtocol: 2 }).success).toBe(true);
    expect(submitTurnRequestSchema.safeParse({ ...submit, calendarProtocol: 1 }).success).toBe(false);
    expect(retryTurnRequestSchema.safeParse({ idempotencyKey: 'idempotency_2', calendarProtocol: 2 }).success).toBe(true);
  });
  it('distinguishes local disconnect, explicit revoke and durable action/narration outcomes', () => {
    expect(calendarDisconnectRequestSchema.safeParse({ mode: 'local' }).success).toBe(true);
    expect(calendarDisconnectRequestSchema.safeParse({ mode: 'revoke-google-grant' }).success).toBe(false);
    expect(calendarSettingsRequestSchema.safeParse({ enabled: true, userId: 'spoofed' }).success).toBe(false);
    expect(calendarStatusResponseSchema.safeParse({ protocolVersion: 1, state: 'setup-required',
      enabled: false, accountEmail: null, targetCalendarId: null, processingDisclosure: null }).success).toBe(true);
    const action = { operationId: 'op', state: 'succeeded', narration: 'failed', retryAction: 'none',
      receipt: { durable: true, eventId: 'abcde', htmlLink: null, expiresAt: null } };
    expect(calendarTurnStateSchema.parse(action).state).toBe('succeeded');
    expect(calendarTurnStateSchema.safeParse({ ...action, state: 'unknown' }).success).toBe(false);
    expect(calendarTurnStateSchema.safeParse({ ...action, receipt: { ...action.receipt, htmlLink: 'javascript:alert(1)' } }).success).toBe(false);
  });
});
