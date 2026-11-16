/**
 * ============================================================================
 * FILE: use-chat.ts
 * LOCATION: frontend/src/features/chat/state/use-chat.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Orchestrate API calls, SSE streaming, cancellation, retry, and selection.
 *
 * ROLE IN PROJECT:
 *    Turns reducer actions into network workflows while enforcing one active
 *    generation, UUID idempotency keys, delta coalescing, and draft-preserving submit errors.
 *    Stale submit/retry cleanup cannot overwrite a newer draft or coalescer.
 *
 * KEY COMPONENTS:
 *    - useChatActions: Session load, submit, cancel, retry, and older paging.
 *    - Generation token: old abort/error/finally no-op when a newer turn owns the hook.
 *    - Post-turn session reconcile: no GET on the send path; known rows idle-reconcile
 *      via SESSION_UPDATED; abort/defer on send, navigation, and unmount.
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useRef, type Dispatch, type RefObject } from 'react';
import { ApiClientError, type ApiClient } from '../../../api/client.ts';
import type {
  CalendarCompatibleEnvelope,
  CalendarStreamEvent,
  CalendarStreamEventV3,
} from '../../../api/calendar-protocol.ts';
import type { SaveStateSnapshot } from '../../../api/protocol.ts';
import type { ChatAction, ChatState } from './chat-types.ts';
import {
  StreamDeltaCoalescer,
  type StreamScheduler,
} from './stream-delta-coalescer.ts';

const SESSION_LIST_RECONCILE_IDLE_MS = 250;

function isTurnBusy(status: ChatState['turnStatus']): boolean {
  return status === 'accepted' || status === 'generating' || status === 'finalizing';
}

export function startSavePollEffect(params: {
  client: ApiClient;
  dispatch: Dispatch<ChatAction>;
  sessionId: string | null;
  activeSave: ChatState['saves'][string] | undefined;
  isStreaming: boolean;
}): (() => void) | undefined {
  const { client, dispatch, sessionId, activeSave, isStreaming } = params;
  const savePending = activeSave?.value.state === 'pending' || activeSave?.value.state === 'saving';
  if (!sessionId || !activeSave || !savePending || isStreaming) return undefined;
  const { turnId, value, mode } = activeSave;
  let cancelled = false;
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let useLiveList = mode === 'live' || !turnId;
  const check = async () => {
    try {
      if (!useLiveList) {
        try {
          const status = await client.getTurnStatus(sessionId, turnId);
          if (cancelled) return;
          if (status.save?.epoch === value.epoch && status.save.version >= value.version) {
            dispatch({ type: 'SAVE_STATE', payload: { sessionId, turnId, save: status.save, mode: 'text' } });
          }
          if (status.save && !['pending', 'saving'].includes(status.save.state)) return;
        } catch (err) {
          if (err instanceof ApiClientError && err.code === 'NOT_FOUND') {
            useLiveList = true;
          } else {
            throw err;
          }
        }
      }
      if (useLiveList) {
        const res = await client.listMessages(sessionId, { limit: 1 });
        if (cancelled) return;
        if (res.save?.epoch === value.epoch && res.save.version >= value.version) {
          dispatch({
            type: 'SAVE_STATE',
            payload: { sessionId, turnId: res.saveTurnId ?? turnId, save: res.save, mode: 'live' },
          });
        }
        if (res.save && !['pending', 'saving'].includes(res.save.state)) return;
      }
    } catch {
      /* Keep the last honest save facts; a network error is not a save failure. */
    }
    if (!cancelled && ++count < 10) {
      timer = setTimeout(() => {
        void check();
      }, 2000);
    }
  };
  timer = setTimeout(() => {
    void check();
  }, 1000);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

