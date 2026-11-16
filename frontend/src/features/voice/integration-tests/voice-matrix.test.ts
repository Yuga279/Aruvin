/**
 * ============================================================================
 * FILE: voice-matrix.test.ts
 * LOCATION: frontend/src/features/voice/integration-tests/voice-matrix.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integrated frontend test matrix covering permission, audio lifecycle, keyboard, and SSR.
 *
 * ROLE IN PROJECT:
 *    Tests dictation draft insertion/cancellation and the real LiveKit client/controller
 *    over SDK doubles, plus accessibility, keyboard, SSR, and page-lifecycle behavior.
 *
 * KEY COMPONENTS:
 *    - matrixFixture: Integrates LiveKitVoiceClient with deterministic Room/media doubles
 *    - LiveVoicePanel static rendering and CSS contracts
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { matrixFixture } from './matrix-fixture.ts';
import { dictationFixture, settle } from '../dictation/testing/dictation-fixture.ts';
import { LiveVoicePanel } from '../live/LiveVoicePanel.tsx';
import { handleLiveVoiceKey, attachLiveVoiceLifecycle } from '../live/live-voice-lifecycle.ts';

it('denied LiveKit microphone permission allocates no session and keeps the original editable draft', async () => {
  const f = matrixFixture('denied');
  try {
    await f.controller.start({ text: 'Unsent original', start: 7, end: 15, direction: 'backward' }, null, f.config);
    await settle();
    expect(f.rtc.microphone).toHaveBeenCalledOnce();
    expect(f.http.create).not.toHaveBeenCalled();
    expect(f.draft()).toBe('Unsent original');
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: true, resumeRequired: true });
    expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().notice).toContain('denied');
  } finally { f.controller.exit(); await settle(); }
});

it('granted LiveKit microphone is captured once, mute never replays, and closes resources once', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    expect(f.rtc.microphone).toHaveBeenCalledOnce();
    expect(f.rtc.participant.publishTrack).toHaveBeenCalledOnce();
    expect(f.rtc.mediaTrack.enabled).toBe(true);
    await f.controller.toggleMute();
    expect(f.rtc.mediaTrack.enabled).toBe(false);
    await f.controller.toggleMute();
    expect(f.rtc.mediaTrack.enabled).toBe(false);
    f.listening(); await settle();
    expect(f.rtc.mediaTrack.enabled).toBe(true);
    expect(f.rtc.microphone).toHaveBeenCalledOnce();
    f.controller.exit(); f.controller.exit(); await settle();
    expect(f.rtc.mic.stop).toHaveBeenCalledOnce();
    expect(f.rtc.room.disconnect).toHaveBeenCalledOnce();
    expect(f.http.end).toHaveBeenCalledOnce();
  } finally { f.controller.exit(); await settle(); }
});

it('dictation edits only its selection and live exit restores that unsent draft without submitting it', async () => {
  const d = dictationFixture();
  await d.begin();
  d.event({ type: 'dictation.partial', segmentId: 'one', text: 'Not 12' });
  d.event({ type: 'dictation.partial', segmentId: 'one', text: 'Not 13' });
  d.event({ type: 'dictation.final', segmentId: 'one', text: 'Not 13.' });
  d.event({ type: 'dictation.final', segmentId: 'one', text: 'Not 13.' });
  expect(d.text()).toBe('Before Not 13. after');
  await d.controller.stop();
  expect(d.controller.getSnapshot().phase).toBe('finalizing');
  d.event({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
  expect(d.controller.getSnapshot().phase).toBe('draft_ready');
  const f = matrixFixture('granted');
  const draft = d.text();
  try {
    await f.controller.start({ text: draft, start: 7, end: 14, direction: 'backward' }, 'chat-1', f.config);
    const dispose = vi.spyOn(f.client(), 'dispose');
    f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
    await settle();
    expect(f.http.create).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'chat-1', mode: 'live' }), expect.any(AbortSignal));
    expect(JSON.stringify(f.http.create.mock.calls)).not.toContain(draft);
    f.close(); // Simulates the existing chat lease's session-navigation callback.
    await settle();
    expect(f.draft()).toBe(draft);
    expect(f.http.end).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  } finally { d.controller.cancel(); f.controller.exit(); await settle(); }
});

it('keyboard shortcuts use real live actions and text-input/IME events stay isolated', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    f.attach();
    f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000,
      firstAudioSequence: 0, firstAudioSample: 0 });
    expect(f.rtc.audio.muted).toBe(false);
    const key = (name: string, altKey = false, isComposing = false) => ({ key: name, altKey, isComposing,
      ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, defaultPrevented: false,
      target: null, preventDefault: vi.fn() });
    const actions = { onMute: () => { void f.controller.toggleMute(); },
      onInterrupt: () => f.controller.interrupt(), onExit: () => f.controller.exit() };
    const textKey = { ...key('x', true), target: {
      closest: () => ({}),
    } as unknown as EventTarget };
    handleLiveVoiceKey(textKey, f.controller.getSnapshot(), actions);
    expect(f.controller.getSnapshot().phase).toBe('active');
    handleLiveVoiceKey(key('Escape', false, true), f.controller.getSnapshot(), actions);
    expect(f.rtc.audio.muted).toBe(false);
    handleLiveVoiceKey(key('Escape'), f.controller.getSnapshot(), actions);
    expect(f.rtc.audio.muted).toBe(true);
    expect(f.track.detach).toHaveBeenCalledTimes(2);
    handleLiveVoiceKey(key('m', true), f.controller.getSnapshot(), actions); await settle();
    expect(f.controller.getSnapshot().input).toBe('muted');
    handleLiveVoiceKey(key('x', true), f.controller.getSnapshot(), actions); await settle();
    expect(f.controller.getSnapshot().phase).toBe('idle');
  } finally { f.controller.exit(); await settle(); }
});

it('renders operational state without transcript or draft and supplies a reduced-motion alternative', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    const html = renderToStaticMarkup(createElement(LiveVoicePanel, { voice: {
      view: f.controller.getSnapshot(), start: vi.fn(), toggleMute: vi.fn(), interrupt: vi.fn(), exit: vi.fn(), resume: vi.fn(),
    } }));
    expect(html).toContain('aria-label="Live voice conversation"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/textarea|contenteditable|Unsent original|PRIVATE voice transcript/);
    const css = readFileSync('src/features/voice/live/live-voice.css', 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation: none');
    expect(css).toContain(':focus-visible');
  } finally { f.controller.exit(); await settle(); }
});

it('backgrounding silences audio and capture and foregrounding requires an explicit gesture', async () => {
  const f = matrixFixture('granted');
  const page = Object.assign(new EventTarget(), { hidden: false }), browser = new EventTarget();
  const detach = attachLiveVoiceLifecycle(f.controller, page, browser);
  try {
    await f.begin(); page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(f.rtc.mic.stop).toHaveBeenCalledOnce();
    expect(f.controller.getSnapshot().resumeRequired).toBe(true);
    page.hidden = false; page.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(f.rtc.microphone).toHaveBeenCalledOnce(); // Merely visible does not resume.
    expect(f.controller.getSnapshot().phase).toBe('suspended');
    browser.dispatchEvent(new Event('pagehide')); await settle();
    expect(f.rtc.room.disconnect).toHaveBeenCalledOnce();
  } finally { detach(); await settle(); }
});
