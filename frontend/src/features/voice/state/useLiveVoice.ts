/**
 * ============================================================================
 * FILE: useLiveVoice.ts
 * LOCATION: frontend/src/features/voice/state/useLiveVoice.ts
 * ============================================================================
 *
 * PURPOSE:
 *    React external store hook binding LiveVoiceController to the UI.
 *
 * ROLE IN PROJECT:
 *    Exposes live voice state and actions without opening media, Rooms, or sockets
 *    during render or effect execution. Live mode constructs only the LiveKit
 *    WebRTC client; dictation keeps its own PCM composition elsewhere.
 *
 * KEY COMPONENTS:
 *    - useLiveVoice: React hook using useSyncExternalStore.
 *    - supportsLiveVoice: Live-only secure-context/media/WebRTC support probe.
 *    - snapshotLiveDraft: Helper capturing UTF-16 textarea selection.
 *    - LiveVoiceSurface: Return type for ChatView and LiveVoicePanel consumption.
 * ============================================================================
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LiveKitVoiceClient } from '../../../api/livekit-voice-client.ts';
import { VoiceHttpClient } from '../../../api/voice-client.ts';
import type { CalendarConfirmPayload } from '../../../api/voice-protocol.ts';
import { attachLiveVoiceLifecycle } from '../live/live-voice-lifecycle.ts';
import { LiveVoiceController, type LiveVoiceBindings } from './live-voice-controller.ts';
import type { LiveDraft, LiveVoiceState } from './live-voice-reducer.ts';
import { useVoiceCapabilities } from './useVoiceCapabilities.ts';

/**
 * Live-only support probe, evaluated at activation. `mediaDevices` lives on `navigator`,
 * not on `globalThis`, so the default scope reads both from their real homes.
 */
export function supportsLiveVoice(
  scope: { isSecureContext?: boolean; mediaDevices?: { getUserMedia?: unknown } } =
    { isSecureContext: globalThis.isSecureContext, mediaDevices: globalThis.navigator?.mediaDevices },
  rtc: unknown = (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection,
): boolean {
  return scope.isSecureContext === true && typeof scope.mediaDevices?.getUserMedia === 'function' && typeof rtc === 'function';
}

export function snapshotLiveDraft(element: HTMLTextAreaElement | null, fallback: string): LiveDraft {
  const text = element?.value ?? fallback;
  return { text, start: element?.selectionStart ?? text.length, end: element?.selectionEnd ?? text.length,
    direction: element?.selectionDirection ?? 'none' };
}

export function useLiveVoice(options: {
  conversationId: string | null; draft: string; bindings: LiveVoiceBindings;
}) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; }, [options]);
  const [http] = useState(() => new VoiceHttpClient());
  const config = useVoiceCapabilities();
  const [controller] = useState(() => new LiveVoiceController({ http,
    client: callbacks => new LiveKitVoiceClient(callbacks),
    support: () => supportsLiveVoice(),
    bindings: {
      claimVoiceInput: (mode, onClose) => latest.current.bindings.claimVoiceInput(mode, onClose),
      writeVoiceDraft: (token, text) => latest.current.bindings.writeVoiceDraft(token, text),
      releaseVoiceInput: token => latest.current.bindings.releaseVoiceInput(token),
      bindVoiceConversation: (token, id, meta) =>
        meta
          ? latest.current.bindings.bindVoiceConversation(token, id, meta)
          : latest.current.bindings.bindVoiceConversation(token, id),
      refreshSessions: (
        id?: string,
        voiceSession?: { voiceSessionId: string; durationSeconds: number; startedAt: string },
      ) => latest.current.bindings.refreshSessions(id, voiceSession),
      getActiveConversationId: () => latest.current.bindings.getActiveConversationId?.() ?? null,
      openCanvasArtifact: (artifactId) =>
        latest.current.bindings.openCanvasArtifact?.(artifactId),
    } }));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => attachLiveVoiceLifecycle(controller, document, window, navigator.mediaDevices), [controller]);
  const start = () => {
    if (!config?.enabledModes.live || document.hidden) return;
    const current = latest.current;
    const draft = snapshotLiveDraft(document.querySelector<HTMLTextAreaElement>('.aurvin-textarea'), current.draft);
    void controller.start(draft, current.conversationId, config);
  };
  return { view, start, toggleMute: () => { void controller.toggleMute(); },
    interrupt: () => controller.interrupt(), exit: () => controller.exit(),
    resume: () => { if (!document.hidden) void controller.resume(); },
    confirmCalendar: (proposalId: string, revision: number, answer: CalendarConfirmPayload['answer']) =>
      controller.confirmCalendar(proposalId, revision, answer),
    getVolume: () => controller.getVolume() };
}

export type LiveVoiceSurface = {
  view: LiveVoiceState;
  start: () => void;
  toggleMute: () => void;
  interrupt: () => void;
  exit: () => void;
  resume: () => void;
  confirmCalendar?: (proposalId: string, revision: number, answer: CalendarConfirmPayload['answer']) => boolean;
  getVolume?: () => number;
};
