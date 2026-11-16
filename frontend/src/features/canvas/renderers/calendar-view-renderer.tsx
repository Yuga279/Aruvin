/**
 * ============================================================================
 * FILE: calendar-view-renderer.tsx
 * LOCATION: frontend/src/features/canvas/renderers/calendar-view-renderer.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Switch a structured Calendar view into agenda, review, outcome, or notice UI.
 *
 * ROLE IN PROJECT:
 *    Presents truthful Calendar facts inside Canvas: one-shot expiry refresh,
 *    read-only history, exact-action confirmation only for the current live
 *    proposal, and a local error boundary so display failures never reach media.
 *
 * KEY COMPONENTS:
 *    - CalendarProposalReviewCard: Historical/requested/live proposal facts and controls.
 *    - CalendarViewRenderer: View switch with one bounded expiry timer.
 *    - CalendarViewBoundary: Snapshot-keyed render-error containment.
 * ============================================================================
 */

import {Component,useEffect,useState,type ReactNode} from 'react';
import type {CalendarView} from '../../../api/calendar-protocol.ts';
import type {CalendarConfirmPayload} from '../../../api/voice-protocol.ts';
import {describeCalendarProgress,describeOperationState,describeCalendarRetryAction,
  resolveReceiptCalendarLabel,resolveSafeReceiptLink} from '../../plugins/google-calendar/CalendarTurnRegion.tsx';
