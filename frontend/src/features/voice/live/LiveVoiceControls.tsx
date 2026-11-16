/**
 * ============================================================================
 * FILE: LiveVoiceControls.tsx
 * LOCATION: frontend/src/features/voice/live/LiveVoiceControls.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Accessible mobile-call style control bar for live voice and Canvas toggle.
 *
 * ROLE IN PROJECT:
 *    Renders circular Microphone (Mute/Unmute), active-speech Stop speaking,
 *    session Canvas toggle pill with unique artifact count badge, and Hang up
 *    controls without disturbing capture, socket, or playback lifecycles.
 *
 * KEY COMPONENTS:
 *    - LiveVoiceControls: Action group for mic, interrupt, Canvas, and hang up.
 *    - LiveVoiceControlsProps: Prop interface for live call controls.
 * ============================================================================
 */

import type { Ref } from 'react';
import type { LiveVoiceState } from '../state/live-voice-reducer.ts';

export type LiveVoiceControlsProps = {
  view: LiveVoiceState;
  onMute: () => void;
  onInterrupt?: () => void;
  onExit: () => void;
  canvasArtifactCount?: number;
  canvasOpen?: boolean;
  onToggleCanvas?: () => void;
  canvasToggleRef?: Ref<HTMLButtonElement>;
};

export function LiveVoiceControls(props: LiveVoiceControlsProps) {
  const { view, onToggleCanvas, canvasToggleRef } = props;
  const usable = view.phase === 'active' && view.connection === 'connected' && !view.resumeRequired;
  const isMuted = view.input === 'muted';
  const muteLabel = isMuted ? 'Unmute microphone' : 'Mute microphone';
  const canInterrupt = usable && Boolean(view.response) && Boolean(props.onInterrupt);
  const artifactCount = props.canvasArtifactCount ?? 0;
  const showCanvasToggle = artifactCount > 0 && Boolean(onToggleCanvas);
  const canvasOpen = Boolean(props.canvasOpen);

  return (
    <div className="aurvin-live-controls" role="group" aria-label="Live voice controls">
      <button
        type="button"
        className="aurvin-live-button aurvin-live-button-mic"
        aria-label={muteLabel}
        aria-keyshortcuts="Alt+M"
        aria-pressed={isMuted}
        disabled={!usable || (view.inputBusy && isMuted)}
        onClick={props.onMute}
      >
        {isMuted ? (
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M18.89 13.23A7.12 7.12 0 0 0 19 11v-1" />
            <path d="M5 10v1a7 7 0 0 0 12 5" />
            <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
            <path d="M9 9v2a3 3 0 0 0 5.12 2.12" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="8" y1="22" x2="16" y2="22" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="17" x2="12" y2="21" />
            <line x1="8" y1="21" x2="16" y2="21" />
          </svg>
        )}
      </button>

      {canInterrupt ? (
        <button
          type="button"
          className="aurvin-live-button aurvin-live-button-interrupt"
          aria-label="Stop speaking"
          aria-keyshortcuts="Escape"
          onClick={props.onInterrupt}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="6" y="6" width="12" height="12" rx="2.5" />
          </svg>
        </button>
      ) : null}

      {showCanvasToggle ? (
        <button
          ref={canvasToggleRef}
          type="button"
          className="aurvin-live-canvas-toggle"
          data-open={canvasOpen ? 'true' : 'false'}
          aria-label={
            canvasOpen
              ? `Close Canvas (${artifactCount})`
              : `Open Canvas (${artifactCount})`
          }
          aria-expanded={canvasOpen}
          aria-controls="aurvin-canvas-panel"
          aria-keyshortcuts="Alt+C"
          onClick={onToggleCanvas}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M14 4v16" />
          </svg>
          <span className="aurvin-live-canvas-label">Canvas</span>
          <span className="aurvin-live-canvas-count">{artifactCount}</span>
        </button>
      ) : null}

      <button
        type="button"
        className="aurvin-live-button aurvin-live-button-hangup"
        aria-label="Hang up"
        aria-keyshortcuts="Alt+X"
        onClick={props.onExit}
      >
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C2.5 9.4 6.98 8 12 8s9.5 1.4 11.71 3.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </svg>
      </button>
    </div>
  );
}
