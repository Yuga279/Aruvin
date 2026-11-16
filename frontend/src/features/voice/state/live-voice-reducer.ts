/**
 * ============================================================================
 * FILE: live-voice-reducer.ts
 * LOCATION: frontend/src/features/voice/state/live-voice-reducer.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Independent operational state reducer for live duplex voice and Canvas.
 *
 * ROLE IN PROJECT:
 *    Models independent input (listening/suspended/muted), agent, connection,
 *    paused/blocked call recovery, bound conversation identity, and accepted
 *    provisional Canvas artifact projections without a transcript field.
 *
 * KEY COMPONENTS:
 *    - liveVoiceReducer: Reducer managing operational phase, status, and visuals.
 *    - initialLiveVoice: Initial state baseline.
 *    - showsLiveVoice: Predicate for showing the live surface.
 * ============================================================================
 */

import type {
  CanvasArtifactProjection,
  CalendarFramePayload,
  VoiceResponseRef,
} from '../../../api/voice-protocol.ts';
import {
  foldCalendarFrame,
  freezeCalendarControls,
  type CalendarWorkspace,
} from '../../canvas/calendar-workspace.ts';

export type LiveDraft = {
  text: string;
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
};

export type LiveVoiceState = {
  phase: 'idle' | 'requesting_permission' | 'connecting' | 'active' | 'suspended' | 'ending';
  input: 'listening' | 'muted' | 'suspended';
  agent: 'idle' | 'thinking' | 'speaking';
  connection: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  response: VoiceResponseRef | null;
  resumeRequired: boolean;
  inputBusy: boolean;
  canResume: boolean;
  errorCode: string | null;
  notice: string | null;
  restoreDraft: LiveDraft | null;
  conversationId: string | null;
  artifacts: CanvasArtifactProjection[];
  calendarWorkspaces: CalendarWorkspace[];
};

export const initialLiveVoice: LiveVoiceState = {
  phase: 'idle',
  input: 'listening',
  agent: 'idle',
  connection: 'connecting',
  response: null,
  resumeRequired: false,
  inputBusy: false,
  canResume: false,
  errorCode: null,
  notice: null,
  restoreDraft: null,
  conversationId: null,
  artifacts: [],
  calendarWorkspaces: [],
};

export type LiveVoiceAction =
  | { type: 'START'; conversationId?: string | null }
  | { type: 'CONNECTING' | 'LOST' | 'RESUMED' | 'INTERRUPT' }
  | { type: 'READY'; resumeRequired: boolean }
  | { type: 'CONVERSATION_BOUND'; conversationId: string }
  | { type: 'ARTIFACT_ACCEPTED'; artifact: CanvasArtifactProjection }
  | { type: 'CALENDAR_FRAME'; frame: CalendarFramePayload }
  | { type: 'CALENDAR_PENDING'; proposalId: string; revision: number }
  | { type: 'INPUT'; input: LiveVoiceState['input'] }
  | { type: 'INPUT_BUSY'; value: boolean }
  | { type: 'AGENT'; agent: LiveVoiceState['agent'] }
  | { type: 'AUDIO_START'; ref: VoiceResponseRef }
  | { type: 'DRAINED'; responseId: string }
  | { type: 'SUSPEND' | 'NOTICE'; notice: string }
  | { type: 'PAUSE'; notice: string; canResume: boolean; code?: string; disconnected?: boolean }
  | {
      type: 'ENDING';
      notice: string | null;
      restoreDraft: LiveDraft | null;
      retainArtifacts?: boolean;
    }
  | { type: 'EXIT'; notice: string | null; retainArtifacts?: boolean };

