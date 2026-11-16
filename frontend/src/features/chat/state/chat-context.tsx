/**
 * ============================================================================
 * FILE: chat-context.tsx
 * LOCATION: frontend/src/features/chat/state/chat-context.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    React context provider exposing chat state and orchestration actions.
 *
 * ROLE IN PROJECT:
 *    Lets Sidebar, Transcript, Composer, and ChatView share one reducer and
 *    API client without prop drilling. P9 wraps the assembled view with this.
 *
 * KEY COMPONENTS:
 *    - ChatProvider: Owns reducer, client, session bootstrap, and actions.
 *    - useChat: Typed consumer hook requiring ChatProvider ancestry.
 * ============================================================================
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import { createApiClient, type ApiClient } from '../../../api/client.ts';
import { chatReducer, initialChatState } from './chat-reducer.ts';
import type { ChatAction, ChatState } from './chat-types.ts';
import { useChatActions, type ComposerVoiceLease } from './use-chat.ts';
import type { StreamScheduler } from './stream-delta-coalescer.ts';

type ChatContextValue = {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  actions: ReturnType<typeof useChatActions>;
  client: ApiClient;
  startVoiceConversation?: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({
  children,
  client: propClient,
  startVoiceConversation,
  scheduler,
}: {
  children: ReactNode;
  client?: ApiClient;
  startVoiceConversation?: () => void;
  scheduler?: StreamScheduler;
}) {
  const client = useMemo(() => propClient ?? createApiClient(), [propClient]);
  const [state, reduce] = useReducer(chatReducer, initialChatState);
  const voiceLease = useRef<ComposerVoiceLease | null>(null);
  const dispatch = useCallback((action: ChatAction) => {
    const navigates = action.type === 'NEW_CHAT' || action.type === 'SELECT_SESSION' ||
      (action.type === 'SESSION_DELETED' && action.payload === state.activeSessionId);
    if (navigates && voiceLease.current) {
      const lease = voiceLease.current;
      lease.onClose(); // Controller writes committed text and releases its token first.
      if (voiceLease.current === lease) {
        voiceLease.current = null;
        reduce({ type: 'RELEASE_VOICE_INPUT', payload: lease.token });
      }
    }
    reduce(action);
  }, [state.activeSessionId]);
  const actions = useChatActions(state, dispatch, client, voiceLease, { scheduler });
  const loadSessions = actions.loadSessions;

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const value = useMemo(
    () => ({ state, dispatch, actions, client, startVoiceConversation }),
    [state, dispatch, actions, client, startVoiceConversation],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return ctx;
}
