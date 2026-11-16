/**
 * ============================================================================
 * FILE: calendar-workspace.ts
 * LOCATION: frontend/src/features/canvas/calendar-workspace.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Fold bounded live Calendar frames into stable presentation workspaces.
 *
 * ROLE IN PROJECT:
 *    Correlates progress, proposal, and outcome frames by intent/proposal/operation
 *    identity for Canvas display only; it does not authorize or execute writes.
 *
 * KEY COMPONENTS:
 *    - foldCalendarFrame: Pure correlation/folding for one incoming live frame.
 *    - freezeCalendarControls: Makes every existing workspace read-only.
 *    - CalendarWorkspace: Bounded presentation record with turn/alias identity.
 * ============================================================================
 */

import type {CalendarProgressPhase,CalendarView} from '../../api/calendar-protocol.ts';
import type {CalendarFramePayload} from '../../api/voice-protocol.ts';
import type {CanvasArtifact} from './canvas-types.ts';
export type CalendarWorkspace = {
  id:string;turnIds:string[];artifactAliases:string[];intentId:string|null;proposalId:string|null;operationId:string|null;
  view:CalendarView|null;proposal:Extract<CalendarView,{kind:'proposal'}>|null;
  phase:CalendarProgressPhase|null;interactive:boolean;pending:boolean;
};
export function foldCalendarFrame(items:readonly CalendarWorkspace[],frame:CalendarFramePayload):CalendarWorkspace[] {
  const event=frame.event;
  const view=event.type === 'calendar-view' ? event.view : event.type === 'calendar-clarification' ? event.view ?? null : null;
  const op=event.type === 'calendar-operation' ? event.operation : null;
  const intentId=(view && 'intentId' in view ? view.intentId : null) ?? op?.intentId ?? null;
  const proposalId=(view && 'proposalId' in view ? view.proposalId : null) ?? op?.proposalId ??
    (event.type === 'calendar-clarification' ? event.proposalId : null);
  const operationId=(view?.kind === 'outcome' ? view.operationId : null) ?? op?.operationId ?? null;
  const correlated=items.find(w=>(intentId !== null && w.intentId === intentId) ||
    (proposalId !== null && w.proposalId === proposalId) || (operationId !== null && w.operationId === operationId));
  const byTurn=items.find(w=>w.turnIds.includes(frame.turnId));
  const differentIntent=Boolean(intentId && byTurn?.intentId && intentId !== byTurn.intentId);
  const pending=items.findLast(w=>w.view?.kind === 'proposal' && (w.interactive || w.pending));
  const target=correlated ?? (differentIntent ? undefined : byTurn) ??
    (!intentId && !proposalId && !operationId ? pending : undefined);
  if (!target && event.type === 'calendar-progress' && !['executing','reconciling'].includes(event.phase)) return [...items];
  if (view?.kind === 'proposal' && target?.proposal?.proposalId === view.proposalId &&
    (view.revision < target.proposal.revision || (target.pending && view.revision === target.proposal.revision))) return [...items];
  if (view?.kind === 'proposal' && target?.view &&
    ((target.view.kind === 'outcome' && !['planned','dispatching'].includes(target.view.state)) ||
      (target.view.kind === 'notice' && ['cancelled','expired'].includes(target.view.state)))) return [...items];
  const initial:CalendarWorkspace={id:`calendar:${frame.turnId}`,turnIds:[],artifactAliases:[],intentId:null,proposalId:null,operationId:null,
    view:null,proposal:null,phase:null,interactive:false,pending:false};
  const base=target ?? initial;
  const operationView:CalendarView|null=op && op.intentId ? {viewVersion:1,kind:'outcome',operationId:op.operationId,
    proposalId:op.proposalId ?? null,intentId:op.intentId,state:op.state,retryAction:op.retryAction,receipt:op.receipt} : null;
  const nextView=view ?? operationView ?? base.view;
  const isProposal=Boolean(view?.kind === 'proposal');
  const mergingProvisional=byTurn && byTurn.id !== base.id && !differentIntent ? byTurn : null;
  const next:CalendarWorkspace={...base,turnIds:[...new Set([...base.turnIds,...(mergingProvisional?.turnIds ?? []),frame.turnId])],
    artifactAliases:[...new Set([...base.artifactAliases,...(mergingProvisional ?
      [`${mergingProvisional.id}::canvas::calendar`,...mergingProvisional.artifactAliases] : [])])],
    intentId:intentId ?? base.intentId,proposalId:proposalId ?? base.proposalId,operationId:operationId ?? base.operationId,
    view:nextView,proposal:view?.kind === 'proposal' ? view : base.proposal,
    phase:event.type === 'calendar-progress' ? event.phase : null,interactive:isProposal,pending:false};
  const updated=items.filter(w=>w.id !== next.id && w.id !== mergingProvisional?.id).map(w=>({...w,interactive:false,
    turnIds:w.turnIds.filter(id=>id !== frame.turnId)})).filter(w=>w.turnIds.length > 0);
  // ponytail: at most 64 recent workspaces per call; assistant messages are the archive.
  // If longer-call navigation is needed, page the existing message archive rather than grow this slice.
  return [...updated,next].slice(-64);
}
export const freezeCalendarControls=(items:readonly CalendarWorkspace[]) =>
  items.map(w=>({...w,interactive:false}));
