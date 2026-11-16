/**
 * ============================================================================
 * FILE: LiveVoicePanel.tsx
 * LOCATION: frontend/src/features/voice/live/LiveVoicePanel.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Main surface panel for transcript-free live duplex voice conversation.
 *
 * ROLE IN PROJECT:
 *    Presents the animated voice bubble, screen-reader-only aria-live status
 *    announcements, and minimal icon/Canvas controls without visible text clutter.
 *
 * KEY COMPONENTS:
 *    - LiveVoicePanel: Dedicated voice page region with Canvas toggle support.
 *    - liveVoiceLabels: Maps LiveVoiceState to accessible screen-reader strings.
 * ============================================================================
 */

import { useLayoutEffect, useRef, type Ref, type RefObject } from 'react';
import { handleLiveCanvasShortcut } from '../../canvas/index.ts';
import type { LiveVoiceSurface } from '../state/useLiveVoice.ts';
import { LiveVoiceBubble } from './LiveVoiceBubble.tsx';
import { LiveVoiceControls } from './LiveVoiceControls.tsx';
import { focusVoiceSurface, handleLiveVoiceKey } from './live-voice-lifecycle.ts';
import './live-voice.css';

export type LiveVoiceCanvasControl = {
  artifactCount: number;
  open: boolean;
  onToggle: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
};

export function liveVoiceLabels(view: LiveVoiceSurface['view']) {
  const connection = {
    connecting: 'Connecting',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    disconnected: 'Disconnected',
  }[view.connection];
  const input = view.resumeRequired
    ? 'Voice paused'
    : view.input === 'muted'
      ? 'Microphone muted'
      : view.input === 'suspended'
        ? 'Listening locally; uploads paused'
        : view.phase === 'active'
          ? 'Listening'
          : 'Microphone starting';
  const agent = { idle: 'Ready', thinking: 'Thinking', speaking: 'Speaking' }[view.agent];
  const phase =
    view.phase === 'requesting_permission'
      ? 'Requesting microphone permission'
      : view.phase === 'connecting'
        ? 'Connecting voice'
        : 'Live voice';
  return { phase, connection, input, agent };
}

export function LiveVoicePanel({
  voice,
  canvas,
  surfaceRef,
}: {
  voice: LiveVoiceSurface;
  canvas?: LiveVoiceCanvasControl;
  surfaceRef?: RefObject<HTMLElement | null>;
}) {
  const internalSurface = useRef<HTMLElement | null>(null);
  const surface = surfaceRef ?? internalSurface;
  useLayoutEffect(() => {
    focusVoiceSurface(surface.current);
  }, [surface]);
  const labels = liveVoiceLabels(voice.view);
  return (
    <section
      ref={surface}
      tabIndex={-1}
      className="aurvin-live-panel"
      aria-label="Live voice conversation"
      onKeyDown={(event) => {
        const keyEvent = {
          key: event.key,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          defaultPrevented: event.defaultPrevented,
          isComposing: event.nativeEvent.isComposing,
          target: event.target,
          preventDefault: () => event.preventDefault(),
        };
        if (handleLiveCanvasShortcut(keyEvent, canvas)) {
          return;
        }
        handleLiveVoiceKey(keyEvent, voice.view, {
          onMute: voice.toggleMute,
          onInterrupt: voice.interrupt,
          onExit: voice.exit,
        });
      }}
    >
      <LiveVoiceBubble view={voice.view} getVolume={voice.getVolume} />
      <p className="aurvin-live-status sr-only" role="status" aria-live="polite" aria-atomic="true">
        {labels.phase}. {labels.connection}. {labels.input}. {labels.agent}.
      </p>
      {voice.view.notice || voice.view.input === 'suspended' ? (
        <p className="aurvin-live-notice" role="status" aria-live="polite" aria-atomic="true">
          {voice.view.notice ?? 'Listening locally. Audio uploads paused until speech.'}
        </p>
      ) : null}
      {voice.view.resumeRequired ? (
        <button
          type="button"
          className="aurvin-live-button"
          aria-label="Resume voice"
          disabled={!voice.view.canResume || voice.view.inputBusy}
          onClick={voice.resume}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M8 5.5v13l11-6.5-11-6.5z" />
          </svg>
        </button>
      ) : null}
      <LiveVoiceControls
        view={voice.view}
        onMute={voice.toggleMute}
        onInterrupt={voice.interrupt}
        onExit={voice.exit}
        canvasArtifactCount={canvas?.artifactCount}
        canvasOpen={canvas?.open}
        onToggleCanvas={canvas?.onToggle}
        canvasToggleRef={canvas?.toggleRef}
      />
    </section>
  );
}
