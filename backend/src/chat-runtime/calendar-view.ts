/**
 * ============================================================================
 * FILE: calendar-view.ts
 * LOCATION: backend/src/chat-runtime/calendar-view.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Derive bounded Calendar presentation views from already-available evidence.
 *
 * ROLE IN PROJECT:
 *    Pure projections over executor results, saved proposals, and durable
 *    operation states. Performs no IO, storage, provider, or authorization work.
 *
 * KEY COMPONENTS:
 *    - projectAgendaView: Read result plus source disclosure to agenda view.
 *    - projectProposalView: Canonical proposal to structured proposal view.
 *    - projectOutcomeView: Existing durable projection to outcome view.
 *    - fitCalendarView / calendarNotice: Deterministic byte fitting and notices.
 * ============================================================================
 */

import { calendarViewSchema, CALENDAR_VIEW_MAX_BYTES, type CalendarView } from '../contracts/calendar-view.js';
import type { CalendarCall, CalendarResultV2 } from '../contracts/calendar-tools.js';
import type { CalendarSourceReferenceV2 } from '../contracts/calendar-sources.js';
import type { CalendarProposalRecord } from '../contracts/calendar-authority.js';
import type { CalendarTurnStateV2 } from './calendar-publication.js';
import { safeCalendarLinkSchema } from '../contracts/calendar-link.js';

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
export function calendarNotice(state: Extract<CalendarView, { kind: 'notice' }>['state'], message: string,
  refs: Partial<Pick<Extract<CalendarView, { kind: 'notice' }>, 'proposalId' | 'intentId' | 'tool' | 'coverage' | 'conflict' | 'limitations'>> = {}): CalendarView {
  return calendarViewSchema.parse({ viewVersion: 1, kind: 'notice', state, message: message.slice(0, 1000),
    proposalId: null, intentId: null, tool: null, coverage: null, conflict: null, limitations: [], ...refs });
}
export function fitCalendarView(value: CalendarView): CalendarView {
  const view = structuredClone(value);
  if (bytes(view) <= CALENDAR_VIEW_MAX_BYTES) return calendarViewSchema.parse(view);
  if (view.kind === 'agenda') {
    // ponytail: <=20 entries; remove optional details before any core omission.
    for (const entry of view.entries) { delete entry.description; delete entry.location; }
    view.detailsTrimmed = true;
    while (view.entries.length && bytes(view) > CALENDAR_VIEW_MAX_BYTES) {
      view.entries.pop(); view.entriesOmitted++; view.truncated = true;
    }
    if (bytes(view) <= CALENDAR_VIEW_MAX_BYTES) return calendarViewSchema.parse(view);
  }
  return calendarNotice('unavailable', 'Calendar details exceed the visual limit. Use the conversation details.',
    { proposalId: 'proposalId' in view ? view.proposalId : null, intentId: 'intentId' in view ? view.intentId : null });
}
export function projectAgendaView(call: CalendarCall, result: CalendarResultV2,
  source: CalendarSourceReferenceV2, displayTimeZone: string): CalendarView | null {
  if (result.tool !== 'calendar_list_events' && result.tool !== 'calendar_get_event') return null;
  const retained = source.permission.content === 'retained' && source.redactedAt === null;
  const htmlLink = (value: string | null) => {
    const parsed = retained ? safeCalendarLinkSchema.safeParse(value) : null;
    return parsed?.success ? parsed.data : null;
  };
  const entries = (result.tool === 'calendar_list_events' ? result.events : [result.event]).map(e => ({
    ...e, allDay: e.allDay ?? false, htmlLink: htmlLink(e.htmlLink),
  }));
  return fitCalendarView({ viewVersion: 1, kind: 'agenda',
    target: { calendarId: result.target.calendarId, calendarLabel: retained ? result.target.calendarLabel : null,
      labelExpiresAt: retained ? source.expiresAt : null },
    requested: call.name === 'calendar_list_events' ? { timeMin: call.arguments.timeMin,
      timeMax: call.arguments.timeMax, displayTimeZone } : null,
    entries, nextPageToken: result.tool === 'calendar_list_events' ? result.nextPageToken : null,
    truncated: result.tool === 'calendar_list_events' && result.truncated,
    detailsTrimmed: false, entriesOmitted: 0, expiresAt: source.expiresAt });
}
export function projectProposalView(p: CalendarProposalRecord): CalendarView {
  const expiresAt = new Date(Math.min(Date.parse(p.expiresAt), Date.parse(p.contentExpiresAt))).toISOString();
  return fitCalendarView({ viewVersion: 1, kind: 'proposal', proposalId: p.proposalId, intentId: p.intentId,
    revision: p.revision, expiresAt,
    reason: p.purpose === 'selection' ? 'target' : p.purpose === 'details' ? 'details'
      : p.disclosedLimitations.length ? 'coverage' : 'conflict',
    action: p.action, target: p.target ? { calendarId: p.target.calendarId,
      calendarLabel: p.target.calendarLabel, labelExpiresAt: expiresAt } : null,
    candidates: p.candidates.slice(0, 20).map(c => ({ calendarId: c.target.calendarId,
      label: c.target.calendarLabel, role: c.target.accessRole })) });
}
export function projectOutcomeView(p: CalendarTurnStateV2): CalendarView | null {
  if (!p.intentId) return null; // Legacy records are not assigned invented correlation.
  return fitCalendarView({ viewVersion: 1, kind: 'outcome', operationId: p.operationId,
    proposalId: p.proposalId ?? null, intentId: p.intentId, state: p.state,
    retryAction: p.retryAction, receipt: p.receipt });
}
