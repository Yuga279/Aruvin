/**
 * ============================================================================
 * FILE: live-voice-lifecycle.test.ts
 * LOCATION: frontend/src/features/voice/live/live-voice-lifecycle.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for live voice lifecycle event listeners, shortcuts, and focus helpers.
 *
 * ROLE IN PROJECT:
 *    Verifies background/visibility/freeze suspend behavior, pagehide/devicechange exit,
 *    caret/selection focus restoration, and panel keyboard shortcuts.
 *
 * KEY COMPONENTS:
 *    - attachLiveVoiceLifecycle tests
 *    - restoreLiveDraftFocus / focusVoiceSurface tests
 *    - handleLiveVoiceKey tests
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { attachLiveVoiceLifecycle, handleLiveVoiceKey, focusVoiceSurface,
  restoreLiveDraftFocus } from './live-voice-lifecycle.ts';
import { initialLiveVoice } from '../state/live-voice-reducer.ts';

it('hidden/freeze pause; visible does not resume; page destruction/detach tear down', () => {
  const page = Object.assign(new EventTarget(), { hidden: false });
  const browser = new EventTarget(), devices = new EventTarget();
  const suspend = vi.fn(), exit = vi.fn();
  const detach = attachLiveVoiceLifecycle({ suspend, exit }, page, browser, devices);
  page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
  expect(suspend).toHaveBeenCalledTimes(1);
  page.hidden = false; page.dispatchEvent(new Event('visibilitychange'));
  expect(suspend).toHaveBeenCalledTimes(1);
  page.dispatchEvent(new Event('freeze')); expect(suspend).toHaveBeenCalledTimes(2);
  expect(exit).not.toHaveBeenCalled();
  browser.dispatchEvent(new Event('pagehide')); expect(exit).toHaveBeenCalledWith('pagehide');
   devices.dispatchEvent(new Event('devicechange')); expect(exit).not.toHaveBeenCalledWith('error', expect.anything());
  detach(); detach(); page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
  browser.dispatchEvent(new Event('pagehide')); devices.dispatchEvent(new Event('devicechange'));
  expect(suspend).toHaveBeenCalledTimes(2); expect(exit).toHaveBeenCalledWith('unmount');
  expect(exit.mock.calls.filter(([reason]) => reason === 'unmount')).toHaveLength(1);
});

it('focuses the surface and restores the exact committed draft/selection once, never a changed draft', () => {
  const focus = vi.fn(), setSelectionRange = vi.fn();
  focusVoiceSurface({ focus } as unknown as HTMLElement); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  const draft = { text: '🙂 keep me', start: 3, end: 7, direction: 'backward' as const };
  const applied = { current: null as typeof draft | null };
  const textarea = { value: 'not committed', focus, setSelectionRange } as unknown as HTMLTextAreaElement;
  restoreLiveDraftFocus(textarea, draft, applied); expect(setSelectionRange).not.toHaveBeenCalled();
  textarea.value = draft.text; restoreLiveDraftFocus(textarea, draft, applied);
  expect(setSelectionRange).toHaveBeenCalledExactlyOnceWith(3, 7, 'backward');
  restoreLiveDraftFocus(textarea, draft, applied); expect(setSelectionRange).toHaveBeenCalledTimes(1);
});

it('shortcuts are panel-scoped, ignore editors/IME/repeats, and obey the actual button policy', () => {
  const actions = { onMute: vi.fn(), onInterrupt: vi.fn(), onExit: vi.fn() };
  const view = { ...initialLiveVoice, phase: 'active' as const, connection: 'connected' as const,
    response: { turnId: 't1', responseId: 'r1' } };
  const event = { key: 'Escape', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    repeat: false, defaultPrevented: false, isComposing: false, target: null, preventDefault: vi.fn() };
  handleLiveVoiceKey(event, view, actions); expect(actions.onInterrupt).toHaveBeenCalledTimes(1);
  handleLiveVoiceKey({ ...event, key: 'm', altKey: true }, view, actions); expect(actions.onMute).toHaveBeenCalledTimes(1);
  handleLiveVoiceKey({ ...event, key: 'x', altKey: true }, view, actions); expect(actions.onExit).toHaveBeenCalledTimes(1);
  for (const patch of [{ repeat: true }, { isComposing: true }, { ctrlKey: true },
    { target: { closest: () => ({}) } as unknown as EventTarget }]) {
    handleLiveVoiceKey({ ...event, ...patch }, view, actions);
  }
  handleLiveVoiceKey(event, { ...view, response: null }, actions);
  handleLiveVoiceKey({ ...event, key: 'm', altKey: true }, { ...view, input: 'muted', inputBusy: true }, actions);
  expect(actions.onInterrupt).toHaveBeenCalledTimes(1); expect(actions.onMute).toHaveBeenCalledTimes(1);
  handleLiveVoiceKey({ ...event, key: 'm', altKey: true }, { ...view, input: 'listening', inputBusy: true }, actions);
  expect(actions.onMute).toHaveBeenCalledTimes(2);
});

it('Alt+X hangs up a suspended or blocked call and Escape never exits', () => {
  const actions = { onMute: vi.fn(), onInterrupt: vi.fn(), onExit: vi.fn() };
  const event = { key: 'x', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
    repeat: false, defaultPrevented: false, isComposing: false, target: null, preventDefault: vi.fn() };
  handleLiveVoiceKey(event, { ...initialLiveVoice, phase: 'suspended', connection: 'disconnected', canResume: false }, actions);
  handleLiveVoiceKey(event, { ...initialLiveVoice, phase: 'suspended', connection: 'connected', canResume: false }, actions);
  expect(actions.onExit).toHaveBeenCalledTimes(2);
  handleLiveVoiceKey({ ...event, key: 'Escape', altKey: false },
    { ...initialLiveVoice, phase: 'suspended', connection: 'disconnected' }, actions);
  expect(actions.onExit).toHaveBeenCalledTimes(2);
  expect(actions.onInterrupt).not.toHaveBeenCalled();
});
