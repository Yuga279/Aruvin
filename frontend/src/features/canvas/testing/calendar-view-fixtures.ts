/**
 * ============================================================================
 * FILE: calendar-view-fixtures.ts
 * LOCATION: frontend/src/features/canvas/testing/calendar-view-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide deterministic Calendar view, frame, and message fixtures for tests.
 *
 * ROLE IN PROJECT:
 *    Supplies reusable, validated agenda/proposal/outcome/notice snapshots so
 *    protocol, reducer, controller, Canvas, and renderer tests share one shape.
 *
 * KEY COMPONENTS:
 *    - NOW / EXPIRY: Deterministic test clock and bounded label expiry.
 *    - agenda / proposal / outcome / notice: Valid CalendarView builders.
 *    - calendarMessage: VisibleMessage builder carrying a typed snapshot.
 * ============================================================================
 */

import type { CalendarView } from '../../../api/calendar-protocol.ts';
import type { VisibleMessage } from '../../../api/protocol.ts';
export const NOW = Date.parse('2026-11-11T12:00:00Z');
export const EXPIRY = '2026-11-11T12:05:00Z';
export const agenda = (): Extract<CalendarView, {kind:'agenda'}> => ({
  viewVersion: 1, kind: 'agenda',
  target: { calendarId: 'team@example.com', calendarLabel: 'Team', labelExpiresAt: EXPIRY },
  requested: {timeMin:'2026-11-11T00:00:00Z',timeMax:'2026-11-14T00:00:00Z',displayTimeZone:'Europe/London'},
  entries: [{eventId:'event-1',summary:'Design sync',start:'2026-11-11T14:00:00Z',
    end:'2026-11-11T15:00:00Z',allDay:false,timeZone:'Europe/London',status:'confirmed',
    description:'Discuss <script> safely',location:'Room 4',htmlLink:'https://calendar.google.com/calendar/event?eid=one'}],
  nextPageToken:null,truncated:false,detailsTrimmed:false,entriesOmitted:0,expiresAt:EXPIRY,
});
export const proposal = (): Extract<CalendarView, {kind:'proposal'}> => ({
  viewVersion:1,kind:'proposal',proposalId:'proposal-1',intentId:'intent-1',revision:2,
  expiresAt:EXPIRY,reason:'details',target:agenda().target,
  action:{summary:'Design sync',start:'2026-11-11T14:00:00Z',end:'2026-11-11T15:00:00Z',timeZone:'Europe/London'},
  candidates:[],
});
export const outcome = (): Extract<CalendarView, {kind:'outcome'}> => ({
  viewVersion:1,kind:'outcome',operationId:'operation-1',proposalId:'proposal-1',intentId:'intent-1',
  state:'succeeded',retryAction:'none',receipt:{durable:true,eventId:'event-1',
    htmlLink:'https://calendar.google.com/calendar/event?eid=one',calendarLabel:'Team',expiresAt:EXPIRY},
});
export const notice = (): Extract<CalendarView, {kind:'notice'}> => ({
  viewVersion:1,kind:'notice',state:'unavailable',message:'Calendar unavailable. Try again later.',
  proposalId:null,intentId:null,tool:'calendar_list_events',coverage:'incomplete',conflict:null,limitations:['provider-error'],
});
export function calendarMessage(view: CalendarView = agenda(), mode: 'text'|'live' = 'text'): VisibleMessage {
  return {messageId:'assistant-1',turnId:'turn-1',eventId:'event-message-1',sequence:2,role:'assistant',
    content:mode === 'live' ? '' : 'Here is your calendar.',createdAt:'2026-11-11T12:00:00Z',
    completionStatus:'completed',truncated:false,mode,calendarView:view,
    ...(mode === 'live' ? {voiceSessionId:'voice-1',voiceTranscripts:[{role:'assistant' as const,content:'One event.'}]} : {})};
}
