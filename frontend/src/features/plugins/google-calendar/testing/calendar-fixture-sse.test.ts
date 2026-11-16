/**
 * ============================================================================
 * FILE: calendar-fixture-sse.test.ts
 * LOCATION: frontend/src/features/plugins/google-calendar/testing/calendar-fixture-sse.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Node checks for Calendar browser-fixture SSE enqueue and follow-up turn routes.
 *
 * ROLE IN PROJECT:
 *    Reproduces the closed-controller enqueue failure and missing POST /turns
 *    mock without a real browser or live Google/OAuth traffic.
 *
 * KEY COMPONENTS:
 *    - enqueueFixtureSse: Safe SSE enqueue used by the Calendar browser fixture.
 *    - isChatTurnSubmitPath / isChatTurnStreamPath: Follow-up turn route matchers.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { isCalendarCalendarsResponse } from '../../../../api/calendar-protocol.ts';
import { calendarPage } from './multi-calendar-fixtures.ts';
import {
  enqueueFixtureSse,
  isChatTurnStreamPath,
  isChatTurnSubmitPath,
} from './calendar-fixture-sse.ts';

describe('calendar browser fixture SSE helpers', () => {
  it('admits follow-up turn submit and stream paths after the first session exists', () => {
    expect(isChatTurnSubmitPath('POST', '/api/sessions/sess-cal-1/turns')).toBe(true);
    expect(isChatTurnSubmitPath('POST', '/api/sessions')).toBe(false);
    expect(isChatTurnStreamPath('GET', '/api/sessions/sess-cal-1/turns/turn-cal-2/stream')).toBe(
      true,
    );
    expect(
      isChatTurnStreamPath('GET', '/api/sessions/sess-cal-1/turns/turn-cal-1/stream'),
    ).toBe(true);
  });

  it('rejects a calendar page whose fetched-to-expiry window exceeds five minutes', () => {
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          fetchedAt: '2026-10-26T12:00:00.000Z',
          expiresAt: '2026-10-26T12:05:30.000Z',
        }),
      ),
    ).toBe(false);
    expect(
      isCalendarCalendarsResponse(
        calendarPage({
          fetchedAt: '2026-10-26T12:00:00.000Z',
          expiresAt: '2026-10-26T12:05:00.000Z',
        }),
      ),
    ).toBe(true);
  });

  it('refuses enqueue on a closed ReadableStreamDefaultController', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(next) {
        controller = next;
      },
    });
    const reader = stream.getReader();
    const encoder = new TextEncoder();

    enqueueFixtureSse(controller, encoder, { ok: true });
    controller.close();
    await reader.cancel();

    expect(() => enqueueFixtureSse(controller, encoder, { late: true })).toThrow(
      'Calendar fixture stream is not open',
    );
  });
});
