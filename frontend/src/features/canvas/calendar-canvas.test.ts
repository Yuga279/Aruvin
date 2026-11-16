/**
 * ============================================================================
 * FILE: calendar-canvas.test.ts
 * LOCATION: frontend/src/features/canvas/calendar-canvas.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Tests for Aurvin's Calendar-in-Canvas integration (Approach 1).
 *
 * ROLE IN PROJECT:
 *    Verifies calendar codeblock extraction, durable receipt projection,
 *    safe Google Calendar themed card rendering (including disarming unsafe links),
 *    and automatic canvas activation on event creation.
 *
 * KEY COMPONENTS:
 *    - parseCanvasCodeBlock: ```calendar, ```event, and ```canvas type="calendar" tests.
 *    - collectSessionCanvasArtifacts: Durable receipt projection into Canvas artifacts.
 *    - CalendarEventRenderer: Rich themed card & safe link verification.
 *    - toArtifactPath: .event.json path resolution.
 *    - Auto-open Canvas transition tests.
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CalendarTurnState } from '../../api/calendar-protocol.ts';
import { isCalendarView } from '../../api/calendar-protocol.ts';
import type { VisibleMessage } from '../../api/protocol.ts';
import { chatReducer, initialChatState } from '../chat/state/chat-reducer.ts';
import { agenda, calendarMessage, outcome } from './testing/calendar-view-fixtures.ts';
import {
  buttonLabelForCanvasArtifact,
  collectSessionCanvasArtifacts,
  mergeSessionCanvasArtifacts,
  parseCalendarSource,
  parseCanvasCodeBlock,
  resolveSafeCalendarLink,
} from './canvas-artifacts.ts';
import { calendarViewArtifact, foldCalendarFrame, mergeCalendarWorkspaces } from './calendar-workspace.ts';
import { ArtifactKindIcon } from './CanvasArtifactCard.tsx';
import { CanvasPanel, toArtifactPath } from './CanvasPanel.tsx';
import { CalendarEventRenderer } from './renderers/calendar-event-renderer.tsx';

describe("Aurvin's Calendar-in-Canvas Integration (Approach 1)", () => {
  describe('Calendar Code Block and Artifact Parsing', () => {
    it('parses ```calendar blocks into kind="calendar" CanvasArtifact', () => {
      const code = JSON.stringify({
        summary: 'Team Standup',
        start: '2026-11-04T10:00:00-08:00',
        end: '2026-11-04T10:30:00-08:00',
        calendarLabel: 'Work Calendar',
        htmlLink: 'https://calendar.google.com/calendar/event?eid=evt_123',
      });

      const artifact = parseCanvasCodeBlock('calendar', code, 'msg_cal_1', 0);
      expect(artifact).not.toBeNull();
      expect(artifact?.kind).toBe('calendar');
      expect(artifact?.title).toBe('Team Standup');
      expect(artifact?.subType).toBe('Work Calendar');
      expect(artifact?.buttonLabel).toBe('View calendar event');
      expect(artifact?.artifactId).toBe('msg_cal_1::canvas::0');
    });

    it('parses ```event blocks and explicit canvas type="calendar"', () => {
      const code = JSON.stringify({
        summary: 'Dentist Appointment',
        start: '2026-11-05T14:00:00Z',
        end: '2026-11-05T15:00:00Z',
      });

      const eventArtifact = parseCanvasCodeBlock('event', code, 'msg_cal_2', 0);
      expect(eventArtifact?.kind).toBe('calendar');
      expect(eventArtifact?.title).toBe('Dentist Appointment');

      const canvasTypeArtifact = parseCanvasCodeBlock(
        'canvas type="calendar"',
        code,
        'msg_cal_3',
        0,
      );
      expect(canvasTypeArtifact?.kind).toBe('calendar');
      expect(canvasTypeArtifact?.title).toBe('Dentist Appointment');
    });

    it('parses calendar structures from ```json blocks', () => {
      const jsonEvent = JSON.stringify({
        summary: 'Sprint Review',
        start: '2026-11-06T15:00:00Z',
        htmlLink: 'https://calendar.google.com/calendar/event?eid=evt_456',
        eventId: 'evt_456',
      });

      const artifact = parseCanvasCodeBlock('json', jsonEvent, 'msg_json_1', 0);
      expect(artifact?.kind).toBe('calendar');
      expect(artifact?.title).toBe('Sprint Review');
    });

    it('resolves button label and export path for calendar artifacts', () => {
      expect(buttonLabelForCanvasArtifact('calendar', 'Google Calendar Event')).toBe(
        'View calendar event',
      );

      const path = toArtifactPath({
        artifactId: 'art_1',
        messageId: 'msg_1',
        index: 0,
        kind: 'calendar',
        subType: 'Google Calendar Event',
        title: 'Project Kickoff Meeting',
        buttonLabel: 'View calendar event',
        rawSource: '{}',
        isStreaming: false,
      });
      expect(path).toBe('canvas/project-kickoff-meeting.event.json');
    });

    it('renders a distinct calendar icon for ArtifactKindIcon with kind="calendar"', () => {
      const html = renderToStaticMarkup(
        createElement(ArtifactKindIcon, { kind: 'calendar', size: 20 }),
      );
      expect(html).toContain('<svg');
      expect(html).toContain('x1="16" y1="2" x2="16" y2="6"');
      expect(html).toContain('x1="8" y1="2" x2="8" y2="6"');
    });
  });

  describe('Durable Receipt Projection from calendarOperationsByTurn', () => {
    const succeededOp: CalendarTurnState = {
      schemaVersion: 2,
      operationId: 'op_cal_999',
      state: 'succeeded',
      narration: 'completed',
      retryAction: 'none',
      receipt: {
        durable: true,
        eventId: 'evt_google_123',
        htmlLink: 'https://calendar.google.com/calendar/event?eid=evt_google_123',
        expiresAt: '2026-11-05T00:00:00Z',
        calendarLabel: 'Personal Calendar',
      },
    };

    it('projects a completed API receipt without a model response or live voice projection', () => {
      const artifacts = mergeSessionCanvasArtifacts([], [], { turn_confirm: succeededOp });
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        artifactId: 'turn_confirm::canvas::calendar', kind: 'calendar', isStreaming: false,
      });
      expect(JSON.parse(artifacts[0].rawSource)).toMatchObject({
        eventId: succeededOp.receipt!.eventId, status: 'confirmed',
      });
      const opened = chatReducer(initialChatState, {
        type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId: artifacts[0].artifactId },
      });
      expect(opened.canvasOpen).toBe(true);
      expect(opened.activeCanvasArtifactId).toBe('turn_confirm::canvas::calendar');
      for (const state of ['dispatching', 'definitely-failed', 'unknown'] as const) {
        expect(mergeSessionCanvasArtifacts([], [], {
          turn_confirm: { ...succeededOp, state, receipt: null },
        })).toEqual([]);
      }
    });

    const userMessage: VisibleMessage = {
      messageId: 'msg_user_1',
      turnId: 'turn_cal_1',
      eventId: 'evt_u1',
      sequence: 1,
      role: 'user',
      content: 'Create an event titled "Sprint Demo" tomorrow at 10am',
      createdAt: '2026-11-04T09:00:00Z',
      completionStatus: 'completed',
      truncated: false,
    };

    const assistantMessage: VisibleMessage = {
      messageId: 'msg_asst_1',
      turnId: 'turn_cal_1',
      eventId: 'evt_a1',
      sequence: 2,
      role: 'assistant',
      content: "I've scheduled \"Sprint Demo\" on your Google Calendar.",
      createdAt: '2026-11-04T09:00:05Z',
      completionStatus: 'completed',
      truncated: false,
    };

    it('projects durable calendar receipts into session Canvas artifacts', () => {
      const artifacts = collectSessionCanvasArtifacts(
        [userMessage, assistantMessage],
        '',
        false,
        { turn_cal_1: succeededOp },
      );

      expect(artifacts).toHaveLength(1);
      const calArtifact = artifacts[0]!;
      expect(calArtifact.kind).toBe('calendar');
      expect(calArtifact.title).toBe('Sprint Demo');
      expect(calArtifact.subType).toBe('Personal Calendar');
      expect(calArtifact.buttonLabel).toBe('View calendar event');
      expect(calArtifact.artifactId).toBe('turn_cal_1::canvas::calendar');

      const parsed = JSON.parse(calArtifact.rawSource);
      expect(parsed.eventId).toBe('evt_google_123');
      expect(parsed.htmlLink).toBe(
        'https://calendar.google.com/calendar/event?eid=evt_google_123',
      );
      expect(parsed.status).toBe('confirmed');
    });

    it('fills canvas event times from a Created receipt message', () => {
      const createdAssistant: VisibleMessage = {
        ...assistantMessage,
        content:
          'Created "Sprint Demo" from 2026-11-04T10:00:00-08:00 to 2026-11-04T11:00:00-08:00 (America/Los_Angeles).',
      };
      const artifacts = collectSessionCanvasArtifacts(
        [userMessage, createdAssistant],
        '',
        false,
        { turn_cal_1: succeededOp },
      );
      expect(artifacts).toHaveLength(1);
      const parsed = JSON.parse(artifacts[0]!.rawSource);
      expect(parsed.summary).toBe('Sprint Demo');
      expect(parsed.start).toBe('2026-11-04T10:00:00-08:00');
      expect(parsed.end).toBe('2026-11-04T11:00:00-08:00');
      expect(parsed.timeZone).toBe('America/Los_Angeles');
      expect(parsed.status).toBe('confirmed');
    });

    it('does not project non-succeeded or non-durable operations', () => {
      const failedOp: CalendarTurnState = {
        schemaVersion: 2,
        operationId: 'op_cal_fail',
        state: 'failed',
        narration: 'failed',
        retryAction: 'clarify',
        receipt: null,
      };

      const artifacts = collectSessionCanvasArtifacts(
        [userMessage, assistantMessage],
        '',
        false,
        { turn_cal_1: failedOp },
      );
      expect(artifacts).toHaveLength(0);
    });

    it('merges session artifacts idempotently without duplicating turns', () => {
      const first = collectSessionCanvasArtifacts(
        [userMessage, assistantMessage],
        '',
        false,
        { turn_cal_1: succeededOp },
      );
      const merged = mergeSessionCanvasArtifacts(first, [], { turn_cal_1: succeededOp });
      expect(merged).toHaveLength(1);
    });
  });

  describe('CalendarEventRenderer Safe Rendering', () => {
    it('renders rich Google Calendar-themed event card with date sheet, badge, preview, and 1-click CTA', () => {
      const source = JSON.stringify({
        summary: 'Architecture Review',
        start: '2026-11-04T10:00:00-08:00',
        end: '2026-11-04T11:00:00-08:00',
        timeZone: 'America/Los_Angeles',
        calendarLabel: 'Engineering',
        location: 'Room 402 & Google Meet',
        description: 'Reviewing Canvas multimodal architecture and event links.',
        eventId: 'evt_arch_456',
        htmlLink: 'https://calendar.google.com/calendar/event?eid=evt_arch_456',
        status: 'confirmed',
      });

      const html = renderToStaticMarkup(
        createElement(CalendarEventRenderer, { source, title: 'Architecture Review' }),
      );

      // Card wrapper & accent strip
      expect(html).toContain('class="aurvin-calendar-canvas-card"');
      expect(html).toContain('class="aurvin-calendar-accent-strip"');

      // Date sheet tear-off icon with uppercase month header and day number
      expect(html).toContain('class="aurvin-calendar-tearoff-sheet"');
      expect(html).toContain('class="aurvin-calendar-sheet-header">NOV<');
      expect(html).toContain('class="aurvin-calendar-sheet-body">4<');

      // Title & Confirmed badge
      expect(html).toContain('Architecture Review');
      expect(html).toContain('Confirmed on Google Calendar');

      // Formatted date & time with duration
      expect(html).toContain('1 hr');
      expect(html).toContain('Nov 4');

      // Target pill & timezone
      expect(html).toContain('Engineering');
      expect(html).toContain('America/Los_Angeles');

      // Location & Description
      expect(html).toContain('Room 402 &amp; Google Meet');
      expect(html).toContain('Reviewing Canvas multimodal architecture');

      // Day Schedule Context Preview
      expect(html).toContain('Day Schedule Context');
      expect(html).toContain('aurvin-calendar-grid-pill');

      // 1-Click CTA Button with exact target="_blank" rel="noopener noreferrer"
      expect(html).toContain('class="aurvin-calendar-canvas-btn"');
      expect(html).toContain('href="https://calendar.google.com/calendar/event?eid=evt_arch_456"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain('Open in Google Calendar ↗');
    });

    it('disarms unsafe javascript: links and non-Google hosts into a disabled button', () => {
      // Malicious link attempting XSS
      const unsafeSource = JSON.stringify({
        summary: 'Malicious Event',
        htmlLink: 'javascript:alert(document.cookie)',
        status: 'confirmed',
      });

      const html = renderToStaticMarkup(
        createElement(CalendarEventRenderer, { source: unsafeSource }),
      );

      expect(html).not.toContain('href="javascript:');
      expect(html).not.toContain('alert');
      expect(html).toContain('disabled=""');
      expect(html).toContain('aurvin-calendar-canvas-btn-disabled');

      // Non-Google domain attempt
      expect(resolveSafeCalendarLink('https://evil-site.com/calendar/event')).toBeNull();
      expect(resolveSafeCalendarLink('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(
        resolveSafeCalendarLink('https://calendar.google.com/calendar/event?eid=abc'),
      ).toBe('https://calendar.google.com/calendar/event?eid=abc');
    });
  });

  describe('Manual Calendar Canvas opening', () => {
    it('never opens text Calendar from progress, operation, view or completed snapshot actions',()=>{
      const active={...initialChatState,activeSessionId:'s',activeTurnId:'t',activeAttemptId:'a',isStreaming:true};
      const payload={sessionId:'s',turnId:'t',attemptId:'a',sequence:1};
      let state=chatReducer(active,{type:'CALENDAR_PROGRESS',payload:{...payload,phase:'executing'}});
      state=chatReducer(state,{type:'CALENDAR_VIEW',payload:{...payload,sequence:2,view:agenda()}});
      const o=outcome();
      state=chatReducer(state,{type:'CALENDAR_OPERATION',payload:{...payload,sequence:3,operation:{schemaVersion:2,
        operationId:o.operationId,proposalId:o.proposalId,intentId:o.intentId,state:o.state,narration:'completed',retryAction:o.retryAction,receipt:o.receipt}}});
      state=chatReducer(state,{type:'STREAM_COMPLETED',payload:{assistantMessageId:'m',outcome:'completed',calendarView:o}});
      expect(state.canvasOpen).toBe(false);
    });
    it('dispatches OPEN_CANVAS_ARTIFACT to open canvas with active artifact', () => {
      const state = chatReducer(initialChatState, {
        type: 'OPEN_CANVAS_ARTIFACT',
        payload: { artifactId: 'turn_cal_1::canvas::calendar' },
      });

      expect(state.canvasOpen).toBe(true);
      expect(state.activeCanvasArtifactId).toBe('turn_cal_1::canvas::calendar');
      expect(state.closedCanvasArtifactIds).not.toContain(
        'turn_cal_1::canvas::calendar',
      );
    });

    it('parses fallback key-value text in parseCalendarSource', () => {
      const textSource = [
        'Title: Sync Discussion',
        'Start: 2026-11-04T16:00:00Z',
        'End: 2026-11-04T17:00:00Z',
        'Target: Work',
        'Link: https://calendar.google.com/calendar/event?eid=sync_99',
      ].join('\n');

      const parsed = parseCalendarSource(textSource);
      expect(parsed?.summary).toBe('Sync Discussion');
      expect(parsed?.calendarLabel).toBe('Work');
      expect(parsed?.htmlLink).toBe(
        'https://calendar.google.com/calendar/event?eid=sync_99',
      );
    });

    it('renders CanvasPanel with active calendar artifact', () => {
      const artifact = {
        artifactId: 'turn_1::canvas::calendar',
        messageId: 'turn_1',
        index: 0,
        kind: 'calendar' as const,
        subType: 'Work',
        title: 'Sprint Planning',
        buttonLabel: 'View calendar event',
        rawSource: JSON.stringify({
          summary: 'Sprint Planning',
          start: '2026-11-04T10:00:00Z',
          end: '2026-11-04T11:00:00Z',
          calendarLabel: 'Work',
          htmlLink: 'https://calendar.google.com/calendar/event?eid=plan_123',
          status: 'confirmed',
        }),
        isStreaming: false,
      };

      const html = renderToStaticMarkup(
        createElement(CanvasPanel, {
          artifacts: [artifact],
          activeArtifactId: artifact.artifactId,
          onSelectArtifact: () => {},
          onCloseTab: () => {},
          onClosePanel: () => {},
        }),
      );

      expect(html).toContain('id="aurvin-canvas-panel"');
      expect(html).toContain('Sprint Planning');
      expect(html).toContain('class="aurvin-calendar-canvas-card"');
      expect(html).toContain('Open in Google Calendar ↗');
      expect(html).toContain('canvas/sprint-planning.event.json');
    });
  });

  describe('Typed Calendar hydration and deduplication', () => {
    it('hydrates an empty-content assistant snapshot without applying legacy source limits',()=>{
      const message=calendarMessage(agenda(),'live');
      const items=collectSessionCanvasArtifacts([message],'',false);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({artifactId:'assistant-1::canvas::calendar',turnId:'turn-1',
        kind:'calendar',calendarView:agenda(),isStreaming:false});
      expect(items[0].rawSource).toBe('');
      expect(collectSessionCanvasArtifacts([{...message,role:'user'}],'',false)).toEqual([]);
    });
    it('keeps one tab and its aliases when live and persisted views refer to the same request',()=>{
      const frames=foldCalendarFrame([], {type:'calendar.frame',turnId:'turn-1',attemptId:'a',responseId:'r',
        event:{type:'calendar-view',view:agenda()}});
      const archived=collectSessionCanvasArtifacts([calendarMessage()],'',false);
      const live=mergeCalendarWorkspaces(archived,frames,true);
      expect(live).toHaveLength(1);
      expect(live[0].artifactId).toBe('calendar:turn-1::canvas::calendar');
      expect(live[0].calendarAliases).toContain('assistant-1::canvas::calendar');
      const settled=mergeCalendarWorkspaces(archived,frames,false);
      expect(settled).toHaveLength(1);
      expect(settled[0].calendarWorkspace).toBeUndefined();
      expect(settled[0].calendarAliases).toContain(live[0].artifactId);
      expect(mergeCalendarWorkspaces([],frames,false)).toEqual([]);
    });
    it('keeps a valid view larger than legacy raw source and invalidates changed snapshot cache entries',()=>{
      const view=agenda();view.entries=Array.from({length:6},(_,index)=>({...view.entries[0],eventId:`event-${index}`,description:'x'.repeat(1600)}));
      expect(JSON.stringify(view).length).toBeGreaterThan(8192);expect(isCalendarView(view)).toBe(true);
      const message=calendarMessage(view);
      expect(collectSessionCanvasArtifacts([message],'',false)[0].calendarView).toEqual(view);
      message.calendarView={...agenda(),entries:[{...agenda().entries[0],summary:'Changed snapshot'}]};
      const changed=collectSessionCanvasArtifacts([message],'',false)[0].calendarView;
      expect(changed?.kind === 'agenda' && changed.entries[0].summary).toBe('Changed snapshot');
    });
  });

  describe('Calendar Canvas mode (scroll, not pan/zoom)', () => {
    it('renders Calendar without diagram controls and retains diagram zoom unchanged',()=>{
      const artifact=calendarViewArtifact(agenda(),'m','t');
      const props={activeArtifactId:artifact.artifactId,onSelectArtifact:()=>{},onCloseTab:()=>{},onClosePanel:()=>{}};
      const html=renderToStaticMarkup(createElement(CanvasPanel,{...props,artifacts:[artifact]}));
      expect(html).toContain('aurvin-canvas-calendar-body');expect(html).toContain('Design sync');
      expect(html).not.toContain('aria-label="Zoom controls"');expect(html).not.toContain('Canvas view mode');
      expect(html).not.toContain('aurvin-canvas-stage');expect(html).not.toContain('scale(');
      const diagram=parseCanvasCodeBlock('mermaid','flowchart LR\n A-->B','m-diagram',0)!;
      const original=renderToStaticMarkup(createElement(CanvasPanel,{...props,artifacts:[diagram],activeArtifactId:diagram.artifactId}));
      expect(original).toContain('aria-label="Zoom controls"');expect(original).toContain('aurvin-canvas-stage');
    });
    it('selects a Calendar artifact through a hydrated alias id',()=>{
      const artifact={...calendarViewArtifact(agenda(),'m','t'),calendarAliases:['calendar:turn-1::canvas::calendar']};
      const html=renderToStaticMarkup(createElement(CanvasPanel,{artifacts:[artifact],
        activeArtifactId:'calendar:turn-1::canvas::calendar',onSelectArtifact:()=>{},onCloseTab:()=>{},onClosePanel:()=>{}}));
      expect(html).toContain('data-active-artifact-id="m::canvas::calendar"');
      expect(html).toContain('Design sync');
    });
  });
});