export function startRestoredBusyPollEffect(params: {
  client: ApiClient;
  dispatch: Dispatch<ChatAction>;
  sessionId: string | null;
  activeTurnId: string | null;
  turnStatus: ChatState['turnStatus'];
  mode: ChatState['activeTurnMode'];
  isStreaming: boolean;
  isSubmitting: boolean;
}): (() => void) | undefined {
  const { client, dispatch, sessionId, activeTurnId, turnStatus, mode, isStreaming, isSubmitting } = params;
  if (!sessionId || !activeTurnId || isStreaming || isSubmitting || !isTurnBusy(turnStatus)) {
    return undefined;
  }
  let cancelled = false;
  let count = 0;
  let currentStatus = turnStatus;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async () => {
    try {
      if (mode === 'live') {
        const res = await client.listMessages(sessionId);
        if (cancelled) return;
        dispatch({
          type: 'MESSAGES_LOADED',
          payload: {
            items: res.items,
            nextCursor: res.nextCursor,
            olderAvailable: res.olderAvailable,
            sessionId,
            save: res.save,
            saveTurnId: res.saveTurnId,
            activeTurn: res.activeTurn,
          },
        });
        if (!res.activeTurn) return;
      } else {
        const status = await client.getTurnStatus(sessionId, activeTurnId);
        if (cancelled) return;
        if (status.save) {
          dispatch({
            type: 'SAVE_STATE',
            payload: { sessionId, turnId: activeTurnId, save: status.save, mode: 'text' },
          });
        }
        if (isTurnBusy(status.status)) {
          if (status.status !== currentStatus) {
            currentStatus = status.status;
            dispatch({ type: 'STREAM_STATUS', payload: { status: status.status, truncated: status.truncated } });
          }
        } else {
          const res = await client.listMessages(sessionId);
          if (cancelled) return;
          dispatch({
            type: 'MESSAGES_LOADED',
            payload: {
              items: res.items,
              nextCursor: res.nextCursor,
              olderAvailable: res.olderAvailable,
              sessionId,
              save: res.save ?? status.save,
              saveTurnId: res.saveTurnId ?? activeTurnId,
              activeTurn: res.activeTurn,
            },
          });
          if (!res.activeTurn) {
            if (status.status === 'failed' && status.error) {
              dispatch({ type: 'STREAM_ERROR', payload: status.error });
            }
            return;
          }
        }
      }
    } catch {
      /* Transient poll errors preserve honest busy state up to the finite poll ceiling. */
    }
    if (!cancelled && ++count < 15) {
      timer = setTimeout(() => {
        void check();
      }, 1000);
    }
  };
  timer = setTimeout(() => {
    void check();
  }, 1000);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

export type ComposerVoiceLease = {
  token: string;
  mode: 'dictation' | 'live';
  onClose: () => void;
  conversationId?: string | null;
};

export interface UseChatActionsOptions {
  scheduler?: StreamScheduler;
}

function toClientError(err: unknown, fallbackCode: string, fallbackMessage: string) {
  if (err instanceof ApiClientError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  return {
    code: fallbackCode,
    message: err instanceof Error ? err.message : fallbackMessage,
    retryable: true,
  };
}

export function useChatActions(
  state: ChatState,
  dispatch: Dispatch<ChatAction>,
  client: ApiClient,
  providedVoiceLease?: RefObject<ComposerVoiceLease | null>,
  options?: UseChatActionsOptions,
) {
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const localVoiceLease = useRef<ComposerVoiceLease | null>(null);
  const voiceLease = providedVoiceLease ?? localVoiceLease;

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const coalescerRef = useRef<StreamDeltaCoalescer | null>(null);
  if (!coalescerRef.current) {
    coalescerRef.current = new StreamDeltaCoalescer({
      onFlush: (payload) => {
        dispatchRef.current({
          type: 'STREAM_DELTA',
          payload: { text: payload.text, ...(payload.reset ? { reset: true } : {}) },
        });
      },
      scheduler: options?.scheduler,
    });
  }
  const coalescer = coalescerRef.current;
  const generationRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    dispatch({ type: 'SUBMISSION_RECOVERY', payload: client.submissionRecovery });
    dispatch({ type: 'RETRY_RECOVERY', payload: client.retryRecovery });
  }, [client, dispatch]);
  const activeSave = state.activeSessionId ? state.saves?.[state.activeSessionId] : undefined;
  const savePending = activeSave?.value.state === 'pending' || activeSave?.value.state === 'saving';
  useEffect(() => startSavePollEffect({
    client,
    dispatch,
    sessionId: state.activeSessionId,
    activeSave,
    isStreaming: state.isStreaming,
  }), [client, dispatch, state.activeSessionId, activeSave, savePending, state.isStreaming]);
  const restoredBusy = !state.isStreaming && !state.isSubmitting && isTurnBusy(state.turnStatus) && Boolean(state.activeTurnId);
  useEffect(() => startRestoredBusyPollEffect({
    client,
    dispatch,
    sessionId: state.activeSessionId,
    activeTurnId: state.activeTurnId,
    turnStatus: state.turnStatus,
    mode: state.activeTurnMode,
    isStreaming: state.isStreaming,
    isSubmitting: state.isSubmitting,
  }), [client, dispatch, state.activeSessionId, state.activeTurnId, state.turnStatus, state.activeTurnMode, restoredBusy, state.isStreaming, state.isSubmitting]);
  const sessionsReconcileAbortRef = useRef<AbortController | null>(null);
  const sessionsReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReconcileSessionIdRef = useRef<string | null>(null);
  const reconcileSessionsAfterTurnRef = useRef<(sessionId: string) => void>(() => {});
  const invalidateSessionReconcileForNavigationRef = useRef<() => void>(() => {});

  useEffect(() => {
    return () => {
      coalescer.cancel();
      if (sessionsReconcileTimerRef.current !== null) {
        clearTimeout(sessionsReconcileTimerRef.current);
        sessionsReconcileTimerRef.current = null;
      }
      sessionsReconcileAbortRef.current?.abort();
      sessionsReconcileAbortRef.current = null;
      pendingReconcileSessionIdRef.current = null;
    };
  }, [coalescer]);

  const isVoiceInputLocked = useCallback(() => voiceLease.current !== null, [voiceLease]);
  const claimVoiceInput = useCallback((mode: 'dictation' | 'live', onClose: () => void) => {
    if (voiceLease.current || activeAbortControllerRef.current || state.voiceInput || state.isStreaming || state.isSubmitting ||
      isTurnBusy(state.turnStatus) || state.messagesLoading) return null;
    const token = crypto.randomUUID();
    voiceLease.current = { token, mode, onClose, conversationId: state.activeSessionId };
    dispatch({ type: 'CLAIM_VOICE_INPUT', payload: { token, mode } });
    return token;
  }, [dispatch, voiceLease, state.voiceInput, state.isStreaming, state.isSubmitting,
    state.turnStatus, state.messagesLoading, state.activeSessionId]);
  const writeVoiceDraft = useCallback((token: string, text: string) => {
    if (voiceLease.current?.token !== token) return false;
    dispatch({ type: 'VOICE_DRAFT', payload: { token, text } });
    return true;
  }, [dispatch, voiceLease]);
  const releaseVoiceInput = useCallback((token: string) => {
    if (voiceLease.current?.token !== token) return;
    voiceLease.current = null;
    dispatch({ type: 'RELEASE_VOICE_INPUT', payload: token });
  }, [dispatch, voiceLease]);
  const bindVoiceConversation = useCallback((
    token: string,
    conversationId: string,
    meta?: { turnId: string; save: SaveStateSnapshot },
  ) => {
    if (voiceLease.current?.token !== token || voiceLease.current?.mode !== 'live') return false;
    const currentBound = voiceLease.current.conversationId ?? state.activeSessionId;
    if (currentBound && currentBound !== conversationId) return false;
    voiceLease.current = { ...voiceLease.current, conversationId };
    dispatch({
      type: 'BIND_VOICE_CONVERSATION',
      payload: {
        token,
        conversationId,
        ...(meta ? { turnId: meta.turnId, save: meta.save } : {}),
      },
    });
    return true;
  }, [dispatch, voiceLease, state.activeSessionId]);

  const dispatchStreamEvent = useCallback(
    (
      event: CalendarStreamEvent | CalendarStreamEventV3,
      envelope: CalendarCompatibleEnvelope,
    ) => {
      if (event.type === 'delta') {
        coalescer.bufferDelta(event.text, event.reset, {
          sessionId: envelope.sessionId,
          turnId: envelope.turnId,
          attemptId: envelope.attemptId,
        });
      } else if (event.type === 'completed') {
        const flushed = coalescer.drain();
        dispatch({
          type: 'STREAM_COMPLETED',
          payload: {
            assistantMessageId: event.assistantMessageId,
            outcome: event.outcome,
            ...(flushed.text || flushed.reset
              ? { text: flushed.text, ...(flushed.reset ? { reset: true as const } : {}) }
              : {}),
            ...(event.calendarView ? { calendarView: event.calendarView } : {}),
          },
        });
        if (!event.save) reconcileSessionsAfterTurnRef.current(envelope.sessionId);
      } else if (event.type === 'calendar-view') {
        dispatch({
          type: 'CALENDAR_VIEW',
          payload: {
            sessionId: envelope.sessionId,
            turnId: envelope.turnId,
            attemptId: envelope.attemptId,
            sequence: envelope.sequence,
            view: event.view,
          },
        });
        return;
      } else {
        coalescer.flush();
        if (event.type === 'status') {
          dispatch({ type: 'STREAM_STATUS', payload: { status: event.status, truncated: event.truncated } });
        } else if (event.type === 'calendar-progress') {
          dispatch({
            type: 'CALENDAR_PROGRESS',
            payload: {
              turnId: envelope.turnId,
              sessionId: envelope.sessionId,
              attemptId: envelope.attemptId,
              sequence: envelope.sequence,
              phase: event.phase,
            },
          });
        } else if (event.type === 'calendar-operation') {
          dispatch({
            type: 'CALENDAR_OPERATION',
            payload: {
              turnId: envelope.turnId,
              sessionId: envelope.sessionId,
              attemptId: envelope.attemptId,
              sequence: envelope.sequence,
              operation: event.operation,
            },
          });
        } else if (event.type === 'calendar-clarification') {
          dispatch({
            type: 'CALENDAR_CLARIFICATION',
            payload: {
              turnId: envelope.turnId,
              sessionId: envelope.sessionId,
              attemptId: envelope.attemptId,
              sequence: envelope.sequence,
              clarification: event,
            },
          });
        } else if (event.type === 'error') {
          dispatch({
            type: 'STREAM_ERROR',
            payload: { code: event.code, message: event.message, retryable: event.retryable },
          });
        }
      }
      if ((event.type === 'status' || event.type === 'completed') && event.save)
        dispatch({ type: 'SAVE_STATE', payload: { sessionId: envelope.sessionId, turnId: envelope.turnId, save: event.save, mode: 'text' } });
    },
    [dispatch, coalescer],
  );

  const dispatchStreamTransportError = useCallback(
    (err: ApiClientError) => {
      coalescer.flush();
      if (err.code === 'STREAM_INTERRUPTED' || err.code === 'INTERRUPTED') {
        dispatch({ type: 'STREAM_INTERRUPTED' });
        return;
      }
      if (err.code === 'ABORTED' || err.code === 'CANCELLED') {
        dispatch({ type: 'STREAM_CANCELLED' });
        return;
      }
      dispatch({
        type: 'STREAM_ERROR',
        payload: { code: err.code, message: err.message, retryable: err.retryable },
      });
    },
    [dispatch, coalescer],
  );

  const startNewChat = useCallback(() => {
    generationRef.current += 1;
    invalidateSessionReconcileForNavigationRef.current();
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    coalescer.cancel();
    dispatch({ type: 'NEW_CHAT' });
  }, [dispatch, coalescer]);

  const selectSession = useCallback(
    async (sessionId: string, title: string) => {
      const generation = ++generationRef.current;
      invalidateSessionReconcileForNavigationRef.current();
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }
      coalescer.cancel();

      dispatch({ type: 'SELECT_SESSION', payload: { sessionId, title } });
      try {
        const response = await client.listMessages(sessionId);
        if (generation !== generationRef.current) return;
        dispatch({
          type: 'MESSAGES_LOADED',
          payload: {
            items: response.items,
            nextCursor: response.nextCursor,
            olderAvailable: response.olderAvailable,
            sessionId,
            save: response.save,
            saveTurnId: response.saveTurnId,
            activeTurn: response.activeTurn,
          },
        });
      } catch (err: unknown) {
        if (generation !== generationRef.current) return;
        dispatch({
          type: 'MESSAGES_ERROR',
          payload: err instanceof Error ? err.message : 'Failed to load messages',
        });
      }
    },
    [client, dispatch, coalescer],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!state.activeSessionId || !state.messagesCursor || state.loadingOlder) {
      return;
    }

    dispatch({ type: 'OLDER_MESSAGES_LOADING' });
    try {
      const response = await client.listMessages(state.activeSessionId, {
        cursor: state.messagesCursor,
      });
      if (stateRef.current.activeSessionId !== state.activeSessionId) return;
      dispatch({
        type: 'OLDER_MESSAGES_LOADED',
        payload: {
          items: response.items,
          nextCursor: response.nextCursor,
          olderAvailable: response.olderAvailable,
        },
      });
    } catch (err: unknown) {
      dispatch({
        type: 'MESSAGES_ERROR',
        payload: err instanceof Error ? err.message : 'Failed to load older messages',
      });
    }
  }, [client, dispatch, state.activeSessionId, state.messagesCursor, state.loadingOlder]);

  const loadSessions = useCallback(async () => {
    const revision = stateRef.current.sessionsRevision;
    dispatch({ type: 'SESSIONS_LOADING' });
    try {
      const response = await client.listSessions();
      dispatch({
        type: 'SESSIONS_LOADED',
        payload: { items: response.items, nextCursor: response.nextCursor, revision },
      });
    } catch (err: unknown) {
      dispatch({
        type: 'SESSIONS_ERROR',
        payload: err instanceof Error ? err.message : 'Failed to load sessions',
      });
    }
  }, [client, dispatch]);

  const abortSessionReconcileFetch = useCallback(() => {
    sessionsReconcileAbortRef.current?.abort();
    sessionsReconcileAbortRef.current = null;
  }, []);

  const clearSessionReconcileTimer = useCallback(() => {
    if (sessionsReconcileTimerRef.current !== null) {
      clearTimeout(sessionsReconcileTimerRef.current);
      sessionsReconcileTimerRef.current = null;
    }
  }, []);

  const abortSessionReconcile = useCallback(() => {
    clearSessionReconcileTimer();
    abortSessionReconcileFetch();
  }, [abortSessionReconcileFetch, clearSessionReconcileTimer]);

  const startSessionReconcileFetch = useCallback(
    (sessionId: string) => {
      abortSessionReconcileFetch();
      const ac = new AbortController();
      sessionsReconcileAbortRef.current = ac;
      void (async () => {
        try {
          const response = await client.listSessions({ signal: ac.signal });
          if (sessionsReconcileAbortRef.current !== ac) {
            return;
          }
          if (stateRef.current.isSubmitting || stateRef.current.isStreaming) {
            return;
          }
          const known = stateRef.current.sessions.some((item) => item.sessionId === sessionId);
          if (known) {
            const item = response.items.find((row) => row.sessionId === sessionId);
            if (item) {
              dispatch({ type: 'SESSION_UPDATED', payload: item });
            }
            return;
          }
          dispatch({
            type: 'SESSIONS_LOADED',
            payload: { items: response.items, nextCursor: response.nextCursor },
          });
        } catch (err: unknown) {
          if (ac.signal.aborted) {
            return;
          }
          if (err instanceof ApiClientError && (err.code === 'ABORTED' || err.code === 'CANCELLED')) {
            return;
          }
          dispatch({
            type: 'SESSIONS_ERROR',
            payload: err instanceof Error ? err.message : 'Failed to load sessions',
          });
        } finally {
          if (sessionsReconcileAbortRef.current === ac) {
            sessionsReconcileAbortRef.current = null;
          }
        }
      })();
    },
    [abortSessionReconcileFetch, client, dispatch],
  );

  const scheduleKnownSessionReconcile = useCallback(
    (sessionId: string) => {
      pendingReconcileSessionIdRef.current = sessionId;
      clearSessionReconcileTimer();
      sessionsReconcileTimerRef.current = setTimeout(() => {
        sessionsReconcileTimerRef.current = null;
        if (stateRef.current.isSubmitting || stateRef.current.isStreaming) {
          return;
        }
        const pendingId = pendingReconcileSessionIdRef.current;
        if (!pendingId) {
          return;
        }
        startSessionReconcileFetch(pendingId);
      }, SESSION_LIST_RECONCILE_IDLE_MS);
    },
    [clearSessionReconcileTimer, startSessionReconcileFetch],
  );

  reconcileSessionsAfterTurnRef.current = (sessionId: string) => {
    pendingReconcileSessionIdRef.current = sessionId;
    if (stateRef.current.sessions.some((item) => item.sessionId === sessionId)) {
      scheduleKnownSessionReconcile(sessionId);
      return;
    }
    clearSessionReconcileTimer();
    startSessionReconcileFetch(sessionId);
  };

  invalidateSessionReconcileForNavigationRef.current = () => {
    abortSessionReconcileFetch();
    const pendingId = pendingReconcileSessionIdRef.current;
    if (!pendingId) {
      clearSessionReconcileTimer();
      return;
    }
    scheduleKnownSessionReconcile(pendingId);
  };

  const reloadMessages = useCallback(
    async (sessionId?: string) => {
      const targetSessionId = sessionId ?? state.activeSessionId;
      if (!targetSessionId) return;

      dispatch({ type: 'MESSAGES_LOADING' });
      try {
        const response = await client.listMessages(targetSessionId);
        if (stateRef.current.activeSessionId !== targetSessionId) return;
        dispatch({
          type: 'MESSAGES_LOADED',
          payload: {
            items: response.items,
            nextCursor: response.nextCursor,
            olderAvailable: response.olderAvailable,
            sessionId: targetSessionId,
            save: response.save,
            saveTurnId: response.saveTurnId,
            activeTurn: response.activeTurn,
          },
        });
      } catch (err: unknown) {
        dispatch({
          type: 'MESSAGES_ERROR',
          payload: err instanceof Error ? err.message : 'Failed to load messages',
        });
      }
    },
    [client, dispatch, state.activeSessionId],
  );

  const commitVoiceSession = useCallback(
    (payload: { sessionId: string; voiceSessionId: string; durationSeconds: number; createdAt: string }) => {
      dispatch({ type: 'VOICE_SESSION_COMMITTED', payload });
    },
    [dispatch],
  );

  const loadMoreSessions = useCallback(async () => {
    if (!state.sessionsCursor || state.sessionsLoading) {
      return;
    }
    try {
      const response = await client.listSessions({ cursor: state.sessionsCursor });
      dispatch({
        type: 'SESSIONS_APPENDED',
        payload: { items: response.items, nextCursor: response.nextCursor },
      });
    } catch (err: unknown) {
      dispatch({
        type: 'SESSIONS_ERROR',
        payload: err instanceof Error ? err.message : 'Failed to load more sessions',
      });
    }
  }, [client, dispatch, state.sessionsCursor, state.sessionsLoading]);

  const submitMessage = useCallback(
    async (contentToSend?: string, options?: { hideFromTranscript?: boolean }) => {
      const raw = contentToSend ?? state.draftInput;
      const text = raw.trim();
      if (!text || raw.length > 32_000 || voiceLease.current || state.voiceInput ||
        state.isStreaming || state.isSubmitting || isTurnBusy(state.turnStatus)) {
        return;
      }

      const idempotencyKey = crypto.randomUUID();
      const generation = ++generationRef.current;
      const proposal = options?.hideFromTranscript ? state.calendarClarification?.event : undefined;
      abortSessionReconcile();
      dispatch({
        type: 'TURN_SUBMIT_START',
        payload: {
          userContent: text,
          idempotencyKey,
          ...(options?.hideFromTranscript ? { hideFromTranscript: true } : {}),
        },
      });

      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      try {
        const response = await client.submitTurn(
          {
            sessionId: state.activeSessionId,
            content: text,
            idempotencyKey,
            calendarProtocol: 2,
            ...(proposal?.proposalRevision !== undefined ? { calendarReplyTo: {
              proposalId: proposal.proposalId, revision: proposal.proposalRevision,
            } } : {}),
          },
          { signal: abortController.signal },
        );
        dispatch({ type: 'SUBMISSION_RECOVERY', payload: client.submissionRecovery });
        if (generationRef.current !== generation || abortController.signal.aborted) return;

        coalescer.attachTurn({
          sessionId: response.sessionId,
          turnId: response.turnId,
          attemptId: response.attemptId,
        });

        dispatch({
          type: 'TURN_ACCEPTED',
          payload: {
            sessionId: response.sessionId,
            turnId: response.turnId,
            attemptId: response.attemptId,
            userMessageId: response.userMessageId,
            processEpoch: response.processEpoch,
          },
        });

        await client.connectTurnStream(
          response.streamPath,
          {
            onEvent: (event, envelope) => {
              if (generationRef.current !== generation || abortController.signal.aborted) {
                return;
              }
              if (
                envelope.sessionId !== response.sessionId ||
                envelope.turnId !== response.turnId ||
                envelope.attemptId !== response.attemptId
              ) {
                return;
              }
              dispatchStreamEvent(event, envelope);
            },
            onError: (err) => {
              if (generationRef.current !== generation || abortController.signal.aborted) {
                return;
              }
              dispatchStreamTransportError(err);
            },
          },
          { signal: abortController.signal },
        );
      } catch (err: unknown) {
        dispatch({ type: 'SUBMISSION_RECOVERY', payload: client.submissionRecovery });
        if (generationRef.current !== generation) {
          return;
        }
        if (abortController.signal.aborted) {
          coalescer.cancel();
          dispatch({ type: 'STREAM_CANCELLED' });
          return;
        }
        coalescer.cancel();
        dispatch({
          type: 'TURN_SUBMIT_ERROR',
          payload: {
            error: toClientError(err, 'SUBMIT_FAILED', 'Submission failed'),
            preservedContent: options?.hideFromTranscript ? '' : text,
          },
        });
      } finally {
        if (activeAbortControllerRef.current === abortController) {
          activeAbortControllerRef.current = null;
        }
        if (generationRef.current === generation) {
          coalescer.cancel();
        }
      }
    },
    [
      client,
      dispatch,
      dispatchStreamEvent,
      dispatchStreamTransportError,
      abortSessionReconcile,
      state.activeSessionId,
      state.calendarClarification,
      state.draftInput,
      state.isStreaming,
      state.isSubmitting,
      state.turnStatus,
      state.voiceInput,
      voiceLease,
      coalescer,
    ],
  );

  const restoreSubmission = useCallback(async () => {
    const request = client.submissionRecovery;
    if (!request || activeAbortControllerRef.current || voiceLease.current) return;
    if (request.sessionId === null) startNewChat();
    else if (request.sessionId !== stateRef.current.activeSessionId)
      await selectSession(request.sessionId, stateRef.current.sessions.find(s => s.sessionId === request.sessionId)?.title ?? 'Recovered chat');
    dispatch({ type: 'SET_DRAFT', payload: request.content });
  }, [client, dispatch, selectSession, startNewChat, voiceLease]);
  const allowNewAttempt = useCallback(() => {
    if (activeAbortControllerRef.current || voiceLease.current) return;
    client.discardSubmissionRecovery();
    dispatch({ type: 'SUBMISSION_RECOVERY', payload: null });
    dispatch({ type: 'RETRY_RECOVERY', payload: null });
  }, [client, dispatch, voiceLease]);
  const retrySave = useCallback(async () => {
    const current = stateRef.current, sessionId = current.activeSessionId;
    const save = sessionId ? current.saves[sessionId] : undefined;
    if (!sessionId || !save) return;
    const status = await client.retrySave(sessionId, save.turnId, { epoch: save.value.epoch, version: save.value.version });
    if (status.save) {
      dispatch({
        type: 'SAVE_STATE',
        payload: { sessionId, turnId: save.turnId, save: status.save, ...(save.mode ? { mode: save.mode } : {}) },
      });
    }
  }, [client, dispatch]);

  const cancelCurrentTurn = useCallback(async () => {
    generationRef.current += 1;
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }

    coalescer.flush();
    coalescer.cancel();

    if (state.activeSessionId && state.activeTurnId && state.activeAttemptId) {
      try {
        await client.cancelTurn(state.activeSessionId, state.activeTurnId, state.activeAttemptId);
      } catch {
        // Best effort cancellation; UI still records cancelled.
      }
    }
    dispatch({ type: 'STREAM_CANCELLED' });
  }, [client, dispatch, state.activeAttemptId, state.activeSessionId, state.activeTurnId, coalescer]);

  const retryTurn = useCallback(
    async (turnId: string, targetSessionId?: string) => {
      const sessionId = targetSessionId ?? stateRef.current.activeSessionId;
      if (!sessionId || voiceLease.current || stateRef.current.voiceInput ||
        stateRef.current.isStreaming || stateRef.current.isSubmitting ||
        isTurnBusy(stateRef.current.turnStatus)) {
        return;
      }

      const idempotencyKey = crypto.randomUUID();
      const generation = ++generationRef.current;
      abortSessionReconcile();
      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      dispatch({ type: 'STREAM_STATUS', payload: { status: 'generating', truncated: false } });

      try {
        const response = await client.retryTurn(
          sessionId,
          turnId,
          { idempotencyKey, calendarProtocol: 2 },
          { signal: abortController.signal },
        );
        dispatch({ type: 'RETRY_RECOVERY', payload: client.retryRecovery });

        coalescer.attachTurn({
          sessionId: response.sessionId,
          turnId: response.turnId,
          attemptId: response.attemptId,
        });

        dispatch({
          type: 'TURN_ACCEPTED',
          payload: {
            sessionId: response.sessionId,
            turnId: response.turnId,
            attemptId: response.attemptId,
            userMessageId: response.userMessageId,
            processEpoch: response.processEpoch,
          },
        });

        await client.connectTurnStream(
          response.streamPath,
          {
            onEvent: (event, envelope) => {
              if (generationRef.current !== generation || abortController.signal.aborted) {
                return;
              }
              if (
                envelope.sessionId !== response.sessionId ||
                envelope.turnId !== response.turnId ||
                envelope.attemptId !== response.attemptId
              ) {
                return;
              }
              dispatchStreamEvent(event, envelope);
            },
            onError: (err) => {
              if (generationRef.current !== generation || abortController.signal.aborted) {
                return;
              }
              dispatchStreamTransportError(err);
            },
          },
          { signal: abortController.signal },
        );
      } catch (err: unknown) {
        dispatch({ type: 'RETRY_RECOVERY', payload: client.retryRecovery });
        if (generationRef.current !== generation) {
          return;
        }
        if (abortController.signal.aborted) {
          coalescer.cancel();
          dispatch({ type: 'STREAM_CANCELLED' });
          return;
        }
        coalescer.cancel();
        dispatch({
          type: 'STREAM_ERROR',
          payload: toClientError(err, 'RETRY_FAILED', 'Retry failed'),
        });
      } finally {
        if (activeAbortControllerRef.current === abortController) {
          activeAbortControllerRef.current = null;
        }
        if (generationRef.current === generation) {
          coalescer.cancel();
        }
      }
    },
    [
      client,
      dispatch,
      dispatchStreamEvent,
      dispatchStreamTransportError,
      abortSessionReconcile,
      voiceLease,
      coalescer,
    ],
  );

  const retryRecoveredTurn = useCallback(async () => {
    const pending = client.retryRecovery;
    if (!pending || activeAbortControllerRef.current || voiceLease.current) return;
    if (pending.sessionId !== stateRef.current.activeSessionId) {
      await selectSession(
        pending.sessionId,
        stateRef.current.sessions.find((s) => s.sessionId === pending.sessionId)?.title ?? 'Recovered chat',
      );
    }
    await retryTurn(pending.turnId, pending.sessionId);
  }, [client, retryTurn, selectSession, voiceLease]);

  const setDraft = useCallback(
    (value: string) => {
      if (!voiceLease.current && !state.voiceInput) dispatch({ type: 'SET_DRAFT', payload: value });
    },
    [dispatch, voiceLease, state.voiceInput],
  );

  return useMemo(
    () => ({
      startNewChat,
      selectSession,
      loadSessions,
      loadMoreSessions,
      loadOlderMessages,
      reloadMessages,
      commitVoiceSession,
      submitMessage,
      restoreSubmission,
      retryRecoveredTurn,
      allowNewAttempt,
      retrySave,
      cancelCurrentTurn,
      retryTurn,
      setDraft,
      isVoiceInputLocked,
      claimVoiceInput,
      writeVoiceDraft,
      releaseVoiceInput,
      bindVoiceConversation,
    }),
    [
      startNewChat,
      selectSession,
      loadSessions,
      loadMoreSessions,
      loadOlderMessages,
      reloadMessages,
      commitVoiceSession,
      submitMessage,
      restoreSubmission,
      retryRecoveredTurn,
      allowNewAttempt,
      retrySave,
      cancelCurrentTurn,
      retryTurn,
      setDraft,
      isVoiceInputLocked,
      claimVoiceInput,
      writeVoiceDraft,
      releaseVoiceInput,
      bindVoiceConversation,
    ],
  );
}
