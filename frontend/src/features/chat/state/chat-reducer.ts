/**
 * ============================================================================
 * FILE: chat-reducer.ts
 * LOCATION: frontend/src/features/chat/state/chat-reducer.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic pure reducer for chat navigation, paging, and streaming.
 *
 * ROLE IN PROJECT:
 *    Owns all UI state transitions so session order, draft preservation, and
 *    turn lifecycle can be unit-tested without React or network I/O.
 *
 * KEY COMPONENTS:
 *    - initialChatState: Empty idle chat with no premature session record.
 *    - sortSessions: lastActivityAt DESC with sessionId DESC tie-break.
 *    - chatReducer: Immutable transitions for every ChatAction.
 * ============================================================================
 */

import type { AttemptStatus, SessionSummary, VisibleMessage } from '../../../api/protocol.ts';
import type { ChatAction, ChatState } from './chat-types.ts';

function isBusyAttemptStatus(status: ChatState['turnStatus']): boolean {
  return status === 'accepted' || status === 'generating' || status === 'finalizing';
}

export const initialChatState: ChatState = {
  submissionRecovery: null,
  retryRecovery: null,
  saves: {},
  unsavedMessages: {},
  localSessionIds: [],
  sessionsRevision: 0,
  sessions: [],
  sessionsLoading: false,
  sessionsError: null,
  sessionsCursor: null,
  hasMoreSessions: false,

  activeSessionId: null,
  activeSessionTitle: null,

  messages: [],
  messagesLoading: false,
  messagesError: null,
  messagesCursor: null,
  olderAvailable: false,
  loadingOlder: false,

  activeTurnId: null,
  activeAttemptId: null,
  activeTurnMode: null,
  turnStatus: 'idle',
  isStreaming: false,
  streamText: '',
  turnError: null,

  draftInput: '',
  isSubmitting: false,

  voiceInput: null,

  sidebarOpen: false,

  canvasOpen: false,
  activeCanvasArtifactId: null,
  closedCanvasArtifactIds: [],

  calendarProgress: null,
  calendarOperationsByTurn: {},
  calendarViewsByTurn: {},
  calendarTurnOrder: [],
  calendarClarification: null,
  calendarLastSequence: -1,
};

function syncActiveCalendarNarration(
  state: ChatState,
  narration: 'completed' | 'failed' | 'interrupted',
): Record<string, ChatState['calendarOperationsByTurn'][string]> {
  const turnId = state.activeTurnId;
  if (!turnId) return state.calendarOperationsByTurn;
  const existing = state.calendarOperationsByTurn[turnId];
  if (!existing || existing.narration !== 'pending') {
    return state.calendarOperationsByTurn;
  }
  return {
    ...state.calendarOperationsByTurn,
    [turnId]: {
      ...existing,
      narration,
    },
  };
}

function ignoreCalendarAction(
  state: ChatState,
  payload: { turnId: string; sessionId?: string; attemptId?: string; sequence?: number },
): boolean {
  if (payload.turnId !== state.activeTurnId) return true;
  if (payload.sessionId !== undefined && payload.sessionId !== state.activeSessionId) return true;
  if (payload.attemptId !== undefined && payload.attemptId !== state.activeAttemptId) return true;
  return payload.sequence !== undefined && payload.sequence <= state.calendarLastSequence;
}

function sortSessions(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff) return pinDiff;
    const timeDiff = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return b.sessionId.localeCompare(a.sessionId);
  });
}

