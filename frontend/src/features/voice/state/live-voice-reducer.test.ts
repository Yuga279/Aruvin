/**
 * ============================================================================
 * FILE: live-voice-reducer.test.ts
 * LOCATION: frontend/src/features/voice/state/live-voice-reducer.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for live voice operational state reducer.
 *
 * ROLE IN PROJECT:
 *    Verifies independent operational dimensions (input, agent, connection),
 *    playback drain handling, and gesture-required suspend/recovery transitions.
 *
 * KEY COMPONENTS:
 *    - liveVoiceReducer tests
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { initialLiveVoice, liveVoiceReducer, showsLiveVoice, type LiveVoiceState } from './live-voice-reducer.ts';
import { outcome, proposal } from '../../canvas/testing/calendar-view-fixtures.ts';

it('keeps input listening while thinking and speaking; mute does not end playback', () => {
  let state = liveVoiceReducer(initialLiveVoice, { type: 'START' });
  state = liveVoiceReducer(state, { type: 'CONNECTING' });
  state = liveVoiceReducer(state, { type: 'READY', resumeRequired: false });
  state = liveVoiceReducer(state, { type: 'AGENT', agent: 'thinking' });
  expect(state).toMatchObject({ phase: 'active', input: 'listening', agent: 'thinking', connection: 'connected' });
  state = liveVoiceReducer(state, { type: 'AUDIO_START', ref: { turnId: 't1', responseId: 'r1' } });
  expect(state).toMatchObject({ input: 'listening', agent: 'speaking' });
  state = liveVoiceReducer(state, { type: 'INPUT', input: 'muted' });
  expect(state).toMatchObject({ input: 'muted', agent: 'speaking' });
});

it('does not mistake server idle or another response drain for local playback completion', () => {
  let state: LiveVoiceState = { ...initialLiveVoice, phase: 'active', connection: 'connected' };
  state = liveVoiceReducer(state, { type: 'AUDIO_START', ref: { turnId: 't1', responseId: 'r1' } });
  expect(liveVoiceReducer(state, { type: 'AGENT', agent: 'idle' }).agent).toBe('speaking');
  expect(liveVoiceReducer(state, { type: 'DRAINED', responseId: 'old' })).toBe(state);
  expect(liveVoiceReducer(state, { type: 'DRAINED', responseId: 'r1' }))
    .toMatchObject({ agent: 'idle', response: null, input: 'listening' });
});

it('reconnect and suspend require a gesture without collapsing the independent dimensions', () => {
  const active = { ...initialLiveVoice, phase: 'active' as const, connection: 'connected' as const, input: 'muted' as const };
  const lost = liveVoiceReducer(active, { type: 'LOST' });
  expect(lost).toMatchObject({ phase: 'suspended', connection: 'reconnecting', input: 'muted', resumeRequired: true });
  const recovered = liveVoiceReducer(lost, { type: 'READY', resumeRequired: true });
  expect(recovered).toMatchObject({ phase: 'suspended', connection: 'connected', resumeRequired: true });
  expect(liveVoiceReducer(recovered, { type: 'RESUMED' }))
    .toMatchObject({ phase: 'active', input: 'muted', resumeRequired: false });
});

it('quiet input suspension preserves active output and the mounted surface', () => {
  const speaking = { ...initialLiveVoice, phase: 'active' as const, connection: 'connected' as const,
    agent: 'speaking' as const, response: { turnId: 't', responseId: 'r' } }
  const quiet = liveVoiceReducer(speaking, { type: 'INPUT', input: 'suspended' })
  expect(quiet).toMatchObject({ phase: 'active', input: 'suspended', agent: 'speaking',
    response: speaking.response, resumeRequired: false })
  expect(showsLiveVoice(quiet)).toBe(true)
})

it('blocked and recoverable failures stay mounted and only permitted recovery enables Resume', () => {
  for (const canResume of [false, true]) {
    const state = liveVoiceReducer({ ...initialLiveVoice, phase: 'active' },
      { type: 'PAUSE', notice: 'Voice paused.', canResume })
    expect(state).toMatchObject({ phase: 'suspended', resumeRequired: true, canResume,
      response: null, agent: 'idle', restoreDraft: null })
    expect(showsLiveVoice(state)).toBe(true)
  }
})
it('retains accepted Canvas artifacts across interrupt, pause, and user hang-up while clearing on navigation or new start', () => {
  const artifact = {
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid' as const,
    subType: 'Flowchart',
    title: 'Pipeline',
    rawSource: 'flowchart TD\nA --> B',
  };
  let state = liveVoiceReducer(initialLiveVoice, { type: 'START', conversationId: null });
  state = liveVoiceReducer(state, { type: 'READY', resumeRequired: false });
  state = liveVoiceReducer(state, { type: 'CONVERSATION_BOUND', conversationId: 'conv-1' });
  state = liveVoiceReducer(state, { type: 'ARTIFACT_ACCEPTED', artifact });
  // Duplicate identity does not duplicate in reducer state
  state = liveVoiceReducer(state, { type: 'ARTIFACT_ACCEPTED', artifact });
  expect(state.conversationId).toBe('conv-1');
  expect(state.artifacts).toEqual([artifact]);

  state = liveVoiceReducer(state, { type: 'INTERRUPT' });
  expect(state.artifacts).toEqual([artifact]);

  state = liveVoiceReducer(state, { type: 'PAUSE', notice: 'Paused', canResume: true });
  expect(state.artifacts).toEqual([artifact]);

  // User hang-up retains provisional artifacts across ENDING/EXIT bridge
  const endingUser = liveVoiceReducer(state, {
    type: 'ENDING',
    notice: null,
    restoreDraft: null,
    retainArtifacts: true,
  });
  expect(endingUser.artifacts).toEqual([artifact]);
  const exitedUser = liveVoiceReducer(endingUser, {
    type: 'EXIT',
    notice: null,
    retainArtifacts: true,
  });
  expect(exitedUser.artifacts).toEqual([artifact]);
  expect(exitedUser.conversationId).toBe('conv-1');

  // Navigation exit clears immediately so artifacts never leak across conversations
  const exitedNav = liveVoiceReducer(state, {
    type: 'ENDING',
    notice: null,
    restoreDraft: null,
    retainArtifacts: false,
  });
  expect(exitedNav.artifacts).toEqual([]);
  expect(exitedNav.conversationId).toBeNull();

  // Next call START resets artifacts
  const restarted = liveVoiceReducer(exitedUser, { type: 'START', conversationId: 'conv-2' });
  expect(restarted.artifacts).toEqual([]);
  expect(restarted.conversationId).toBe('conv-2');
});

it('freezes proposal controls on reconnect and never cancels a write on barge-in',()=>{
  let state=liveVoiceReducer(initialLiveVoice,{type:'START',conversationId:'chat-1'});
  state=liveVoiceReducer(state,{type:'CALENDAR_FRAME',frame:{type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',
    event:{type:'calendar-view',view:proposal()}}});
  state=liveVoiceReducer(state,{type:'LOST'});state=liveVoiceReducer(state,{type:'RESUMED'});
  expect(state.calendarWorkspaces[0].interactive).toBe(false);
  state=liveVoiceReducer(state,{type:'CALENDAR_FRAME',frame:{type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',
    event:{type:'calendar-view',view:outcome()}}});
  state=liveVoiceReducer(state,{type:'INTERRUPT'});
  expect(state.calendarWorkspaces[0].view).toMatchObject({kind:'outcome',state:'succeeded'});
  expect(liveVoiceReducer(state,{type:'EXIT',notice:null,retainArtifacts:true}).calendarWorkspaces).toHaveLength(1);
  expect(liveVoiceReducer(state,{type:'EXIT',notice:null,retainArtifacts:false}).calendarWorkspaces).toEqual([]);
});