export function liveVoiceReducer(
  state: LiveVoiceState,
  action: LiveVoiceAction,
): LiveVoiceState {
  switch (action.type) {
    case 'START':
      return {
        ...initialLiveVoice,
        phase: 'requesting_permission',
        conversationId: action.conversationId ?? null,
      };
    case 'CONNECTING':
      return { ...state, phase: 'connecting', connection: 'connecting' };
    case 'READY':
      return {
        ...state,
        connection: 'connected',
        resumeRequired: action.resumeRequired,
        phase: action.resumeRequired ? 'suspended' : 'active',
        canResume: action.resumeRequired
          ? state.errorCode
            ? state.canResume
            : true
          : state.canResume,
      };
    case 'CONVERSATION_BOUND':
      return state.conversationId === action.conversationId
        ? state
        : { ...state, conversationId: action.conversationId };
    case 'ARTIFACT_ACCEPTED': {
      const exists = state.artifacts.some(
        (item) =>
          item.responseId === action.artifact.responseId &&
          item.ordinal === action.artifact.ordinal,
      );
      return exists ? state : { ...state, artifacts: [...state.artifacts, action.artifact] };
    }
    case 'CALENDAR_FRAME':
      return {...state,calendarWorkspaces:foldCalendarFrame(state.calendarWorkspaces,action.frame)};
    case 'CALENDAR_PENDING':
      return {...state,calendarWorkspaces:state.calendarWorkspaces.map(w=>w.view?.kind === 'proposal' &&
        w.view.proposalId === action.proposalId && w.view.revision === action.revision ? {...w,pending:true,interactive:false} : w)};
    case 'INPUT':
      return { ...state, input: action.input };
    case 'INPUT_BUSY':
      return { ...state, inputBusy: action.value };
    case 'AGENT':
      return state.response && action.agent === 'idle'
        ? state
        : {
            ...state,
            agent: action.agent === 'speaking' && !state.response ? 'thinking' : action.agent,
          };
    case 'AUDIO_START':
      return { ...state, agent: 'speaking', response: action.ref };
    case 'DRAINED':
      return state.response?.responseId === action.responseId
        ? { ...state, agent: 'idle', response: null }
        : state;
    case 'INTERRUPT':
      return { ...state, agent: 'idle', response: null };
    case 'LOST':
      return {
        ...state,
        phase: 'suspended',
        connection: 'reconnecting',
        resumeRequired: true,
        canResume: false,
        agent: 'idle',
        response: null,
        inputBusy: false,
        calendarWorkspaces: freezeCalendarControls(state.calendarWorkspaces),
        notice: 'Connection lost. Reconnecting; you may need to repeat your last turn.',
      };
    case 'SUSPEND':
      return {
        ...state,
        phase: 'suspended',
        resumeRequired: true,
        canResume: state.connection === 'connected',
        agent: 'idle',
        response: null,
        inputBusy: false,
        calendarWorkspaces: freezeCalendarControls(state.calendarWorkspaces),
        notice: action.notice,
      };
    case 'PAUSE':
      return {
        ...state,
        phase: 'suspended',
        resumeRequired: true,
        canResume: action.canResume,
        errorCode: action.code ?? null,
        connection: action.disconnected ? 'disconnected' : state.connection,
        response: null,
        agent: 'idle',
        inputBusy: false,
        calendarWorkspaces: freezeCalendarControls(state.calendarWorkspaces),
        notice: action.notice,
      };
    case 'RESUMED':
      return {
        ...state,
        phase: 'active',
        resumeRequired: false,
        notice: null,
        canResume: false,
        errorCode: null,
        inputBusy: false,
      };
    case 'NOTICE':
      return { ...state, notice: action.notice };
    case 'ENDING':
      return {
        ...state,
        phase: 'ending',
        response: null,
        agent: 'idle',
        resumeRequired: false,
        inputBusy: false,
        notice: action.notice,
        restoreDraft: action.restoreDraft,
        conversationId: action.retainArtifacts ? state.conversationId : null,
        artifacts: action.retainArtifacts ? state.artifacts : [],
        calendarWorkspaces: action.retainArtifacts ? freezeCalendarControls(state.calendarWorkspaces) : [],
      };
    case 'EXIT':
      return {
        ...initialLiveVoice,
        notice: action.notice,
        restoreDraft: state.restoreDraft,
        conversationId: action.retainArtifacts ? state.conversationId : null,
        artifacts: action.retainArtifacts ? state.artifacts : [],
        calendarWorkspaces: action.retainArtifacts ? freezeCalendarControls(state.calendarWorkspaces) : [],
      };
  }
}

export const showsLiveVoice = (state: LiveVoiceState) =>
  state.phase !== 'idle' && state.phase !== 'ending';
