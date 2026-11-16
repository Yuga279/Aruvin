/**
 * ============================================================================
 * FILE: Transcript.tsx
 * LOCATION: frontend/src/components/Transcript.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Conversation log with older-message paging and a streaming bubble.
 *
 * ROLE IN PROJECT:
 *    Hosts the durable UI archive plus the in-flight assistant draft, using
 *    ScrollController so live tokens only follow the reader near the bottom.
 *
 * KEY COMPONENTS:
 *    - Load older messages control
 *    - MessageItem list
 *    - Streaming assistant placeholder
 *    - Inline turn extensions (e.g. Calendar activity)
 * ============================================================================
 */

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useChat } from '../features/chat/state/chat-context.tsx';
import { hideCalendarConfirmReplies } from '../features/plugins/google-calendar/CalendarTurnRegion.tsx';
import { groupVoiceMessages } from './group-voice-messages.ts';
import { MessageItem } from './MessageItem.tsx';
import { PromptTraveler } from './PromptTraveler.tsx';
import { ScrollController } from './ScrollController.tsx';

export function Transcript({ children }: { children?: ReactNode } = {}) {
  const { state, actions, dispatch } = useChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const onOpenArtifact = useCallback((artifactId: string) => {
    dispatch({ type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId } });
  }, [dispatch]);
  const messageActions = { activeArtifactId: state.canvasOpen ? state.activeCanvasArtifactId : null,
    onOpenArtifact, onRetry: actions.retryTurn };
  const scrollDependencies = useMemo(() => [
    state.messages,
    state.streamText,
    state.turnStatus,
    state.calendarClarification,
    state.calendarProgress,
  ], [
    state.messages,
    state.streamText,
    state.turnStatus,
    state.calendarClarification,
    state.calendarProgress,
  ]);

  const displayMessages = useMemo(
    () => groupVoiceMessages(hideCalendarConfirmReplies(state.messages)),
    [state.messages],
  );

  return (
    <div className="aurvin-transcript-stage">
      <div
        ref={containerRef}
        className="aurvin-transcript"
        role="log"
        aria-label="Conversation transcript"
        aria-live="polite"
      >
        {state.olderAvailable ? (
          <div className="aurvin-transcript-toolbar">
            <button
              type="button"
              className="aurvin-quiet-btn"
              onClick={() => {
                void actions.loadOlderMessages();
              }}
              disabled={state.loadingOlder}
            >
              {state.loadingOlder ? 'Loading older messages…' : 'Load older messages'}
            </button>
          </div>
        ) : null}

        {displayMessages.map((message) => (
          <MessageItem key={message.messageId} message={message} {...messageActions} />
        ))}

        {state.isStreaming ||
        ((state.turnStatus === 'accepted' ||
          state.turnStatus === 'generating' ||
          state.turnStatus === 'finalizing') &&
          state.activeTurnMode !== 'live' &&
          Boolean(state.activeTurnId)) ? (
          <MessageItem
            {...messageActions}
            liveStatus={state.turnStatus}
            message={{
              messageId: 'streaming_in_flight',
              turnId: state.activeTurnId ?? 'turn_streaming',
              eventId: 'evt_streaming',
              sequence: state.messages.length + 1,
              role: 'assistant',
              content: state.streamText,
              createdAt: '',
              completionStatus: 'streaming',
              truncated: false,
            }}
          />
        ) : null}

        {children}

        <ScrollController
          scrollContainerRef={containerRef}
          dependencies={scrollDependencies}
        />
      </div>

      <PromptTraveler scrollContainerRef={containerRef} messages={displayMessages} />
    </div>
  );
}
