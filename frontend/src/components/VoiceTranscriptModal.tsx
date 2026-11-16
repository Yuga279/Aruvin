/**
 * ============================================================================
 * FILE: VoiceTranscriptModal.tsx
 * LOCATION: frontend/src/components/VoiceTranscriptModal.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Hovering modal window displaying voice conversation transcripts and Canvas visuals.
 *
 * ROLE IN PROJECT:
 *    Renders the transcripts of a committed voice session inside a blurred modal window
 *    using standard chat bubbles for user and assistant utterances, with Canvas artifact
 *    cards for diagrams and graphs generated during the voice call.
 *
 * KEY COMPONENTS:
 *    - VoiceTranscriptModal: Modal dialog with backdrop blur, keyboard trap, and bubbles.
 *    - formatVoiceDuration: Formats seconds into human-readable duration string.
 * ============================================================================
 */

import { useEffect, useRef } from 'react';
import { isCalendarView } from '../api/calendar-protocol.ts';
import type { VoiceTranscriptItem } from '../api/protocol.ts';
import {
  CanvasArtifactCard,
  calendarViewArtifact,
  projectionToCanvasArtifact,
  type CanvasArtifact,
} from '../features/canvas/index.ts';
import { SafeMarkdown } from '../features/chat/markdown/safe-markdown.tsx';

export function formatVoiceDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || seconds < 0) return '0s';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

export type VoiceTranscriptModalProps = {
  durationSeconds?: number;
  transcripts: VoiceTranscriptItem[];
  activeArtifactId?: string | null;
  onOpenArtifact?: (artifactId: string) => void;
  onClose: () => void;
};

export function VoiceTranscriptModal({
  durationSeconds,
  transcripts,
  activeArtifactId = null,
  onOpenArtifact,
  onClose,
}: VoiceTranscriptModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const durationText = formatVoiceDuration(durationSeconds);

  const handleOpenArtifact = (artifactId: string) => {
    onOpenArtifact?.(artifactId);
    onClose();
  };

  return (
    <div
      className="aurvin-voice-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="aurvin-voice-modal-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aurvin-voice-modal-title"
      >
        <header className="aurvin-voice-modal-header">
          <h2 id="aurvin-voice-modal-title" className="aurvin-voice-modal-title">
            <span className="aurvin-voice-chat-waveform" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1.5" y="5" width="2" height="6" rx="1" />
                <rect x="5.5" y="2" width="2" height="12" rx="1" />
                <rect x="9.5" y="4" width="2" height="8" rx="1" />
                <rect x="13.5" y="6" width="2" height="4" rx="1" />
              </svg>
            </span>
            <span>{durationSeconds === undefined ? 'Voice message' : `Voice Chat · ${durationText}`}</span>
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="aurvin-voice-modal-close"
            onClick={onClose}
            aria-label="Close transcript"
          >
            ×
          </button>
        </header>

        <div className="aurvin-voice-modal-body">
          {durationSeconds === undefined ? <p>Generated transcript, not proof that audio was heard.</p> : null}
          {transcripts.length === 0 ? (
            <p className="aurvin-voice-empty">No voice conversation transcript recorded.</p>
          ) : (
            transcripts.map((item, index) => {
              const isUser = item.role === 'user';
              const itemArtifacts = item.canvasArtifacts?.length
                ? item.canvasArtifacts
                    .map((proj) => projectionToCanvasArtifact(proj, item.messageId ?? `voice_item_${index}`))
                    .filter((a): a is CanvasArtifact => a !== null)
                : [];
              if (item.role === 'assistant' && item.calendarView && item.messageId && item.turnId && isCalendarView(item.calendarView)) {
                itemArtifacts.push(calendarViewArtifact(item.calendarView,item.messageId,item.turnId));
              }
              return (
                <article
                  key={index}
                  className={`aurvin-message ${isUser ? 'aurvin-message-user' : 'aurvin-message-assistant'}`}
                  data-role={item.role}
                >
                  {isUser ? (
                    <div className="aurvin-bubble">{item.content}</div>
                  ) : (
                    <div className="aurvin-message-body">
                      <div className="aurvin-message-content">
                        {item.content ? (
                          <SafeMarkdown
                            content={item.content}
                            messageId={item.messageId ?? `voice_item_${index}`}
                            activeArtifactId={activeArtifactId}
                            onOpenArtifact={handleOpenArtifact}
                          />
                        ) : null}
                        {itemArtifacts.map((artifact) => (
                          <CanvasArtifactCard
                            key={artifact.artifactId}
                            artifact={artifact}
                            isActive={activeArtifactId === artifact.artifactId}
                            onOpen={handleOpenArtifact}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
