/**
 * ============================================================================
 * FILE: calendar-view-renderer.test.ts
 * LOCATION: frontend/src/features/canvas/renderers/calendar-view-renderer.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verifies structured Calendar proposal, outcome, notice and boundary rendering.
 *
 * ROLE IN PROJECT:
 *    Pins exact-action confirmation copy, read-only history, truthful failure copy,
 *    receipt expiry behavior, canonical candidate IDs, and contained render recovery.
 *
 * KEY COMPONENTS:
 *    - CalendarProposalReviewCard: history/live/expired control assertions.
 *    - CalendarViewRenderer: state labels, receipt/expiry, and notice wording.
 *    - CalendarViewBoundary: pure derived-state reset check.
 * ============================================================================
 */

import {createElement,isValidElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {CalendarProposalReviewCard,CalendarViewBoundary,CalendarViewRenderer} from './calendar-view-renderer.tsx';
import {agenda,proposal,outcome,notice,NOW} from '../testing/calendar-view-fixtures.ts';

function buttons(node:ReactNode):Array<{children?:ReactNode;onClick?:()=>void;disabled?:boolean}> {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{children?:ReactNode;onClick?:()=>void;disabled?:boolean}>(node)) return [];
  return [...(node.type === 'button' ? [node.props] : []),...buttons(node.props.children)];
}
it('makes history read-only and only current live proposals expose exact-action controls',()=>{
  const view=proposal();
  const history=renderToStaticMarkup(createElement(CalendarProposalReviewCard,{view,nowMs:NOW}));
  expect(history).toContain('Historical snapshot');expect(history).not.toContain('>Confirm event<');
  const live=renderToStaticMarkup(createElement(CalendarProposalReviewCard,{view,nowMs:NOW,
    interactive:true,disabled:false,onAnswer:vi.fn()}));
  expect(live).toContain('Design sync');expect(live).toContain('team@example.com');
  expect(live).toContain('Europe/London');expect(live).toContain('Confirm event');expect(live).toContain('Cancel request');
  const expired=renderToStaticMarkup(createElement(CalendarProposalReviewCard,{view,nowMs:NOW+600_000,
    interactive:true,onAnswer:vi.fn()}));
  expect(expired).toContain('Request expired');expect(expired).not.toContain('>Confirm event<');
});
it('never labels a failure, uncertain write or successful read as event creation',()=>{
  for (const state of ['unknown','definitely-failed','failed','cancelled','evidence-expired'] as const) {
    const view={...outcome(),state,receipt:null};
    const html=renderToStaticMarkup(createElement(CalendarViewRenderer,{view,nowMs:NOW}));
    expect(html).not.toContain('Calendar event created');expect(html).not.toContain('href=');
    expect(html).toContain(`data-calendar-state="${state}"`);
  }
  const read=renderToStaticMarkup(createElement(CalendarViewRenderer,{view:{...notice(),state:'read-completed',
    message:'Availability checked.',tool:'calendar_check_availability',coverage:'incomplete',conflict:'unknown'},nowMs:NOW}));
  expect(read).toContain('Availability checked.');expect(read).toContain('Coverage is incomplete');
  expect(read).not.toContain('No events');expect(read).not.toContain('Calendar event created');
});
it('uses the canonical candidate ID and never approves an incomplete target request',()=>{
  const onAnswer=vi.fn();const view={...proposal(),reason:'target' as const,target:null,
    candidates:[{calendarId:'team@example.com',label:'Shared label',role:'writer' as const}]};
  const controls=buttons(CalendarProposalReviewCard({view,nowMs:NOW,interactive:true,onAnswer}));
  expect(controls.some(p=>p.children === 'Confirm event')).toBe(false);
  controls.find(p=>Array.isArray(p.children) && p.children.includes('Shared label'))!.onClick!();
  expect(onAnswer).toHaveBeenCalledWith({kind:'select',calendarId:'team@example.com'});
});
it('keeps receipt facts after expiry but removes external link and expiring label',()=>{
  const fresh=renderToStaticMarkup(createElement(CalendarViewRenderer,{view:outcome(),nowMs:NOW}));
  expect(fresh).toContain('Calendar event created');expect(fresh).toContain('Calendar: Team');expect(fresh).toContain('href=');
  const old=renderToStaticMarkup(createElement(CalendarViewRenderer,{view:outcome(),nowMs:NOW+600_000}));
  expect(old).toContain('Event ID: event-1');expect(old).not.toContain('Calendar: Team');expect(old).not.toContain('href=');
});
it('resets a contained visual failure only for a new snapshot',()=>{
  const view=agenda();
  const state={value:view,failed:true};
  expect(CalendarViewBoundary.getDerivedStateFromProps({value:view,children:null},state)).toBeNull();
  expect(CalendarViewBoundary.getDerivedStateFromProps({value:outcome(),children:null},state)).toMatchObject({failed:false});
});
