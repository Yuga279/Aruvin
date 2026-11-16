/**
 * ============================================================================
 * FILE: live-voice-lifecycle.ts
 * LOCATION: frontend/src/features/voice/live/live-voice-lifecycle.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Lifecycle listeners, keyboard shortcuts, and focus management for live voice.
 *
 * ROLE IN PROJECT:
 *    Attaches window/document visibility and device listeners, manages
 *    panel-scoped keyboard shortcuts (Alt+M, Escape, Alt+X), and restores
 *    draft textarea caret and focus upon session exit.
 *
 * KEY COMPONENTS:
 *    - attachLiveVoiceLifecycle: Window/document event lifecycle attacher.
 *    - handleLiveVoiceKey: Scoped keydown event handler for shortcuts.
 *    - focusVoiceSurface: Sets initial focus to the live voice heading.
 *    - restoreLiveDraftFocus: Focuses textarea and restores UTF-16 caret selection.
 * ============================================================================
 */

import type { LiveExitReason } from '../state/live-voice-controller.ts';
import type { LiveDraft, LiveVoiceState } from '../state/live-voice-reducer.ts';

type Lifecycle = { suspend: () => void; exit: (reason: LiveExitReason, notice?: string) => void };

export function attachLiveVoiceLifecycle(controller: Lifecycle,
  page: EventTarget & { hidden: boolean }, browser: EventTarget, _devices?: EventTarget) {
  const hidden = () => { if (page.hidden) controller.suspend(); };
  const freeze = () => controller.suspend();
  const leave = () => controller.exit('pagehide');
  // Capture owns the active track's ended event. Unrelated device changes are not loss.
  page.addEventListener('visibilitychange', hidden); page.addEventListener('freeze', freeze);
  browser.addEventListener('pagehide', leave);
  let detached = false;
  return () => {
    if (detached) return; detached = true;
    page.removeEventListener('visibilitychange', hidden); page.removeEventListener('freeze', freeze);
    browser.removeEventListener('pagehide', leave);
    controller.exit('unmount');
  };
}

type VoiceKey = { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
  repeat: boolean; defaultPrevented: boolean; isComposing: boolean; target: EventTarget | null;
  preventDefault: () => void };
type KeyActions = { onMute: () => void; onInterrupt: () => void; onExit: () => void };

export function handleLiveVoiceKey(event: VoiceKey, view: LiveVoiceState, actions: KeyActions) {
  const target = event.target as Element | null;
  if (event.repeat || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey ||
    target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const usable = view.phase === 'active' && view.connection === 'connected' && !view.resumeRequired;
  let action: (() => void) | undefined;
  if (event.key === 'Escape' && !event.altKey && usable && view.response) action = actions.onInterrupt;
  if (event.altKey && event.key.toLowerCase() === 'm' && usable && (!view.inputBusy || view.input !== 'muted')) action = actions.onMute;
  if (event.altKey && event.key.toLowerCase() === 'x') action = actions.onExit;
  if (action) { event.preventDefault(); action(); }
}

export function focusVoiceSurface(element: HTMLElement | null) { element?.focus({ preventScroll: true }); }

export function restoreLiveDraftFocus(element: HTMLTextAreaElement | null, draft: LiveDraft | null,
  applied: { current: LiveDraft | null }) {
  if (!element || !draft || element.value !== draft.text || applied.current === draft) return;
  element.focus({ preventScroll: true });
  element.setSelectionRange(draft.start, draft.end, draft.direction); applied.current = draft;
}