import type {CalendarWorkspace} from '../calendar-workspace.ts';
import {CalendarAgendaView,calendarInterval} from './calendar-agenda-view.tsx';
type Proposal=Extract<CalendarView,{kind:'proposal'}>;
type Answer=CalendarConfirmPayload['answer'];
export function CalendarProposalReviewCard({view,nowMs=Date.now(),interactive=false,disabled=false,onAnswer,context='history'}:{
  view:Proposal;nowMs?:number;interactive?:boolean;disabled?:boolean;onAnswer?:(answer:Answer)=>void;context?:'history'|'requested'}) {
  const expired=Date.parse(view.expiresAt)<=nowMs;
  const controls=interactive && !expired && Boolean(onAnswer);
  const target=view.target;
  const label=!expired && target?.labelExpiresAt && Date.parse(target.labelExpiresAt)>nowMs ? target.calendarLabel : null;
  const reason={target:'Choose a calendar',details:'Review this event',conflict:'This time conflicts with another event',coverage:'Availability coverage is incomplete'}[view.reason];
  return <section className="aurvin-calendar-review" aria-label="Review Calendar request">
    <h2>{context === 'requested' ? 'Requested event' : reason}</h2><p>{expired ?
      (context === 'requested' ? 'The original proposal expired; this does not change the reported outcome.' : 'Request expired. Ask Aurvin again.') : interactive ? 'Awaiting your confirmation.' :
      context === 'requested' ? 'This is the request being processed, not confirmation of creation.' : 'Historical snapshot — this card cannot authorize a write.'}</p>
    {view.action ? <><h3>{view.action.summary}</h3>
      <p>{calendarInterval({...view.action,allDay:false},view.action.timeZone)}</p><p>Time zone: {view.action.timeZone}</p>
      {view.action.location ? <p>Location: {view.action.location}</p> : null}
      {view.action.description ? <p className="aurvin-calendar-description">{view.action.description}</p> : null}
      <p>Creates one event. No invitations will be sent.</p></> : <p>More details are needed before an event can be created.</p>}
    {target ? <p>Calendar: {label ? `${label} · ` : ''}{target.calendarId}</p> : null}
    <p>Request expires: <time dateTime={view.expiresAt}>{view.expiresAt}</time></p>
    {view.candidates.length ? <ul>{view.candidates.map(c=><li key={c.calendarId}>
      {controls ? <button type="button" disabled={disabled} onClick={()=>onAnswer?.({kind:'select',calendarId:c.calendarId})}>
        Choose {c.label}</button> : <span>{expired ? c.calendarId : c.label}</span>}
      <span> · {c.role}</span></li>)}</ul> : null}
    {controls ? <div className="aurvin-calendar-card-actions" role="group" aria-label="Calendar request confirmation">
      <button className="aurvin-calendar-cancel-btn" type="button" disabled={disabled} onClick={()=>onAnswer?.({kind:'reject'})}>Cancel request</button>
      {view.reason !== 'target' && view.action && target ? <button className="aurvin-calendar-confirm-btn" type="button" disabled={disabled}
        onClick={()=>onAnswer?.({kind:'accept'})}>Confirm event</button> : null}
    </div> : null}
  </section>;
}
function expiryDeadlines(view:CalendarView|null):number[] {
  if (!view) return [];
  const deadlines:string[]=[];
  if ('expiresAt' in view) deadlines.push(view.expiresAt);
  if ((view.kind === 'agenda' || view.kind === 'proposal') && view.target?.labelExpiresAt) deadlines.push(view.target.labelExpiresAt);
  if (view.kind === 'outcome' && view.receipt?.expiresAt) deadlines.push(view.receipt.expiresAt);
  return deadlines.map(Date.parse).filter(Number.isFinite);
}
export function CalendarViewRenderer({view,workspace,nowMs:testNow,disabled=false,onAnswer}:{
  view:CalendarView|null;workspace?:CalendarWorkspace;nowMs?:number;disabled?:boolean;onAnswer?:(answer:Answer)=>void}) {
  const [clock,setClock]=useState(()=>Date.now());const nowMs=testNow ?? Math.max(clock,Date.now());
  useEffect(()=>{
    if (testNow !== undefined) return;
    const next=expiryDeadlines(view).filter(t=>t>Date.now()).sort((a,b)=>a-b)[0];
    if (next === undefined) return;
    const timer=setTimeout(()=>setClock(Date.now()),Math.min(2_147_483_647,Math.max(1,next-Date.now())));
    return ()=>clearTimeout(timer);
  },[view,clock,testNow]);
  const progress=workspace?.phase;
  let body:ReactNode=null;
  if (view?.kind === 'agenda') body=<CalendarAgendaView view={view} nowMs={nowMs}/>;
  else if (view?.kind === 'proposal') body=<CalendarProposalReviewCard view={view} nowMs={nowMs}
    interactive={workspace?.interactive} disabled={disabled || workspace?.pending} onAnswer={onAnswer}/>;
  else if (view?.kind === 'outcome') {
    const label=resolveReceiptCalendarLabel(view.receipt,nowMs);const link=resolveSafeReceiptLink(view.receipt,nowMs);
    const heading=['planned','dispatching'].includes(view.state) ? 'Creating Calendar event…' : describeOperationState(view.state);
    body=<section className="aurvin-calendar-outcome" data-calendar-state={view.state} aria-label="Calendar outcome">
      <h2>{heading}</h2>{view.receipt ? <p>Event ID: {view.receipt.eventId}</p> : null}
      {label ? <p>Calendar: {label}</p> : null}
      {link ? <a href={link} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a> : null}
      {view.state === 'unknown' ? <p>Do not repeat this write. Check the Calendar outcome before sending a new request.</p> : null}
      <p>{describeCalendarRetryAction(view.retryAction).explanation}</p>
    </section>;
  } else if (view?.kind === 'notice') body=<section className="aurvin-calendar-notice" data-calendar-state={view.state} aria-label="Calendar update">
    <h2>Calendar update</h2><p>{view.message}</p>
    {view.coverage === 'incomplete' ? <p>Coverage is incomplete.</p> : null}
    {view.conflict ? <p>Availability: {view.conflict}.</p> : null}
    {view.limitations.length ? <p>Limitations: {view.limitations.join(', ')}.</p> : null}
  </section>;
  return <div className="aurvin-calendar-workspace">
    <p role="status" aria-live="polite" aria-atomic="true">{progress ? describeCalendarProgress(progress) :
      workspace?.pending ? 'Confirmation sent. Waiting for the actual outcome.' : 'Calendar result'}</p>
    {workspace?.proposal && view?.kind === 'outcome' ?
      <CalendarProposalReviewCard view={workspace.proposal} nowMs={nowMs} context="requested"/> : null}
    {body}
  </div>;
}
type BoundaryProps={children:ReactNode;value:CalendarView|null};
type BoundaryState={failed:boolean;value:CalendarView|null};
export class CalendarViewBoundary extends Component<BoundaryProps,BoundaryState> {
  constructor(props:BoundaryProps){super(props);this.state={failed:false,value:props.value};}
  static getDerivedStateFromError(){return {failed:true};}
  static getDerivedStateFromProps(props:BoundaryProps,state:BoundaryState){
    return props.value !== state.value ? {failed:false,value:props.value} : null;
  }
  render(){return this.state.failed ? <p role="status">Calendar display is unavailable. Voice and chat can continue.</p> : this.props.children;}
}
