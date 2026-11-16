/**
 * ============================================================================
 * FILE: calendar-canvas.test.ts
 * LOCATION: frontend/src/features/voice/integration-tests/calendar-canvas.test.ts
 * ============================================================================
 * PURPOSE:
 *    Verify Calendar wire, voice state, history and Canvas integration offline.
 * ROLE IN PROJECT:
 *    Exercises real frontend boundaries with existing Room and controller doubles.
 *    Uses SSR for markup only, not as evidence that browser effects ran.
 * KEY COMPONENTS:
 *    - Portable wire: Correlated frames and dictation exclusion.
 *    - History: Read-only snapshots, safe rendering and Canvas continuity.
 * ============================================================================
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { parseVoiceControl, type VoiceServerPayload } from '../../../api/voice-protocol.ts';
import type { VisibleMessage } from '../../../api/protocol.ts';
import type { CalendarView } from '../../../api/calendar-protocol.ts';
import { collectSessionCanvasArtifacts } from '../../canvas/canvas-artifacts.ts';
import { mergeCalendarWorkspaces, foldCalendarFrame } from '../../canvas/calendar-workspace.ts';
import { CanvasPanel } from '../../canvas/CanvasPanel.tsx';
import { chatReducer, initialChatState } from '../../chat/state/chat-reducer.ts';
import { matrixFixture } from './matrix-fixture.ts';
import { settle } from '../state/testing/live-voice-fixture.ts';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const agenda: CalendarView = {
  viewVersion: 1, kind: 'agenda',
  target: { calendarId: 'personal@example.test', calendarLabel: 'Personal',
    labelExpiresAt: '2026-11-11T10:05:00.000Z' },
  requested: { timeMin: '2026-11-03T00:00:00.000Z', timeMax: '2026-11-06T00:00:00.000Z',
    displayTimeZone: 'Etc/UTC' },
  entries: [{ eventId: 'evt_all_day_1', summary: 'Offsite', start: '2026-11-03', end: '2026-11-05',
    allDay: true, timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null,
    description: '<script>plain description</script>' }],
  nextPageToken: null, truncated: false, detailsTrimmed: false, entriesOmitted: 0,
  expiresAt: '2026-11-11T10:05:00.000Z',
};
const frame: VoiceServerPayload = { type: 'calendar.frame', turnId: 'calendar-turn-1',
  attemptId: 'calendar-attempt-1', responseId: 'calendar-response-1',
  event: { type: 'calendar-view', view: agenda } };
function archived(view: CalendarView, mode: 'text' | 'live' = 'text'): VisibleMessage {
  return { messageId: 'calendar-message-1', turnId: 'calendar-turn-1', eventId: 'calendar-event-1',
    sequence: 2, role: 'assistant', content: mode === 'text' ? 'Your agenda.' : '',
    createdAt: '2026-11-11T10:00:00.000Z', completionStatus: 'completed', truncated: false,
    mode, calendarView: view,
    ...(mode === 'live' ? { voiceSessionId: 'voice-history-1',
      voiceTranscripts: [{ role: 'assistant' as const, content: 'Your agenda.' }] } : {}),
  };
}
function panel(view: CalendarView): string {
  const artifacts = collectSessionCanvasArtifacts([archived(view)], '', false);
  expect(artifacts).toHaveLength(1);
  return renderToStaticMarkup(createElement(CanvasPanel, { artifacts,
    activeArtifactId: artifacts[0]!.artifactId, onSelectArtifact: vi.fn(),
    onCloseTab: vi.fn(), onClosePanel: vi.fn() }));
}
function liveProposal(): Extract<CalendarView, { kind: 'proposal' }> {
  return { viewVersion: 1, kind: 'proposal', proposalId: 'proposal-live-1', intentId: 'intent-live-1',
    revision: 2, expiresAt: '2026-11-11T10:05:00Z', reason: 'details',
    target: { calendarId: 'personal@example.test', calendarLabel: 'Personal',
      labelExpiresAt: '2026-11-11T10:05:00Z' },
    action: { summary: 'Planning', start: '2026-11-12T10:00:00Z',
      end: '2026-11-12T11:00:00Z', timeZone: 'Etc/UTC' }, candidates: [] };
}

it('accepts the correlated live frame and rejects it in dictation and client directions', () => {
  const event = { protocolVersion: 1, sessionId: 'voice-calendar-1', connectionEpoch: 1,
    eventId: 'wire-calendar-1', sequence: 0, ...frame };
  expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event);
  expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'dictation')).toThrow();
  expect(() => parseVoiceControl(JSON.stringify(event), 'client', 'live')).toThrow();
  expect(() => parseVoiceControl(JSON.stringify({ ...event, extra: true }), 'server', 'live')).toThrow();
});

it.each(['text', 'live'] as const)('reloads a %s calendar snapshot through actual artifact collection', mode => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  const row = archived(agenda, mode);
  const artifacts = collectSessionCanvasArtifacts([row], '', false);
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({ kind: 'calendar', messageId: row.messageId });
  let state = { ...initialChatState, messages: [row] };
  expect(state.canvasOpen).toBe(false);
  state = chatReducer(state, { type: 'OPEN_CANVAS_ARTIFACT',
    payload: { artifactId: artifacts[0]!.artifactId } });
  expect(state.canvasOpen).toBe(true);
  state = chatReducer(state, { type: 'CLOSE_CANVAS' });
  expect(state.canvasOpen).toBe(false);
  expect(collectSessionCanvasArtifacts([row], '', false)).toHaveLength(1);
  const html = panel(agenda);
  expect(html).toContain('Offsite');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('Confirmed on Google Calendar');
});

it('disarms historical proposal buttons rather than treating expiry as authorization', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  const proposal: CalendarView = { viewVersion: 1, kind: 'proposal', proposalId: 'proposal-history-1',
    intentId: 'intent-history-1', revision: 1, expiresAt: '2026-11-11T10:05:00.000Z', reason: 'details',
    target: { calendarId: 'personal@example.test', calendarLabel: 'Personal',
      labelExpiresAt: '2026-11-11T10:05:00.000Z' },
    action: { calendarId: 'personal@example.test', summary: 'Planning',
      start: '2026-11-12T10:00:00Z', end: '2026-11-12T11:00:00Z', timeZone: 'Etc/UTC' }, candidates: [] };
  const html = panel(proposal);
  expect(html).toContain('Planning');
  expect(html).not.toContain('Confirmed on Google Calendar');
  expect(html).toContain('Historical snapshot');
  expect(html).not.toContain('Calendar request confirmation');
  expect(html).not.toContain('>Confirm event</button>');
  expect(html).not.toContain('>Cancel request</button>');
});

it('renders a live proposal with named controls through merged workspace artifacts', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  const view = liveProposal();
  const workspaces = foldCalendarFrame([], { type: 'calendar.frame', turnId: 'calendar-turn-1',
    attemptId: 'calendar-attempt-1', responseId: 'calendar-response-1',
    event: { type: 'calendar-view', view } });
  const artifacts = mergeCalendarWorkspaces(
    collectSessionCanvasArtifacts([archived(view)], '', false), workspaces, true);
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]!.calendarWorkspace).toMatchObject({ interactive: true, pending: false });
  const answer = vi.fn();
  const html = renderToStaticMarkup(createElement(CanvasPanel, { artifacts,
    activeArtifactId: artifacts[0]!.artifactId, onSelectArtifact: vi.fn(),
    onCloseTab: vi.fn(), onClosePanel: vi.fn(), onCalendarAnswer: answer }));
  expect(html).toContain('Calendar request confirmation');
  expect(html).toContain('Confirm event');
  expect(html).toContain('Cancel request');
  expect(html).toContain('Planning');
});

it('sends one revision-bound control without touching microphone or playback', async () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  let selected: string | null = null;
  const f = matrixFixture('granted', { bindings: {
    claimVoiceInput: vi.fn(() => 'calendar-lease-1'), writeVoiceDraft: vi.fn(() => true),
    releaseVoiceInput: vi.fn(), refreshSessions: vi.fn(),
    bindVoiceConversation: vi.fn((_token: string, id: string) => { selected = id; return true; }),
    getActiveConversationId: () => selected,
    openCanvasArtifact: vi.fn(),
  } });
  try {
    await f.begin();
    f.event({ type: 'conversation.bound', conversationId: 'calendar-chat-1' });
    const proposal = liveProposal();
    f.event({ type: 'calendar.frame', turnId: 'confirm-turn-1', attemptId: 'confirm-attempt-1',
      responseId: 'confirm-response-1', event: { type: 'calendar-view', view: proposal } });
    expect(f.controller.getSnapshot().calendarWorkspaces).toHaveLength(1);
    const control = vi.spyOn(f.client(), 'control');
    const micStops = f.rtc.mic.stop.mock.calls.length;
    const publishes = f.rtc.participant.publishTrack.mock.calls.length;
    expect(f.controller.confirmCalendar(proposal.proposalId, proposal.revision, { kind: 'accept' })).toBe(true);
    expect(f.controller.confirmCalendar(proposal.proposalId, proposal.revision, { kind: 'accept' })).toBe(false);
    expect(control).toHaveBeenCalledExactlyOnceWith({ type: 'calendar.confirm', proposalId: proposal.proposalId,
      proposalRevision: proposal.revision, answer: { kind: 'accept' } });
    expect(f.controller.getSnapshot().calendarWorkspaces[0]).toMatchObject({ pending: true, interactive: false });
    expect(f.controller.getSnapshot().phase).toBe('active');
    expect(f.rtc.mic.stop).toHaveBeenCalledTimes(micStops);
    expect(f.rtc.participant.publishTrack).toHaveBeenCalledTimes(publishes);
    expect(f.rtc.room.disconnect).not.toHaveBeenCalled();
    expect(f.http.end).not.toHaveBeenCalled();
    expect(f.http.create).toHaveBeenCalledTimes(1);
  } finally { f.controller.exit(); await settle(); }
});

it('keeps text results closed until an explicit inspect action and renders no outcome claim', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  const row = archived(agenda, 'text');
  const artifacts = collectSessionCanvasArtifacts([row], '', false);
  const state = { ...initialChatState, messages: [row] };
  expect(artifacts.length).toBeGreaterThan(0);
  expect(state.canvasOpen).toBe(false);
  expect(state.activeCanvasArtifactId).toBeNull();
  const html = panel(agenda);
  expect(html).not.toContain('Creating Calendar event');
  expect(html).not.toContain('The Calendar event was already created');
});

it('groups repeated wall-clock times by the display zone and keeps all-day ends exclusive', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  const dst: CalendarView = { viewVersion: 1, kind: 'agenda',
    target: { calendarId: 'personal@example.test', calendarLabel: 'Personal',
      labelExpiresAt: '2026-11-11T10:05:00.000Z' },
    requested: { timeMin: '2026-11-01T00:00:00Z', timeMax: '2026-11-02T00:00:00Z',
      displayTimeZone: 'America/New_York' },
    entries: [
      { eventId: 'evt_dst_a', summary: 'Before fallback', start: '2026-11-01T05:30:00Z',
        end: '2026-11-01T05:45:00Z', allDay: false, timeZone: 'America/New_York',
        status: 'confirmed', htmlLink: null },
      { eventId: 'evt_dst_b', summary: 'After fallback', start: '2026-11-01T06:30:00Z',
        end: '2026-11-01T06:45:00Z', allDay: false, timeZone: 'America/New_York',
        status: 'confirmed', htmlLink: null },
    ], nextPageToken: null, truncated: false, detailsTrimmed: false, entriesOmitted: 0,
    expiresAt: '2026-11-11T10:05:00.000Z' };
  const dstHtml = panel(dst);
  expect(dstHtml.match(/aria-label="Nov 1, 2026"/g)).toHaveLength(1);
  expect(dstHtml).toContain('EDT');
  expect(dstHtml).toContain('EST');
  const allDayHtml = panel(agenda);
  expect(allDayHtml).toContain('All day · Nov 3, 2026 – Nov 4, 2026');
  expect(allDayHtml).not.toContain('Nov 5, 2026');
});

it('labels truncated results and distinguishes failure from an empty successful agenda', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  const truncated: CalendarView = { ...agenda as Extract<CalendarView, { kind: 'agenda' }>,
    entries: [], nextPageToken: 'opaque-next', truncated: true };
  const truncatedHtml = panel(truncated);
  expect(truncatedHtml).toContain('More results are available');
  expect(truncatedHtml).not.toContain('No events in this range.');
  const failed: CalendarView = { viewVersion: 1, kind: 'notice', state: 'failed',
    message: 'The calendar could not be read.', proposalId: null, intentId: null,
    tool: 'calendar_list_events', coverage: 'incomplete', conflict: 'unknown',
    limitations: ['provider-error'] };
  const failedHtml = panel(failed);
  expect(failedHtml).toContain('The calendar could not be read.');
  expect(failedHtml).not.toContain('No events in this range.');
  expect(panel({ ...agenda as Extract<CalendarView, { kind: 'agenda' }>, entries: [] }))
    .toContain('No events in this range.');
});

it('drops expired labels and links while keeping agenda facts', () => {
  vi.useFakeTimers(); vi.setSystemTime('2026-11-11T10:00:00Z');
  const linked: CalendarView = { ...agenda as Extract<CalendarView, { kind: 'agenda' }>,
    entries: [{ eventId: 'evt_linked_1', summary: 'Offsite', start: '2026-11-03', end: '2026-11-05',
      allDay: true, timeZone: 'Etc/UTC', status: 'confirmed',
      htmlLink: 'https://calendar.google.com/calendar/event?eid=evt_linked_1' }] };
  const before = panel(linked);
  expect(before).toContain('Calendar: Personal');
  expect(before).toContain('Open in Google Calendar');
  vi.setSystemTime('2026-11-11T10:06:00Z');
  const after = panel(linked);
  expect(after).toContain('Offsite');
  expect(after).not.toContain('Calendar: Personal');
  expect(after).not.toContain('Open in Google Calendar');
});
