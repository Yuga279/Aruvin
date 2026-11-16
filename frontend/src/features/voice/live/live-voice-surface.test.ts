/**
 * ============================================================================
 * FILE: live-voice-surface.test.ts
 * LOCATION: frontend/src/features/voice/live/live-voice-surface.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit and SSR tests for LiveVoicePanel and decorative bubble surface.
 *
 * ROLE IN PROJECT:
 *    Verifies accessibility announcements, aria live region, absence of
 *    transcript elements, resume gesture controls, and reduced motion styling.
 *
 * KEY COMPONENTS:
 *    - LiveVoicePanel SSR tests
 *    - Reduced motion and focus CSS assertions
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { handleLiveCanvasShortcut } from '../../canvas/index.ts';
import { LiveVoicePanel } from './LiveVoicePanel.tsx';
import { initialLiveVoice } from '../state/live-voice-reducer.ts';
import type { LiveVoiceSurface } from '../state/useLiveVoice.ts';

const render = (patch: Partial<LiveVoiceSurface['view']> = {}) => renderToStaticMarkup(createElement(LiveVoicePanel, {
  voice: { view: { ...initialLiveVoice, phase: 'active', connection: 'connected', ...patch },
    start: vi.fn(), toggleMute: vi.fn(), interrupt: vi.fn(), exit: vi.fn(), resume: vi.fn() },
}));

it('announces operational dimensions via sr-only status and renders only the animated bubble and icon controls', () => {
  const html = render({ agent: 'speaking', response: { turnId: 't1', responseId: 'r1' } });
  expect(html).toContain('aria-label="Live voice conversation"');
  expect(html).toContain('Listening'); expect(html).toContain('Speaking'); expect(html).toContain('Connected');
  expect(html).toContain('role="status"'); expect(html).toContain('aria-live="polite"');
  expect(html).toContain('aria-atomic="true"'); expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('aurvin-live-bubble-core');
  expect(html).toContain('aurvin-live-bar-1'); expect(html).toContain('aurvin-live-bar-5');
  expect(html).not.toContain('Voice conversation');
  expect(html).not.toContain('Audio is processed');
  expect(html).not.toContain('aurvin-live-pills');
  expect(html).not.toContain('aurvin-live-shortcuts');
  expect(html).not.toContain('textarea'); expect(html).not.toContain('contenteditable');
  expect(html).not.toContain('t1'); expect(html).not.toContain('r1');
});

it('renders permission/connection/recovery states and a native resume gesture', () => {
  expect(render({ phase: 'requesting_permission', connection: 'connecting' })).toContain('Requesting microphone permission');
  expect(render({ phase: 'connecting', connection: 'connecting' })).toContain('Connecting');
  const paused = render({ phase: 'suspended', connection: 'reconnecting', resumeRequired: true });
  expect(paused).toContain('Reconnecting'); expect(paused).toContain('Voice paused');
  expect(paused).toMatch(/<button[^>]*aria-label="Resume voice"[^>]*disabled=""/);
  expect(render({ phase: 'suspended', resumeRequired: true, canResume: true })).toMatch(/aria-label="Resume voice"(?![^>]*disabled)/);
});

it('shows quiet and failed/blocked status visibly without creating a transcript or auto-exit action', () => {
  const quiet = render({ input: 'suspended' })
  expect(quiet).toContain('Listening locally. Audio uploads paused until speech.')
  expect(quiet).not.toContain('aria-label="Resume voice"')
  const paused = render({ phase: 'suspended', resumeRequired: true, canResume: true,
    errorCode: 'MEDIA_GATE_UNAVAILABLE', notice: 'Local speech detection is unavailable.' })
  expect(paused).toMatch(/class="aurvin-live-notice"[^>]*role="status"/)
  expect(paused).toContain('Local speech detection is unavailable.')
  expect(paused).toMatch(/aria-label="Resume voice"(?![^>]*disabled)/)
  const blocked = render({ phase: 'suspended', resumeRequired: true, canResume: false,
    errorCode: 'VOICE_QUOTA_EXHAUSTED', notice: 'The voice limit was reached.' })
  expect(blocked).toContain('The voice limit was reached.')
  expect(blocked).toMatch(/<button[^>]*aria-label="Resume voice"[^>]*disabled=""/)
  expect(blocked).toContain('aria-label="Hang up"')
  expect(blocked).not.toContain('textarea')
});

it('provides reduced motion and visible focus without dropping state labels', () => {
  const css = readFileSync('src/features/voice/live/live-voice.css', 'utf8');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  expect(css).toContain('animation: none'); expect(css).toContain(':focus-visible');
  expect(render({ input: 'muted', agent: 'thinking' })).toContain('Microphone muted');
  expect(render({ input: 'muted', agent: 'thinking' })).toContain('Thinking');
});

it('renders live speaking state without pause suppression when input is muted', () => {
  const html = render({ input: 'muted', agent: 'speaking', response: { turnId: 't1', responseId: 'r1' } });
  expect(html).toContain('Microphone muted');
  expect(html).toContain('Speaking');
  expect(html).toContain('data-paused="false"');
  expect(html).toContain('data-input="muted"');
  expect(html).toContain('data-agent="speaking"');
});

it('renders faithful 23-bar waveform visualizer and mobile-call action buttons', () => {
  const html = render({ agent: 'idle', input: 'listening' });
  for (let i = 1; i <= 23; i++) {
    expect(html).toContain(`aurvin-live-bar-${i}`);
  }
  expect(html).toContain('height="8"');
  expect(html).toContain('aurvin-live-waveform');
  expect(html).toContain('aurvin-live-button-mic');
  expect(html).toContain('aurvin-live-button-hangup');
  const css = readFileSync('src/features/voice/live/live-voice.css', 'utf8');
  expect(css).toContain('background-color: #000000');
  expect(css).toContain('.aurvin-live-button-hangup');
  expect(css).toContain('#fa142e');
});
it('wires Canvas toggle pill on LiveVoicePanel and handles Alt+C shortcut only when artifacts exist', () => {
  const onToggle = vi.fn();
  const html = renderToStaticMarkup(
    createElement(LiveVoicePanel, {
      voice: {
        view: {
          ...initialLiveVoice,
          phase: 'suspended',
          connection: 'connected',
          resumeRequired: true,
        },
        start: vi.fn(),
        toggleMute: vi.fn(),
        interrupt: vi.fn(),
        exit: vi.fn(),
        resume: vi.fn(),
      },
      canvas: { artifactCount: 2, open: true, onToggle },
    }),
  );
  expect(html).toContain('aria-label="Close Canvas (2)"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-controls="aurvin-canvas-panel"');

  const preventDefault = vi.fn();
  const baseKey = {
    key: 'c',
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    target: null,
    preventDefault,
  };
  expect(handleLiveCanvasShortcut(baseKey, { artifactCount: 0, onToggle })).toBe(false);
  expect(onToggle).not.toHaveBeenCalled();

  expect(handleLiveCanvasShortcut(baseKey, { artifactCount: 2, onToggle })).toBe(true);
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(onToggle).toHaveBeenCalledTimes(1);
});
