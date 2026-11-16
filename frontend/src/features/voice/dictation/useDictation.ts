/**
 * ============================================================================
 * FILE: useDictation.ts
 * LOCATION: frontend/src/features/voice/dictation/useDictation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    React hook binding DictationController to Composer textarea and chat state.
 *
 * ROLE IN PROJECT:
 *    Fetches public voice config, manages external store subscriptions,
 *    coordinates selection restoration, and handles visibility/pagehide cleanup.
 *
 * KEY COMPONENTS:
 *    - restoreComposerSelection: Restores cursor and selection range to textarea
 *    - useDictation: Main React hook for dictation controls
 * ============================================================================
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type RefObject } from 'react';
import { VoiceClient, VoiceHttpClient } from '../../../api/voice-client.ts';
import { AudioCaptureService } from '../audio/audio-capture-service.ts';
import { useVoiceCapabilities } from '../state/useVoiceCapabilities.ts';
import { DictationController, type DictationBindings } from './dictation-controller.ts';
import { snapshotDraft, type DraftSelection } from './dictation-draft.ts';

export function restoreComposerSelection(element: HTMLTextAreaElement | null, selection: DraftSelection,
  expectedDraft = element?.value, applied?: { current: DraftSelection | null }) {
  if (!element || element.value !== expectedDraft || applied?.current === selection) return;
  element.focus({ preventScroll: true });
  element.setSelectionRange(selection.start, selection.end, selection.direction);
  if (applied) applied.current = selection;
}

export function useDictation(options: { textareaRef: RefObject<HTMLTextAreaElement | null>;
  draft: string; conversationId: string | null; bindings: DictationBindings }) {
  const latestBindings = useRef(options.bindings);
  useLayoutEffect(() => { latestBindings.current = options.bindings; }, [options.bindings]);
  const appliedSelection = useRef<DraftSelection | null>(null);
  const [http] = useState(() => new VoiceHttpClient());
  const config = useVoiceCapabilities();
  const [controller] = useState(() => new DictationController({ http,
    capture: callbacks => new AudioCaptureService(callbacks),
    client: callbacks => new VoiceClient(callbacks),
    bindings: {
      claimVoiceInput: (mode, onClose) => latestBindings.current.claimVoiceInput(mode, onClose),
      writeVoiceDraft: (token, text) => latestBindings.current.writeVoiceDraft(token, text),
      releaseVoiceInput: token => latestBindings.current.releaseVoiceInput(token),
      isVoiceInputLocked: () => latestBindings.current.isVoiceInputLocked(),
    } }));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    if (view.selection && view.selectionDraft !== null) {
      restoreComposerSelection(options.textareaRef.current, view.selection,
        view.selectionDraft, appliedSelection);
    }
  }, [view.selection, view.selectionDraft, options.draft, options.textareaRef]);

  useEffect(() => {
    const hidden = () => { if (document.hidden) controller.disconnect('DICTATION_FOREGROUND_REQUIRED'); };
    const pagehide = () => controller.disconnect('DICTATION_FOREGROUND_REQUIRED');
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pagehide);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      controller.disconnect();
    };
  }, [controller]);

  const start = () => {
    const element = options.textareaRef.current;
    if (!element || !config?.enabledModes.dictation) return;
    try {
      const snapshot = snapshotDraft(element.value, element.selectionStart, element.selectionEnd,
        element.selectionDirection);
      void controller.start(snapshot, options.conversationId, config);
    } catch { /* Existing 32k character warning remains visible; do not acquire capture. */ }
  };
  const [hiddenNotice, setHiddenNotice] = useState<string | null>(null);
  const locked = ['requesting_permission', 'connecting', 'recording', 'finalizing'].includes(view.phase);
  useEffect(() => {
    if (!view.notice || locked) return;
    const timer = setTimeout(() => setHiddenNotice(view.notice), 6_000);
    return () => {
      clearTimeout(timer);
      setHiddenNotice(null);
    };
  }, [view.notice, locked]);
  const labels = { idle: '', requesting_permission: 'Requesting microphone permission — audio is processed to transcribe your draft',
    connecting: 'Connecting dictation', recording: 'Recording', finalizing: 'Finalizing dictation',
    draft_ready: '' };
  const visibleNotice = view.notice && view.notice !== hiddenNotice ? view.notice : null;
  return { config, locked, phase: view.phase, status: labels[view.phase], notice: visibleNotice,
    start, stop: () => { void controller.stop(); }, cancel: () => controller.cancel() };
}
