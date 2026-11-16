/**
 * ============================================================================
 * FILE: calendar-turn-region.test.ts
 * LOCATION: frontend/src/features/plugins/google-calendar/calendar-turn-region.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit and SSR tests for Calendar turn region, operation cards, target badges,
 *    and clarification proposal presentations.
 *
 * ROLE IN PROJECT:
 *    Verifies that durable calendar event target badges, safe links, retry actions,
 *    conservative failure copy, and clarification cards render truthfully without
 *    inventing target calendars or executing unapproved operations.
 *
 * KEY COMPONENTS:
 *    - CalendarTurnView: Rendered turn activity card view.
 *    - resolveReceiptCalendarLabel: Pure expiry-checked target label projection.
 *    - resolveSafeReceiptLink: Pure safe external event link helper.
 * ============================================================================
 */

import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarTurnState } from '../../../api/calendar-protocol.ts';
import { CanvasArtifactCard } from '../../canvas/CanvasArtifactCard.tsx';
import { calendarViewArtifact } from '../../canvas/calendar-workspace.ts';
import { CalendarProposalReviewCard } from '../../canvas/renderers/calendar-view-renderer.tsx';
import { agenda, NOW, proposal } from '../../canvas/testing/calendar-view-fixtures.ts';
import {
  CalendarTurnView,
  describeCalendarProgress,
  describeCalendarRetryAction,
  describeOperationState,
  resolveReceiptCalendarLabel,
  resolveSafeReceiptLink,
  parseCalendarConfirmationDetails,
  formatCalendarEventInterval,
  hideCalendarConfirmReplies,
} from './CalendarTurnRegion.tsx';
import {
  clarification,
  createdOperation,
} from './testing/multi-calendar-fixtures.ts';

function reviewAnswer(node: ReactNode, card: unknown): ((answer: unknown) => void) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = reviewAnswer(child, card);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode; onAnswer?: (answer: unknown) => void }>(node)) return null;
  if (node.type === card) return node.props.onAnswer ?? null;
  return reviewAnswer(node.props.children, card);
}