export function calendarViewKey(view:CalendarView|null,turnId:string):string {
  return view && 'intentId' in view && view.intentId ? `intent:${view.intentId}` : `turn:${turnId}`;
}
export function calendarViewArtifact(view:CalendarView,messageId:string,turnId:string):CanvasArtifact {
  const title=view.kind === 'agenda' ? 'Calendar agenda' : view.kind === 'proposal' ? 'Review Calendar event' :
    view.kind === 'outcome' ? 'Calendar outcome' : 'Calendar update';
  return {artifactId:`${messageId}::canvas::calendar`,messageId,turnId,index:0,kind:'calendar',
    subType:view.kind === 'agenda' ? 'Agenda' : view.kind === 'proposal' ? 'Confirmation' : 'Calendar',
    title,buttonLabel:view.kind === 'agenda' ? 'View agenda in Canvas' : 'View Calendar result in Canvas',
    rawSource:'',isStreaming:false,calendarView:view};
}
export function mergeCalendarWorkspaces(artifacts:readonly CanvasArtifact[],workspaces:readonly CalendarWorkspace[],includeLive:boolean):CanvasArtifact[] {
  let result=[...artifacts];
  for (const workspace of workspaces) {
    const matching=result.filter(a=>a.kind === 'calendar' &&
      ((a.turnId !== undefined && workspace.turnIds.includes(a.turnId)) ||
       (a.calendarView && workspace.view && calendarViewKey(a.calendarView,a.turnId ?? a.messageId) ===
         calendarViewKey(workspace.view,workspace.turnIds[0]))));
    const liveId=`${workspace.id}::canvas::calendar`;
    const aliases=[...new Set([liveId,...workspace.artifactAliases,...matching.flatMap(a=>[a.artifactId,...(a.calendarAliases ?? [])])])];
    if (!includeLive && matching.length === 0) continue;
    const archived=matching.at(-1);
    const item:CanvasArtifact=includeLive ? {
      ...(workspace.view ? calendarViewArtifact(workspace.view,workspace.id,workspace.turnIds[0]) :
        {artifactId:liveId,messageId:workspace.id,turnId:workspace.turnIds[0],index:0,kind:'calendar' as const,
          subType:'Calendar',title:'Calendar workspace',buttonLabel:'View Calendar in Canvas',rawSource:'',isStreaming:false}),
      calendarWorkspace:workspace,calendarAliases:aliases,
    } : {...archived!,calendarAliases:aliases};
    const ids=new Set(matching.map(a=>a.artifactId));
    const insertion=result.findIndex(a=>ids.has(a.artifactId));
    result=result.filter(a=>!ids.has(a.artifactId));
    result.splice(insertion < 0 ? result.length : insertion,0,item);
  }
  return result;
}
export const matchesCalendarArtifact=(artifact:CanvasArtifact,id:string|null) =>
  id !== null && (artifact.artifactId === id || artifact.calendarAliases?.includes(id) === true);
export function claimCalendarAutoOpenId({live,conversationId,selectedId,workspaces,artifacts,seen}:{
  live:boolean;conversationId:string|null;selectedId:string|null;workspaces:readonly CalendarWorkspace[];
  artifacts:readonly CanvasArtifact[];seen:Set<string>}):string|null {
  if (!live || !conversationId || conversationId !== selectedId) return null;
  let newest:string|null=null;
  for (const workspace of workspaces) {
    if (seen.has(workspace.id)) continue;
    const artifact=artifacts.find(a=>matchesCalendarArtifact(a,`${workspace.id}::canvas::calendar`));
    if (!artifact) continue;
    seen.add(workspace.id);newest=artifact.artifactId;
  }
  return newest;
}