function appendTerminalAssistant(
  state: ChatState,
  completionStatus: VisibleMessage['completionStatus'],
  truncated: boolean,
  messageId: string,
): VisibleMessage[] {
  if (!state.streamText) {
    return state.messages;
  }

  const assistantMsg: VisibleMessage = {
    messageId,
    turnId: state.activeTurnId ?? 'turn_completed',
    eventId: `evt_${messageId}`,
    sequence: state.messages.length + 1,
    role: 'assistant',
    content: state.streamText,
    createdAt: new Date().toISOString(),
    completionStatus,
    truncated,
  };

  return [...state.messages, assistantMsg];
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SUBMISSION_RECOVERY':
      return { ...state, submissionRecovery: action.payload };
    case 'RETRY_RECOVERY':
      return { ...state, retryRecovery: action.payload };
    case 'SAVE_STATE': {
      const { sessionId, turnId, save, mode } = action.payload;
      const oldEntry = state.saves[sessionId];
      const old = oldEntry?.value;
      if (old && (old.epoch !== save.epoch || old.version > save.version ||
        (old.version === save.version && old.durableVersion > save.durableVersion))) return state;
      const unsavedMessages = { ...state.unsavedMessages };
      if (save.state === 'saved') delete unsavedMessages[sessionId];
      else if (sessionId === state.activeSessionId) unsavedMessages[sessionId] = state.messages;
      const resolvedMode = mode ?? oldEntry?.mode;
      return {
        ...state,
        saves: {
          ...state.saves,
          [sessionId]: { turnId, value: save, ...(resolvedMode ? { mode: resolvedMode } : {}) },
        },
        unsavedMessages,
        sessionsRevision: state.sessionsRevision + (save.state === 'saved' && old?.state !== 'saved' ? 1 : 0),
        localSessionIds: save.state === 'saved' ? state.localSessionIds.filter(id => id !== sessionId) : state.localSessionIds,
      };
    }
    case 'NEW_CHAT':
      return {
        ...state,
        unsavedMessages: state.activeSessionId && state.saves[state.activeSessionId] && state.saves[state.activeSessionId].value.state !== 'saved'
          ? { ...state.unsavedMessages, [state.activeSessionId]: state.messages } : state.unsavedMessages,
        activeSessionId: null,
        activeSessionTitle: null,
        messages: [],
        messagesLoading: false,
        messagesError: null,
        messagesCursor: null,
        olderAvailable: false,
        activeTurnId: null,
        activeAttemptId: null,
        activeTurnMode: null,
        turnStatus: 'idle',
        isStreaming: false,
        streamText: '',
        turnError: null,
        isSubmitting: false,
        voiceInput: null,
        sidebarOpen: false,
        canvasOpen: false,
        activeCanvasArtifactId: null,
        closedCanvasArtifactIds: [],
        calendarProgress: null,
        calendarOperationsByTurn: {},
        calendarViewsByTurn: {},
        calendarTurnOrder: [],
        calendarClarification: null,
        calendarLastSequence: -1,
      };

    case 'SET_DRAFT':
      return state.voiceInput ? state : { ...state, draftInput: action.payload };

    case 'CLAIM_VOICE_INPUT':
      return state.voiceInput || state.isStreaming || state.isSubmitting || isBusyAttemptStatus(state.turnStatus)
        ? state
        : { ...state, voiceInput: action.payload };

    case 'VOICE_DRAFT':
      return state.voiceInput?.token === action.payload.token
        ? { ...state, draftInput: action.payload.text } : state;

    case 'RELEASE_VOICE_INPUT':
      return state.voiceInput?.token === action.payload
        ? { ...state, voiceInput: null } : state;

    case 'BIND_VOICE_CONVERSATION': {
      if (state.voiceInput?.token !== action.payload.token || state.voiceInput.mode !== 'live') return state;
      const { conversationId, turnId, save } = action.payload;
      if (state.activeSessionId && state.activeSessionId !== conversationId) return state;
      const existing = state.sessions.find((s) => s.sessionId === conversationId);
      const nextTitle = state.activeSessionTitle ?? existing?.title ?? 'New chat';
      if (!turnId || !save) {
        return {
          ...state,
          activeSessionId: conversationId,
          activeSessionTitle: nextTitle,
        };
      }
      const at = new Date().toISOString();
      const priorEpoch = state.saves[conversationId]?.value.epoch;
      const saves =
        priorEpoch && priorEpoch !== save.epoch
          ? Object.fromEntries(Object.entries(state.saves).filter(([id]) => id !== conversationId))
          : state.saves;
      const next: ChatState = {
        ...state,
        activeSessionId: conversationId,
        activeSessionTitle: nextTitle,
        saves,
        sessionsRevision: state.sessionsRevision + 1,
        localSessionIds:
          save.state !== 'saved'
            ? [...new Set([...state.localSessionIds, conversationId])]
            : state.localSessionIds.filter((id) => id !== conversationId),
        sessions: sortSessions([
          ...state.sessions.filter((s) => s.sessionId !== conversationId),
          { ...(existing ?? { sessionId: conversationId, title: nextTitle, createdAt: at }), lastActivityAt: at },
        ]),
      };
      return chatReducer(next, {
        type: 'SAVE_STATE',
        payload: { sessionId: conversationId, turnId, save, mode: 'live' },
      });
    }

    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };

    case 'CLOSE_SIDEBAR':
      return { ...state, sidebarOpen: false };

    case 'OPEN_CANVAS_ARTIFACT':
      return {
        ...state,
        canvasOpen: true,
        activeCanvasArtifactId: action.payload.artifactId,
        closedCanvasArtifactIds: state.closedCanvasArtifactIds.filter(
          (id) => id !== action.payload.artifactId,
        ),
      };

    case 'CLOSE_CANVAS_TAB': {
      const closed = state.closedCanvasArtifactIds.includes(action.payload.artifactId)
        ? state.closedCanvasArtifactIds
        : [...state.closedCanvasArtifactIds, action.payload.artifactId];
      const nextActive =
        action.payload.fallbackArtifactId === null
          ? null
          : state.activeCanvasArtifactId === action.payload.artifactId
            ? action.payload.fallbackArtifactId
            : state.activeCanvasArtifactId;
      return {
        ...state,
        closedCanvasArtifactIds: closed,
        activeCanvasArtifactId: nextActive,
        canvasOpen: nextActive !== null ? state.canvasOpen : false,
      };
    }

    case 'CLOSE_CANVAS':
      return { ...state, canvasOpen: false };

    case 'SESSIONS_LOADING':
      return { ...state, sessionsLoading: true, sessionsError: null };

    case 'SESSIONS_LOADED': {
      const merged = new Map(action.payload.items.map(item => [item.sessionId, item]));
      for (const item of state.sessions) if (state.localSessionIds.includes(item.sessionId) ||
        (action.payload.revision !== undefined && action.payload.revision !== state.sessionsRevision)) merged.set(item.sessionId, item);
      return {
        ...state,
        sessionsLoading: false,
        sessions: sortSessions([...merged.values()]),
        sessionsCursor: action.payload.nextCursor,
        hasMoreSessions: action.payload.nextCursor !== null,
      };
    }

    case 'SESSIONS_APPENDED': {
      const merged = new Map<string, SessionSummary>();
      for (const item of state.sessions) {
        merged.set(item.sessionId, item);
      }
      for (const item of action.payload.items) {
        if (!state.localSessionIds.includes(item.sessionId)) merged.set(item.sessionId, item);
      }
      return {
        ...state,
        sessions: sortSessions(Array.from(merged.values())),
        sessionsCursor: action.payload.nextCursor,
        hasMoreSessions: action.payload.nextCursor !== null,
      };
    }

    case 'SESSIONS_ERROR':
      return { ...state, sessionsLoading: false, sessionsError: action.payload };

    case 'SESSION_UPDATED':
      return { ...state, sessionsRevision: state.sessionsRevision + 1, sessions: sortSessions(state.sessions.map(session =>
        session.sessionId === action.payload.sessionId ? action.payload : session)),
        activeSessionTitle: state.activeSessionId === action.payload.sessionId ? action.payload.title : state.activeSessionTitle };

    case 'SESSION_DELETED': {
      const next = state.activeSessionId === action.payload ? chatReducer(state, { type: 'NEW_CHAT' }) : state;
      return { ...next, sessions: next.sessions.filter(session => session.sessionId !== action.payload) };
    }

    case 'SELECT_SESSION':
      return {
        ...state,
        unsavedMessages: state.activeSessionId && state.saves[state.activeSessionId] && state.saves[state.activeSessionId].value.state !== 'saved'
          ? { ...state.unsavedMessages, [state.activeSessionId]: state.messages } : state.unsavedMessages,
        activeSessionId: action.payload.sessionId,
        activeSessionTitle: action.payload.title,
        messages: state.unsavedMessages[action.payload.sessionId] ?? [],
        messagesLoading: true,
        messagesError: null,
        activeTurnId: null,
        activeAttemptId: null,
        activeTurnMode: null,
        turnStatus: 'idle',
        isStreaming: false,
        streamText: '',
        turnError: null,
        voiceInput: null,
        sidebarOpen: false,
        canvasOpen: false,
        activeCanvasArtifactId: null,
        closedCanvasArtifactIds: [],
        calendarProgress: null,
        calendarOperationsByTurn: {},
        calendarViewsByTurn: {},
        calendarTurnOrder: [],
        calendarClarification: null,
        calendarLastSequence: -1,
      };

    case 'MESSAGES_LOADING':
      return { ...state, messagesLoading: true, messagesError: null };

    case 'MESSAGES_LOADED': {
      if (action.payload.sessionId && action.payload.sessionId !== state.activeSessionId) return state;
      const targetSessionId = action.payload.sessionId ?? state.activeSessionId;
      const saveEntry = targetSessionId ? state.saves[targetSessionId] : undefined;
      const save = saveEntry?.value;
      const retain = save && (!action.payload.save || action.payload.save.epoch !== save.epoch || action.payload.save.version < save.version);
      const incoming = new Map(action.payload.items.map(item => [item.messageId, item]));
      if (retain) for (const item of state.messages) incoming.set(item.messageId, item);
      const items = [...incoming.values()].sort((a, b) => a.sequence - b.sequence);
      const pendingProvisional = state.messages.filter(
        (m) =>
          m.messageId.startsWith('voice_provisional_') &&
          !action.payload.items.some((serverMsg) => serverMsg.voiceSessionId === m.voiceSessionId),
      );
      const mergedMessages = pendingProvisional.length > 0
        ? [...items.filter(m => !pendingProvisional.some(p => p.messageId === m.messageId)), ...pendingProvisional]
        : items;

      let activeTurnId = state.activeTurnId;
      let activeAttemptId = state.activeAttemptId;
      let activeTurnMode = state.activeTurnMode;
      let turnStatus = state.turnStatus;
      if (!state.isStreaming && !state.isSubmitting) {
        if (action.payload.activeTurn) {
          activeTurnId = action.payload.activeTurn.turnId;
          activeAttemptId = action.payload.activeTurn.attemptId;
          activeTurnMode = action.payload.activeTurn.mode;
          turnStatus = action.payload.activeTurn.status;
        } else if (isBusyAttemptStatus(state.turnStatus)) {
          const settledAssistant = state.activeTurnId
            ? [...mergedMessages].reverse().find(
                (m) =>
                  m.turnId === state.activeTurnId &&
                  m.role === 'assistant' &&
                  ['completed', 'truncated', 'failed', 'cancelled', 'interrupted'].includes(m.completionStatus),
              )
            : undefined;
          activeTurnId = null;
          activeAttemptId = null;
          activeTurnMode = null;
          turnStatus = settledAssistant
            ? (settledAssistant.completionStatus as AttemptStatus)
            : 'idle';
        }
      }

      let next: ChatState = {
        ...state,
        messagesLoading: false,
        messages: mergedMessages,
        messagesCursor: action.payload.nextCursor,
        olderAvailable: action.payload.olderAvailable,
        activeTurnId,
        activeAttemptId,
        activeTurnMode,
        turnStatus,
      };
      if (targetSessionId && action.payload.save) {
        const incomingSave = action.payload.save;
        const staleAtSameVersion =
          save &&
          save.epoch === incomingSave.epoch &&
          save.version === incomingSave.version &&
          save.durableVersion === incomingSave.durableVersion &&
          ['saved', 'failed', 'unknown', 'fenced'].includes(save.state) &&
          ['pending', 'saving'].includes(incomingSave.state);
        if (!staleAtSameVersion) {
          const inferredMode =
            saveEntry?.mode ??
            action.payload.activeTurn?.mode ??
            (mergedMessages.some((m) => m.mode === 'live') ? 'live' : undefined);
          next = chatReducer(next, {
            type: 'SAVE_STATE',
            payload: {
              sessionId: targetSessionId,
              turnId: action.payload.saveTurnId ?? saveEntry?.turnId ?? '',
              save: incomingSave,
              ...(inferredMode ? { mode: inferredMode } : {}),
            },
          });
        }
      }
      return next;
    }

    case 'OLDER_MESSAGES_LOADING':
      return { ...state, loadingOlder: true };

    case 'OLDER_MESSAGES_LOADED':
      return {
        ...state,
        loadingOlder: false,
        messages: [...action.payload.items, ...state.messages],
        messagesCursor: action.payload.nextCursor,
        olderAvailable: action.payload.olderAvailable,
      };

    case 'MESSAGES_ERROR':
      return { ...state, messagesLoading: false, loadingOlder: false, messagesError: action.payload };

    case 'VOICE_SESSION_COMMITTED': {
      if (state.activeSessionId && state.activeSessionId !== action.payload.sessionId) return state;
      const exists = state.messages.some((m) => m.voiceSessionId === action.payload.voiceSessionId);
      if (exists) return state;
      const provisional: VisibleMessage = {
        messageId: `voice_provisional_${action.payload.voiceSessionId}`,
        turnId: `turn_voice_${action.payload.voiceSessionId}`,
        eventId: `evt_voice_${action.payload.voiceSessionId}`,
        sequence: state.messages.length + 1,
        role: 'assistant',
        content: '',
        createdAt: action.payload.createdAt,
        completionStatus: 'completed',
        truncated: false,
        mode: 'live',
        visibility: 'visible',
        voiceSessionId: action.payload.voiceSessionId,
        voiceDurationSeconds: action.payload.durationSeconds,
        voiceTranscripts: [],
      };
      return {
        ...state,
        activeSessionId: state.activeSessionId ?? action.payload.sessionId,
        messages: [...state.messages, provisional],
      };
    }

    case 'TURN_SUBMIT_START': {
      if (state.voiceInput) return state;
      const tempUserMsg: VisibleMessage = {
        messageId: `temp_user_${state.messages.length + 1}`,
        turnId: `temp_turn_${state.messages.length + 1}`,
        eventId: `temp_evt_${state.messages.length + 1}`,
        sequence: state.messages.length + 1,
        role: 'user',
        content: action.payload.userContent,
        createdAt: new Date().toISOString(),
        completionStatus: 'accepted',
        truncated: false,
      };

      return {
        ...state,
        isSubmitting: true,
        turnStatus: 'submitting',
        draftInput: '',
        turnError: null,
        streamText: '',
        calendarProgress: null,
        messages: action.payload.hideFromTranscript
          ? state.messages
          : [...state.messages, tempUserMsg],
      };
    }

    case 'TURN_ACCEPTED': {
      const at = new Date().toISOString();
      const firstInput = state.messages.find(m => m.messageId.startsWith('temp_user_'))?.content ?? 'New chat';
      const existing = state.sessions.find(s => s.sessionId === action.payload.sessionId);
      const messages = state.messages.map((message) => {
        if (!message.messageId.startsWith('temp_user_')) {
          return message;
        }
        return {
          ...message,
          messageId: action.payload.userMessageId,
          turnId: action.payload.turnId,
        };
      });

      return {
        ...state,
        isSubmitting: false,
        isStreaming: true,
        activeSessionId: action.payload.sessionId,
        activeTurnId: action.payload.turnId,
        activeAttemptId: action.payload.attemptId,
        activeTurnMode: 'text',
        turnStatus: 'accepted',
        calendarProgress: null,
        calendarClarification: null,
        calendarLastSequence: -1,
        sessionsRevision: state.sessionsRevision + (action.payload.processEpoch ? 1 : 0),
        localSessionIds: action.payload.processEpoch ? [...new Set([...state.localSessionIds, action.payload.sessionId])] : state.localSessionIds,
        saves: action.payload.processEpoch && state.saves[action.payload.sessionId]?.value.epoch !== action.payload.processEpoch
          ? Object.fromEntries(Object.entries(state.saves).filter(([id]) => id !== action.payload.sessionId)) : state.saves,
        sessions: action.payload.processEpoch ? sortSessions([...state.sessions.filter(s => s.sessionId !== action.payload.sessionId),
          { ...(existing ?? { sessionId: action.payload.sessionId, title: firstInput.slice(0, 80), createdAt: at }), lastActivityAt: at }]) : state.sessions,
        messages,
      };
    }

    case 'TURN_SUBMIT_ERROR':
      return {
        ...state,
        isSubmitting: false,
        turnStatus: 'idle',
        draftInput: state.draftInput.length > 0 ? state.draftInput : action.payload.preservedContent,
        turnError: action.payload.error,
        calendarProgress: null,
        messages: state.messages.filter((m) => !m.messageId.startsWith('temp_')),
      };

    case 'STREAM_DELTA':
      return {
        ...state,
        streamText: action.payload.reset ? action.payload.text : state.streamText + action.payload.text,
      };

    case 'STREAM_STATUS':
      return {
        ...state,
        turnStatus: action.payload.status,
      };

    case 'CALENDAR_PROGRESS':
      if (ignoreCalendarAction(state, action.payload)) {
        return state;
      }
      return {
        ...state,
        calendarProgress: action.payload.phase,
        calendarLastSequence:
          action.payload.sequence !== undefined
            ? action.payload.sequence
            : state.calendarLastSequence,
      };

    case 'CALENDAR_OPERATION': {
      if (ignoreCalendarAction(state, action.payload)) {
        return state;
      }
      const { turnId, operation, sequence } = action.payload;
      const isTerminalOp =
        operation.state === 'succeeded' ||
        operation.state === 'definitely-failed' ||
        operation.state === 'failed' ||
        operation.state === 'cancelled' ||
        operation.state === 'unknown' ||
        operation.state === 'evidence-expired';
      const order = state.calendarTurnOrder.includes(turnId)
        ? state.calendarTurnOrder
        : [...state.calendarTurnOrder, turnId];
      return {
        ...state,
        calendarProgress: isTerminalOp ? null : state.calendarProgress,
        calendarClarification: isTerminalOp ? null : state.calendarClarification,
        calendarOperationsByTurn: {
          ...state.calendarOperationsByTurn,
          [turnId]: operation,
        },
        calendarTurnOrder: order,
        calendarLastSequence:
          sequence !== undefined ? sequence : state.calendarLastSequence,
      };
    }

    case 'CALENDAR_VIEW': {
      if (ignoreCalendarAction(state, action.payload)) return state;
      return {...state,calendarViewsByTurn:{...state.calendarViewsByTurn,[action.payload.turnId]:action.payload.view},
        calendarLastSequence:action.payload.sequence ?? state.calendarLastSequence};
    }

    case 'CALENDAR_CLARIFICATION': {
      if (ignoreCalendarAction(state, action.payload)) {
        return state;
      }
      const clarificationView = action.payload.clarification.view;
      return {
        ...state,
        calendarProgress: null,
        calendarViewsByTurn: clarificationView
          ? { ...state.calendarViewsByTurn, [action.payload.turnId]: clarificationView }
          : state.calendarViewsByTurn,
        calendarClarification: {
          turnId: action.payload.turnId,
          event: action.payload.clarification,
        },
        calendarLastSequence:
          action.payload.sequence !== undefined
            ? action.payload.sequence
            : state.calendarLastSequence,
      };
    }

    case 'STREAM_COMPLETED': {
      const content = action.payload.reset
        ? (action.payload.text ?? '')
        : `${state.streamText}${action.payload.text ?? ''}`;
      const view = action.payload.calendarView ?? (state.activeTurnId ? state.calendarViewsByTurn[state.activeTurnId] : undefined);
      const assistantMsg: VisibleMessage = {
        messageId: action.payload.assistantMessageId,
        turnId: state.activeTurnId ?? 'turn_completed',
        eventId: `evt_${action.payload.assistantMessageId}`,
        sequence: state.messages.length + 1,
        role: 'assistant',
        content,
        createdAt: new Date().toISOString(),
        completionStatus: action.payload.outcome,
        truncated: action.payload.outcome === 'truncated',
        ...(view ? { calendarView: view } : {}),
      };

      const activeCanvasArtifactId = state.activeCanvasArtifactId?.startsWith('streaming_in_flight::canvas::')
        ? state.activeCanvasArtifactId.replace(
            'streaming_in_flight::canvas::',
            `${action.payload.assistantMessageId}::canvas::`,
          )
        : state.activeCanvasArtifactId;

      return {
        ...state,
        isStreaming: false,
        turnStatus: action.payload.outcome,
        streamText: '',
        activeTurnId: null,
        activeAttemptId: null,
        activeTurnMode: null,
        activeCanvasArtifactId,
        calendarProgress: null,
        calendarOperationsByTurn: syncActiveCalendarNarration(state, 'completed'),
        messages: [...state.messages, assistantMsg],
      };
    }

    case 'STREAM_ERROR':
      return {
        ...state,
        isStreaming: false,
        activeTurnMode: null,
        turnStatus: 'failed',
        turnError: action.payload,
        streamText: '',
        calendarProgress: null,
        calendarOperationsByTurn: syncActiveCalendarNarration(state, 'failed'),
        messages: appendTerminalAssistant(state, 'failed', false, `failed_${state.activeTurnId ?? 'turn'}`),
      };

    case 'STREAM_CANCELLED':
      return {
        ...state,
        isStreaming: false,
        activeTurnMode: null,
        turnStatus: 'cancelled',
        streamText: '',
        calendarProgress: null,
        calendarOperationsByTurn: syncActiveCalendarNarration(state, 'interrupted'),
        messages: appendTerminalAssistant(
          state,
          'cancelled',
          false,
          `cancelled_${state.activeTurnId ?? 'turn'}`,
        ),
      };

    case 'STREAM_INTERRUPTED':
      return {
        ...state,
        isStreaming: false,
        activeTurnMode: null,
        turnStatus: 'interrupted',
        streamText: '',
        calendarProgress: null,
        calendarOperationsByTurn: syncActiveCalendarNarration(state, 'interrupted'),
        messages: appendTerminalAssistant(
          state,
          'interrupted',
          false,
          `interrupted_${state.activeTurnId ?? 'turn'}`,
        ),
      };

    default:
      return state;
  }
}
