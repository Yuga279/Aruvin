/**
 * ============================================================================
 * FILE: calendar-view.spec.ts
 * LOCATION: backend/test/runtime/calendar-view.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove pure bounded Calendar view projections from existing evidence.
 *
 * ROLE IN PROJECT:
 *    Guards disclosure expiry, optional-detail trimming, truthful outcome copies,
 *    and the byte-fitting ceiling without services or provider calls.
 *
 * KEY COMPONENTS:
 *    - Agenda projection: Requested range and trusted display zone preserved.
 *    - Detail trimming: Optional fields go before any core omission.
 *    - Outcome copy: Durable projection facts only, never prose.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { fitCalendarView, projectAgendaView, projectProposalView, projectOutcomeView }
  from '../../src/chat-runtime/calendar-view.js';
import { calendarProposalSchema } from '../../src/contracts/calendar-authority.js';
import { calendarTurnStateV2Schema } from '../../src/contracts/calendar-wire.js';
import { calendarResultV2Schema } from '../../src/contracts/calendar-tools.js';
import { sourceReferenceV2Schema } from '../../src/contracts/calendar-sources.js';
import { agendaFixture } from '../contracts/calendar-view.fixture.js';
import { proposal, sourceV2, event, target } from '../contracts/calendar-multi-fixtures.js';

it('uses the requested range and trusted display zone without converting dates', () => {
  const call = { name: 'calendar_list_events' as const, arguments: {
    timeMin: '2026-10-22T00:00:00Z', timeMax: '2026-10-24T00:00:00Z', maxResults: 20 } };
  const view = projectAgendaView(call, calendarResultV2Schema.parse({ schemaVersion: 2, tool: 'calendar_list_events',
    target: { calendarId: target.calendarId, calendarLabel: target.calendarLabel,
      privateAccess: true, discoveryRevision: 1 },
    events: [{ ...event, allDay: true, start: '2026-10-22', end: '2026-10-24' }],
    nextPageToken: 'opaque-continuation', truncated: true }), sourceReferenceV2Schema.parse(sourceV2), 'Asia/Kolkata');
  expect(view).toMatchObject({ kind: 'agenda', requested: { timeMin: call.arguments.timeMin,
    timeMax: call.arguments.timeMax, displayTimeZone: 'Asia/Kolkata' },
    entries: [{ allDay: true, start: '2026-10-22', end: '2026-10-24' }], truncated: true });
  if (view?.kind === 'agenda') expect(view.requested).not.toHaveProperty('maxResults');
});

it('trims optional details before omitting any core events', () => {
  const entry = { eventId: 'abcde', summary: 'Event', start: '2026-11-11T10:00:00Z',
    end: '2026-11-11T11:00:00Z', allDay: false, timeZone: 'Etc/UTC', status: 'confirmed' as const,
    htmlLink: null, description: '界'.repeat(2000), location: 'Place' };
  const input = { ...agendaFixture(), entries: Array.from({ length: 20 }, (_, n) => ({ ...entry, eventId: `event-${n}` })) };
  const view = fitCalendarView(input);
  expect(Buffer.byteLength(JSON.stringify(view), 'utf8')).toBeLessThanOrEqual(14336);
  expect(view).toMatchObject({ kind: 'agenda', detailsTrimmed: true, entriesOmitted: 0 });
  if (view.kind === 'agenda') expect(view.entries).toHaveLength(20);
  expect(input.entries[0].description).toHaveLength(2000); // no mutation
});

it('labels unavoidable core omission rather than pretending a complete agenda', () => {
  const entry = { eventId: '界'.repeat(1000), summary: '界'.repeat(200), start: '2026-11-11',
    end: '2026-11-12', allDay: true, timeZone: null, status: 'confirmed' as const, htmlLink: null };
  const view = fitCalendarView({ ...agendaFixture(), entries: Array.from({ length: 20 }, () => ({ ...entry })) });
  expect(view.kind).toBe('agenda');
  if (view.kind === 'agenda') {
    expect(view.entries.length + view.entriesOmitted).toBe(20);
    expect(view.entriesOmitted).toBeGreaterThan(0);
    expect(view.truncated).toBe(true);
    expect(view.nextPageToken).toBeNull();
  }
});

it('copies the canonical proposal action and durable projection, never prose', () => {
  const saved = calendarProposalSchema.parse(proposal);
  const view = projectProposalView(saved);
  expect(view).toMatchObject({ kind: 'proposal', proposalId: saved.proposalId,
    intentId: saved.intentId, revision: saved.revision, action: saved.action });
  const state = calendarTurnStateV2Schema.parse({ schemaVersion: 2, operationId: 'op',
    proposalId: saved.proposalId, intentId: saved.intentId, state: 'unknown', narration: 'completed',
    retryAction: 'resume-reconciliation', receipt: null });
  expect(projectOutcomeView(state)).toMatchObject({ kind: 'outcome', state: 'unknown', receipt: null });
});
