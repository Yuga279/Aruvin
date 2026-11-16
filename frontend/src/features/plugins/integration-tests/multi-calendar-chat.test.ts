/**
 * ============================================================================
 * FILE: multi-calendar-chat.test.ts
 * LOCATION: frontend/src/features/plugins/integration-tests/multi-calendar-chat.test.ts
 * ============================================================================
 * PURPOSE:
 *    Verify v3 clarification and durable receipt presentation through client state.
 * ROLE IN PROJECT:
 *    Connects strict SSE parsing to the real chat reducer and safe SSR components.
 *    Preserves drafts and target provenance without browser authorization logic.
 * KEY COMPONENTS:
 *    - Parsed clarification: Current-session fencing and no synthesized approval.
 *    - Durable receipt: Failed narration and expiry-aware original target display.
 * ============================================================================
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { parseCalendarCompatibleFrame } from '../../../api/calendar-protocol.ts';
import { chatReducer, initialChatState } from '../../chat/state/chat-reducer.ts';
import type { ChatState } from '../../chat/state/chat-types.ts';
import { CalendarTurnView } from '../google-calendar/CalendarTurnRegion.tsx';
import { clarification, createdOperation, multiStatus } from '../google-calendar/testing/multi-calendar-fixtures.ts';

it('parses clarification without approval or draft mutation and retains the durable original target', () => {
  expect(typeof document).toBe('undefined');
  let state: ChatState = { ...initialChatState, activeSessionId: 's', activeTurnId: 't', activeAttemptId: 'a',
    isStreaming: true, draftInput: 'Keep my draft' };
  const parsed = parseCalendarCompatibleFrame(`data: ${JSON.stringify({ protocolVersion: 3,
    sessionId: 's', turnId: 't', attemptId: 'a', sequence: 1, event: clarification() })}`);
  if (parsed.event.type !== 'calendar-clarification') throw new Error('Expected parsed clarification.');
  state = chatReducer(state, { type: 'CALENDAR_CLARIFICATION', payload: { sessionId: 's',
    turnId: 't', attemptId: 'a', sequence: 1, clarification: parsed.event } });
  expect(state.draftInput).toBe('Keep my draft');
  expect(state.calendarOperationsByTurn).toEqual({});
  const operationFrame = parseCalendarCompatibleFrame(`data: ${JSON.stringify({ protocolVersion: 3,
    sessionId: 's', turnId: 't', attemptId: 'a', sequence: 2,
    event: { type: 'calendar-operation', operation: createdOperation() } })}`);
  if (operationFrame.event.type !== 'calendar-operation') throw new Error('Expected parsed receipt.');
  state = chatReducer(state, { type: 'CALENDAR_OPERATION', payload: { sessionId: 's', turnId: 't',
    attemptId: 'a', sequence: 2, operation: operationFrame.event.operation } });
  const changedDefault = multiStatus({ defaultSetting: { defaultCalendarId: 'different', defaultSettingRevision: 8 } });
  expect(changedDefault.defaultSetting?.defaultCalendarId).toBe('different');
  const render = (nowMs: number) => renderToStaticMarkup(createElement(CalendarTurnView, {
    progress: null, operations: [{ turnId: 't', operation: state.calendarOperationsByTurn.t }],
    disabled: false, nowMs, onRetryTurn: vi.fn(), onFocusComposer: vi.fn(),
  }));
  const current = render(Date.parse('2026-10-24T10:01:00Z'));
  expect(current).toContain('Calendar: Original Team');
  expect(current).toContain('The Calendar event was created and saved, but the final assistant response failed.');
  expect(current).not.toContain('Calendar: different');
  const expired = render(Date.parse('2026-10-24T10:06:00Z'));
  expect(expired).not.toContain('Calendar: Original Team');
  expect(expired).not.toContain('href="https://calendar.google.com');
  expect(expired).toContain('event12345');
});
