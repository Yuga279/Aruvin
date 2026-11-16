/**
 * ============================================================================
 * FILE: ComposerVoiceControls.tsx
 * LOCATION: frontend/src/features/voice/components/ComposerVoiceControls.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Stateless composer voice input controls for dictation and live voice.
 *
 * ROLE IN PROJECT:
 *    Renders independently flagged mic/waveform entry buttons, active recording
 *    Stop/Cancel controls, and accessible live operational status.
 *
 * KEY COMPONENTS:
 *    - ComposerVoiceControls
 *    - ComposerVoiceControlsProps
 * ============================================================================
 */

import { useId } from 'react';
import type { PublicVoiceConfig } from '../../../api/voice-protocol.ts';
import { IconMicrophone, IconStop, IconWaveform } from '../../../components/icons.tsx';
import '../dictation/composer-voice-controls.css';

export type ComposerVoiceControlsProps = {
  config: PublicVoiceConfig | null;
  locked: boolean;
  recording: boolean;
  finalizing: boolean;
  textBusy: boolean;
  otherMode: boolean;
  status: string;
  notice: string | null;
  onDictate: () => void;
  onLive?: () => void;
  onStop: () => void;
  onCancel: () => void;
};

export function ComposerVoiceControls(props: ComposerVoiceControlsProps) {
  const descriptionId = useId();
  const enabled = props.config?.enabledModes;
  if (!enabled?.dictation && !enabled?.live && !props.locked && !props.notice) return null;
  const disabled = props.locked || props.textBusy || props.otherMode;
  return (
    <div className="aurvin-voice-controls" role="group" aria-label="Voice input">
      {enabled?.dictation ? (
        <button type="button" className="aurvin-voice-btn" aria-label="Dictate message"
          aria-describedby={descriptionId} title="Audio is processed to transcribe a draft. You choose when to send."
          disabled={disabled} onClick={props.onDictate}>
          <IconMicrophone />
        </button>
      ) : null}
      {enabled?.live ? (
        <button type="button" className="aurvin-voice-btn" aria-label="Start voice conversation"
          title="Start live voice conversation"
          disabled={disabled || !props.onLive} onClick={props.onLive}>
          <IconWaveform />
        </button>
      ) : null}
      {props.locked ? (
        <>
          <button type="button" className="aurvin-voice-btn" aria-label="Stop dictation"
            disabled={!props.recording || props.finalizing} onClick={props.onStop}>
            <IconStop /> Stop
          </button>
          <button type="button" className="aurvin-voice-btn" aria-label="Cancel dictation"
            onClick={props.onCancel}>Cancel</button>
        </>
      ) : null}
      <span id={descriptionId} className="aurvin-voice-description">
        Audio is processed to transcribe your message. Nothing is sent until you select Send.
      </span>
      {props.status || props.notice ? (
        <span className="aurvin-voice-status" role="status" aria-live="polite" aria-atomic="true">
          {props.recording ? <span aria-hidden="true">■ </span> : null}
          {props.status}{props.status && props.notice ? ` — ${props.notice}` : props.notice ?? ''}
        </span>
      ) : null}
    </div>
  );
}