describe('CalendarTurnRegion presentation and SSR', () => {
  it('describes validating, repairing ("Correcting the Calendar request…"), executing, and reconciling without raw schema dumps', () => {
    expect(describeCalendarProgress('validating')).toBe('Validating Calendar request…');
    expect(describeCalendarProgress('repairing')).toBe('Correcting the Calendar request…');
    expect(describeCalendarProgress('executing')).toBe('Running Calendar action…');
    expect(describeCalendarProgress('reconciling')).toBe('Reconciling Calendar outcome…');

    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: 'repairing',
        operations: [],
        disabled: false,
        onRetryTurn: vi.fn(),
        onOpenCalendarSetup: vi.fn(),
        onFocusComposer: vi.fn(),
      }),
    );
    expect(html).toContain('Correcting the Calendar request…');
    expect(html).not.toContain('SCHEMA_VALIDATION_FAILED');
  });

  it('never renders a Created receipt from provisional text when no durable succeeded operation exists', () => {
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: 'executing',
        operations: [],
        disabled: false,
        onRetryTurn: vi.fn(),
        onOpenCalendarSetup: vi.fn(),
        onFocusComposer: vi.fn(),
      }),
    );
    expect(html).not.toContain('Calendar event created');
    expect(html).not.toContain('Open in Google Calendar');
  });

  it('renders durable created-event receipt independently of a failed or interrupted final narration', () => {
    const operation: CalendarTurnState = {
      operationId: 'op_created_1',
      state: 'succeeded',
      narration: 'failed',
      retryAction: 'none',
      receipt: {
        durable: true,
        eventId: 'gcal_evt_12345',
        htmlLink: 'https://www.google.com/calendar/event?eid=gcal123',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    };
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [{ turnId: 'turn_1', operation }],
        disabled: false,
        onRetryTurn: vi.fn(),
        onOpenCalendarSetup: vi.fn(),
        onFocusComposer: vi.fn(),
      }),
    );
    expect(html).toContain('Calendar event created');
    expect(html).toContain('gcal_evt_12345');
    expect(html).toContain('href="https://www.google.com/calendar/event?eid=gcal123"');
    expect(html).toContain('Open in Google Calendar');
    expect(html).toContain(
      'The Calendar event was created and saved, but the final assistant response failed.',
    );
    expect(html).toContain('Retry assistant response (reuses saved event)');
  });

  it('withholds expired or unsafe receipt links while keeping the verified event ID', () => {
    expect(
      resolveSafeReceiptLink(
        {
          durable: true,
          eventId: 'evt_12345',
          htmlLink: 'https://www.google.com/calendar/event?eid=1',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
        Date.parse('2026-10-21T00:00:00.000Z'),
      ),
    ).toBeNull();

    expect(
      resolveSafeReceiptLink(
        {
          durable: true,
          eventId: 'evt_12345',
          htmlLink: 'javascript:alert(1)',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        Date.parse('2026-10-21T00:00:00.000Z'),
      ),
    ).toBeNull();
  });

  it('explains whether retry resumes reconciliation, requires reconnection, requires clarification, or is blocked by expiry', () => {
    expect(describeCalendarRetryAction('resume-reconciliation').explanation).toContain(
      'same event ID without creating a duplicate event',
    );
    expect(describeCalendarRetryAction('reconnect').explanation).toContain(
      'reconnection is required',
    );
    expect(describeCalendarRetryAction('clarify').explanation).toContain(
      'More details are needed',
    );
    expect(describeCalendarRetryAction('blocked-expired').explanation).toContain(
      'deduplication evidence expired',
    );

    const unknownOp: CalendarTurnState = {
      operationId: 'op_unk',
      state: 'unknown',
      narration: 'failed',
      retryAction: 'resume-reconciliation',
      receipt: null,
    };
    const reconnectOp: CalendarTurnState = {
      operationId: 'op_rec',
      state: 'definitely-failed',
      narration: 'failed',
      retryAction: 'reconnect',
      receipt: null,
    };
    const clarifyOp: CalendarTurnState = {
      operationId: 'op_clar',
      state: 'definitely-failed',
      narration: 'completed',
      retryAction: 'clarify',
      receipt: null,
    };

    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [
          { turnId: 'turn_u', operation: unknownOp },
          { turnId: 'turn_r', operation: reconnectOp },
          { turnId: 'turn_c', operation: clarifyOp },
        ],
        disabled: false,
        onRetryTurn: vi.fn(),
        onOpenCalendarSetup: vi.fn(),
        onFocusComposer: vi.fn(),
      }),
    );

    expect(html).toContain('Calendar outcome is uncertain and requires reconciliation.');
    expect(html).toContain('Resume &amp; reconcile operation');
    expect(html).toContain('Reconnect Google Calendar');
    expect(html).toContain('Clarify in composer');
  });

  it('shows only durable receipt target metadata and hides it at content expiry', () => {
    const operation = createdOperation();
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [{ turnId: 'turn-1', operation }],
        disabled: false,
        nowMs: Date.parse('2026-10-24T10:01:00Z'),
        onRetryTurn: vi.fn(),
      }),
    );
    expect(html).toContain('Calendar: Original Team');
    expect(html).toContain('Calendar event created');
    expect(html).toContain('final assistant response failed');
    expect(
      resolveReceiptCalendarLabel(
        operation.receipt,
        Date.parse('2026-10-24T10:05:00Z'),
      ),
    ).toBeNull();
  });

  it('presents conflict and incomplete coverage as reply-needed, never a created receipt', () => {
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [],
        disabled: false,
        nowMs: Date.parse('2026-10-24T10:01:00Z'),
        onRetryTurn: vi.fn(),
        onFocusComposer: vi.fn(),
        clarification: {
          turnId: 'turn-1',
          event: clarification({
            reason: 'coverage',
            message: 'Availability could not be checked on all calendars.',
          }),
        },
      }),
    );
    expect(html).toContain('Availability coverage is incomplete');
    expect(html).toContain('Reply in composer');
    expect(html).not.toContain('Calendar event created');
    expect(html).not.toContain('All clear');
  });

  it('keeps Reply in composer enabled while a clarification is shown during an open stream', () => {
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [],
        disabled: true,
        replyDisabled: false,
        nowMs: Date.parse('2026-10-24T10:01:00Z'),
        onRetryTurn: vi.fn(),
        onFocusComposer: vi.fn(),
        clarification: {
          turnId: 'turn-1',
          event: clarification({
            reason: 'conflict',
            message: 'Conference Room has an existing booking at that hour.',
          }),
        },
      }),
    );
    expect(html).toContain('Reply in composer');
    expect(html).not.toMatch(/disabled=""[^>]*>Reply in composer/);
  });

  it('offers Confirm and Cancel that submit the exact confirmation replies', () => {
    const onConfirmReply = vi.fn();
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [],
        disabled: false,
        nowMs: Date.parse('2026-10-24T10:01:00Z'),
        onRetryTurn: vi.fn(),
        onConfirmReply,
        clarification: {
          turnId: 'turn-1',
          event: clarification({
            reason: 'details',
            message: 'Please confirm: create "Ball"? Reply "create the event" or "yes" to confirm, or "cancel".',
          }),
        },
      }),
    );
    expect(html).toContain('Confirm this event');
    expect(html).toContain('>Confirm<');
    expect(html).toContain('>Cancel<');
    expect(html).not.toContain('Reply in composer');
    expect(html).not.toContain('Calendar event created');
  });

  it('keeps Confirm enabled during an open stream and omits it for calendar choice', () => {
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [],
        disabled: true,
        replyDisabled: false,
        nowMs: Date.parse('2026-10-24T10:01:00Z'),
        onRetryTurn: vi.fn(),
        onConfirmReply: vi.fn(),
        clarification: {
          turnId: 'turn-1',
          event: clarification({
            reason: 'target',
            message: 'Which calendar should I use?',
            candidates: [{ calendarId: 'work@example.test', label: 'Work', role: 'writer' }],
          }),
        },
      }),
    );
    expect(html).toContain('>Work<');
    expect(html).toContain('>Cancel<');
    expect(html).not.toContain('>Confirm<');
    expect(html).not.toMatch(/disabled=""[^>]*>Cancel</);
  });

  it('presents expired clarification proposal truthfully and hides candidates and message', () => {
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [],
        disabled: false,
        nowMs: Date.parse('2026-10-24T10:15:00Z'),
        onRetryTurn: vi.fn(),
        onFocusComposer: vi.fn(),
        clarification: {
          turnId: 'turn-1',
          event: clarification({
            expiresAt: '2026-10-24T10:10:00Z',
            reason: 'conflict',
            message: 'Overlap detected.',
            candidates: [{ calendarId: 'c1', label: 'Work', role: 'writer' }],
          }),
        },
      }),
    );
    expect(html).toContain(
      'This Calendar request expired. Ask again or provide updated details in the composer.',
    );
    expect(html).not.toContain('Overlap detected.');
    expect(html).not.toContain('Work');
  });

  it('describes failed and cancelled operation states with conservative non-created copy', () => {
    expect(describeOperationState('failed')).toBe(
      'Calendar action failed; no successful creation is confirmed.',
    );
    expect(describeOperationState('cancelled')).toBe(
      'Calendar action was cancelled; check any previously reported uncertain outcome before sending a new request.',
    );
  });

  it('renders legacy or redacted receipt without inventing target label', () => {
    const legacyOp: CalendarTurnState = {
      operationId: 'op_leg',
      state: 'succeeded',
      narration: 'completed',
      retryAction: 'none',
      receipt: {
        durable: true,
        eventId: 'evt_legacy',
        htmlLink: null,
        expiresAt: '2026-10-24T10:30:00Z',
      },
    };
    const html = renderToStaticMarkup(
      createElement(CalendarTurnView, {
        progress: null,
        operations: [{ turnId: 'turn-leg', operation: legacyOp }],
        disabled: false,
        nowMs: Date.parse('2026-10-24T10:00:00Z'),
        onRetryTurn: vi.fn(),
      }),
    );
    expect(html).toContain('Calendar label unavailable or expired');
    expect(html).not.toContain('Calendar:');
  });
  it('parses confirmation details and formats event intervals accurately', () => {
    const raw =
      'Please confirm: create "Meeting with Arun and the leaders" on peter.j@ecgroup-intl.com from 2026-11-03T18:00:00+05:30 to 2026-11-03T19:00:00+05:30 (Asia/Kolkata)? Description: "Participants: Arun and the leaders. Note: invitations were not sent through Aurvin; attendees need to be added manually if required.". Reply yes to confirm, or cancel.';
    const parsed = parseCalendarConfirmationDetails(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.summary).toBe('Meeting with Arun and the leaders');
    expect(parsed?.calendar).toBe('peter.j@ecgroup-intl.com');
    expect(parsed?.timeZone).toBe('Asia/Kolkata');
    expect(parsed?.attendees).toBe('Arun and the leaders');

    const formatted = formatCalendarEventInterval(
      '2026-11-03T18:00:00+05:30',
      '2026-11-03T19:00:00+05:30',
      'Asia/Kolkata',
    );
    expect(formatted).toBe('Tue, Nov 3 • 6:00 – 7:00pm');
  });

  it('does not parse "create the event anyway" as a title of "the"', () => {
    const coverage =
      'I can schedule "Meeting with Arun and the leaders" on peter.j@ecgroup-intl.com from 2026-11-03T18:00:00+05:30 to 2026-11-03T19:00:00+05:30 (Asia/Kolkata). I could not confirm that the time is free. Should I create the event anyway, or would you like a different time?';
    const parsed = parseCalendarConfirmationDetails(coverage);
    expect(parsed?.summary).toBe('Meeting with Arun and the leaders');
    expect(parseCalendarConfirmationDetails('Should I create the event anyway?')).toBeNull();
  });

  it('hides Confirm/Cancel chat replies that follow a calendar confirmation prompt', () => {
    const visible = hideCalendarConfirmReplies([
      { role: 'user', content: 'create the meeting' },
      {
        role: 'assistant',
        content: 'Please confirm: create "Standup"? Reply yes to confirm, or cancel.',
      },
      { role: 'user', content: 'yes' },
      { role: 'assistant', content: 'Created "Standup" from 10:00 to 11:00 (Etc/UTC).' },
      { role: 'user', content: 'yes' },
    ]);
    expect(visible.map((item) => item.content)).toEqual([
      'create the meeting',
      'Please confirm: create "Standup"? Reply yes to confirm, or cancel.',
      'Created "Standup" from 10:00 to 11:00 (Etc/UTC).',
      'yes',
    ]);
  });

  it('keeps lookup facts inline and opens Calendar only from an explicit Canvas click',()=>{
    const result=calendarViewArtifact(agenda(),'assistant-1','turn-1');const open=vi.fn();
    const props={progress:null,operations:[],disabled:false,onRetryTurn:vi.fn(),results:[result],onOpenCanvas:open,nowMs:NOW};
    const html=renderToStaticMarkup(createElement(CalendarTurnView,props));
    expect(html).toContain('Design sync');expect(html).toContain('View agenda in Canvas');
    expect(open).not.toHaveBeenCalled();
    const tree=CalendarTurnView(props);
    function findCard(node:unknown):{artifact:typeof result;onOpen:(id:string)=>void}|null {
      if (Array.isArray(node)) {for (const n of node) {const found=findCard(n);if (found) return found;}return null;}
      if (!isValidElement<{children?:unknown;artifact:typeof result;onOpen:(id:string)=>void}>(node)) return null;
      return node.type === CanvasArtifactCard ? node.props : findCard(node.props.children);
    }
    const card=findCard(tree)!;card.onOpen(card.artifact.artifactId);
    expect(open).toHaveBeenCalledExactlyOnceWith(result.artifactId);
  });

  it('maps structured proposal answers to hidden replies and blocks expired or historical controls',()=>{
    const onConfirmReply=vi.fn();
    const base={progress:null,operations:[],disabled:false,onRetryTurn:vi.fn(),onConfirmReply,nowMs:NOW};
    const live={turnId:'turn-1',event:{...clarification({expiresAt:'2026-11-11T12:05:00Z'}),view:proposal()}};
    const html=renderToStaticMarkup(createElement(CalendarTurnView,{...base,clarification:live}));
    expect(html).toContain('Design sync');expect(html).toContain('Awaiting your confirmation.');
    expect(html).toContain('Confirm event');expect(html).toContain('Cancel request');
    const answer=reviewAnswer(CalendarTurnView({...base,clarification:live}),CalendarProposalReviewCard)!;
    answer({kind:'accept'});expect(onConfirmReply).toHaveBeenLastCalledWith('yes');
    answer({kind:'reject'});expect(onConfirmReply).toHaveBeenLastCalledWith('cancel');
    const target={turnId:'turn-1',event:{...clarification({expiresAt:'2026-11-11T12:05:00Z',reason:'target'}),
      view:{...proposal(),reason:'target' as const,target:null,
        candidates:[{calendarId:'team@example.com',label:'Team calendar',role:'writer' as const}]}}};
    const choose=reviewAnswer(CalendarTurnView({...base,clarification:target}),CalendarProposalReviewCard)!;
    choose({kind:'select',calendarId:'team@example.com'});
    expect(onConfirmReply).toHaveBeenLastCalledWith('team@example.com');
    expect(renderToStaticMarkup(createElement(CalendarTurnView,{...base,nowMs:NOW+600_000,clarification:live})))
      .not.toContain('<button');
    onConfirmReply.mockClear();
    const historical=CalendarTurnView({...base,onOpenCanvas:vi.fn(),
      results:[calendarViewArtifact(proposal(),'assistant-1','turn-1')]});
    expect(reviewAnswer(historical,CalendarProposalReviewCard)).toBeNull();
    expect(onConfirmReply).not.toHaveBeenCalled();
  });
});
