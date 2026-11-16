/**
 * ============================================================================
 * FILE: calendar-multi-wire.spec.ts
 * LOCATION: backend/test/contracts/calendar-multi-wire.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Google Calendar Phase 2 public wire, settings, status, and streaming contracts.
 *
 * ROLE IN PROJECT:
 *    Ensures protocol negotiation (v2 status, v3 stream frames), target preferences,
 *    calendar pagination routes, and truthful target receipt wire envelopes.
 *
 * KEY COMPONENTS:
 *    - calendarSettingsV2RequestSchema / calendarStatusV2ResponseSchema
 *    - calendarTurnStateV2Schema / calendarMultiStreamEnvelopeSchema
 *    - parseCalendarCompatibleFrame / calendarCompatibleEnvelopeSchema
 *    - submitTurnRequestSchema / retryTurnRequestSchema
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { calendarSettingsV2RequestSchema, calendarStatusV2ResponseSchema,
  calendarTurnStateV2Schema, calendarMultiStreamEnvelopeSchema, parseCalendarCompatibleFrame,
  CALENDAR_API_ROUTES, calendarCalendarsQuerySchema,
} from '../../src/contracts/calendar-wire.js';
import { submitTurnRequestSchema, retryTurnRequestSchema } from '../../src/contracts/api.js';
import { at, until } from './calendar-multi-fixtures.js';

it('versions public targeting without toggling enablement or manufacturing receipt authority', () => {
  const preference = { defaultSetting: { calendarId: null, expectedRevision: 1,
    expectedConnectionRevision: 1 } };
  expect(calendarSettingsV2RequestSchema.parse(preference)).toEqual(preference);
  expect(calendarSettingsV2RequestSchema.safeParse({ enabled: false }).success).toBe(true);
  expect(calendarSettingsV2RequestSchema.safeParse({}).success).toBe(false);
  expect(calendarSettingsV2RequestSchema.safeParse({ defaultSetting: { calendarId: 'primary' } }).success).toBe(false);
  expect(calendarSettingsV2RequestSchema.safeParse({ ...preference, userId: 'forged' }).success).toBe(false);
  expect(CALENDAR_API_ROUTES.calendars).toBe('/plugins/google-calendar/calendars');
  expect(CALENDAR_API_ROUTES.calendarsRefresh).toBe('/plugins/google-calendar/calendars/refresh');
  expect(calendarCalendarsQuerySchema.safeParse({ pageToken: 'x'.repeat(2049) }).success).toBe(false);
  const status = { protocolVersion: 2, state: 'reconnect-required', enabled: false,
    accountEmail: null, processingDisclosure: null, connectionRevision: 1,
    defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 },
    primaryCalendarId: null, discovery: null,
    missingScopes: ['https://www.googleapis.com/auth/calendar.freebusy'] };
  expect(calendarStatusV2ResponseSchema.safeParse(status).success).toBe(true);
  expect(calendarStatusV2ResponseSchema.safeParse({ ...status, accessToken: 'secret' }).success).toBe(false);
  const operation = { schemaVersion: 2, operationId: 'op', state: 'succeeded', narration: 'failed',
    retryAction: 'none', receipt: { durable: true, eventId: 'abcde01234', htmlLink: null,
      expiresAt: until, calendarLabel: 'Team' } };
  expect(calendarTurnStateV2Schema.safeParse(operation).success).toBe(true);
  expect(calendarTurnStateV2Schema.safeParse({ ...operation, state: 'unknown' }).success).toBe(false);
  expect(calendarTurnStateV2Schema.safeParse({ ...operation, receipt: { ...operation.receipt,
    htmlLink: 'javascript:alert(1)' } }).success).toBe(false);
  const frame = { protocolVersion: 3, sessionId: 's', turnId: 't', attemptId: 'a', sequence: 1,
    event: { type: 'calendar-operation', operation } };
  expect(calendarMultiStreamEnvelopeSchema.safeParse(frame).success).toBe(true);
  expect(parseCalendarCompatibleFrame(`data: ${JSON.stringify(frame)}`)).toEqual(frame);
  expect(submitTurnRequestSchema.safeParse({ sessionId: null, content: 'hello',
    idempotencyKey: 'request-key', calendarProtocol: 3 }).success).toBe(true);
  expect(retryTurnRequestSchema.safeParse({ idempotencyKey: 'request-key', calendarProtocol: 3 }).success).toBe(true);
  expect(at).not.toBe(until);
});
