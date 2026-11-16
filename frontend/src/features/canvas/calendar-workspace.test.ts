/**
 * ============================================================================
 * FILE: calendar-workspace.test.ts
 * LOCATION: frontend/src/features/canvas/calendar-workspace.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for live Calendar presentation folding and correlation.
 *
 * ROLE IN PROJECT:
 *    Proves progress/proposal/outcome frames converge on one stable workspace,
 *    that schema-only progress does not open one, and that a genuinely different
 *    intent splits workspaces without reviving authorization.
 *
 * KEY COMPONENTS:
 *    - frame: CalendarFramePayload test builder.
 *    - Fold, split, revision-downgrade, and terminal-success cases.
 * ============================================================================
 */

import {expect,it} from 'vitest';
import {claimCalendarAutoOpenId,foldCalendarFrame,mergeCalendarWorkspaces} from './calendar-workspace.ts';
import {proposal,outcome} from './testing/calendar-view-fixtures.ts';
import type {CalendarFramePayload} from '../../api/voice-protocol.ts';
const frame=(event:CalendarFramePayload['event'],turnId='turn-1'):CalendarFramePayload =>
  ({type:'calendar.frame',turnId,attemptId:`attempt-${turnId}`,responseId:`response-${turnId}`,event});
it('keeps proposal, confirmation progress and outcome in one workspace without treating progress as success',()=>{
  let items=foldCalendarFrame([],frame({type:'calendar-progress',phase:'executing'}));
  const id=items[0].id;
  items=foldCalendarFrame(items,frame({type:'calendar-view',view:proposal()}));
  items=foldCalendarFrame(items,frame({type:'calendar-progress',phase:'executing'},'confirm-turn'));
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({id,phase:'executing',interactive:false});
  items=foldCalendarFrame(items,frame({type:'calendar-view',view:outcome()},'confirm-turn'));
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({id,view:{kind:'outcome',state:'succeeded'}});
  expect(items[0].turnIds).toEqual(['turn-1','confirm-turn']);
});
it('does not open for schema validation and splits a genuinely different intent',()=>{
  expect(foldCalendarFrame([],frame({type:'calendar-progress',phase:'validating'}))).toEqual([]);
  let items=foldCalendarFrame([],frame({type:'calendar-view',view:proposal()}));
  items=foldCalendarFrame(items,frame({type:'calendar-progress',phase:'executing'},'new-turn'));
  items=foldCalendarFrame(items,frame({type:'calendar-view',view:{...proposal(),proposalId:'proposal-2',intentId:'intent-2'}},'new-turn'));
  expect(items).toHaveLength(2);
  expect(items[0].turnIds).toEqual(['turn-1']);
  expect(items[1].id).toBe('calendar:new-turn');
  expect(items[0].interactive).toBe(false);
});
it('cannot downgrade a proposal revision or resurrect it after terminal success',()=>{
  const current=foldCalendarFrame([],frame({type:'calendar-view',view:proposal()}));
  const stale=foldCalendarFrame(current,frame({type:'calendar-view',view:{...proposal(),revision:1}}));
  expect(stale[0].view).toMatchObject({kind:'proposal',revision:2});
  const final=foldCalendarFrame(current,frame({type:'calendar-view',view:outcome()},'confirm-turn'));
  expect(foldCalendarFrame(final,frame({type:'calendar-view',view:proposal()}))[0].view).toMatchObject({kind:'outcome'});
  const pending=current.map(w=>({...w,interactive:false,pending:true}));
  expect(foldCalendarFrame(pending,frame({type:'calendar-progress',phase:'executing'},'button-turn'))).toHaveLength(1);
});
it('opens only new live requests and respects dismissal through ordinary updates',()=>{
  const seen=new Set<string>();
  const workspaces=foldCalendarFrame([],frame({type:'calendar-progress',phase:'executing'}));
  const artifacts=mergeCalendarWorkspaces([],workspaces,true);
  const input={live:true,conversationId:'chat-1',selectedId:'chat-1',workspaces,artifacts,seen};
  expect(claimCalendarAutoOpenId({...input,live:false})).toBeNull();
  expect(seen.size).toBe(0);
  expect(claimCalendarAutoOpenId({...input,selectedId:'another'})).toBeNull();
  expect(claimCalendarAutoOpenId(input)).toBe('calendar:turn-1::canvas::calendar');
  // Closing Canvas is just CLOSE_CANVAS; seen identities intentionally remain claimed.
  expect(claimCalendarAutoOpenId(input)).toBeNull();
  const updated=foldCalendarFrame(workspaces,frame({type:'calendar-view',view:proposal()}));
  expect(claimCalendarAutoOpenId({...input,workspaces:updated,artifacts:mergeCalendarWorkspaces([],updated,true)})).toBeNull();
  const next=foldCalendarFrame(updated,frame({type:'calendar-view',view:{...proposal(),proposalId:'p2',intentId:'i2'}},'turn-2'));
  expect(claimCalendarAutoOpenId({...input,workspaces:next,artifacts:mergeCalendarWorkspaces([],next,true)})).toBe('calendar:turn-2::canvas::calendar');
});
