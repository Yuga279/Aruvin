/**
 * ============================================================================
 * FILE: controls.test.ts
 * LOCATION: frontend/src/features/voice/dictation/controls.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for ComposerVoiceControls static rendering and accessibility.
 *
 * ROLE IN PROJECT:
 *    Verifies independent mode flag rendering, accessible labels, button
 *    states, and live status announcements.
 *
 * KEY COMPONENTS:
 *    - ComposerVoiceControls test suite
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO,
  type PublicVoiceConfig } from '../../../api/voice-protocol.ts';
import { ComposerVoiceControls } from '../components/ComposerVoiceControls.tsx';

const config: PublicVoiceConfig = { protocolVersion: 1,
  enabledModes: { dictation: true, live: true }, supportedLocales: ['en-US'],
  limits: { ...DEFAULT_VOICE_LIMITS }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
const base = { config, locked: false, recording: false, finalizing: false,
  textBusy: false, otherMode: false, status: '', notice: null,
  onDictate: vi.fn(), onLive: vi.fn(), onStop: vi.fn(), onCancel: vi.fn() };
const render = (props: Partial<typeof base> = {}) =>
  renderToStaticMarkup(createElement(ComposerVoiceControls, { ...base, ...props }));

describe('composer voice controls', () => {
  it('hides entries until server config enables each mode independently', () => {
    expect(renderToStaticMarkup(createElement(ComposerVoiceControls,
      { ...base, config: null }))).toBe('');
    const onlyMic = render({ config: { ...config, enabledModes: { dictation: true, live: false } } });
    expect(onlyMic).toContain('aria-label="Dictate message"');
    expect(onlyMic).not.toContain('Start voice conversation');
    const onlyLive = render({ config: { ...config, enabledModes: { dictation: false, live: true } } });
    expect(onlyLive).not.toContain('Dictate message');
    expect(onlyLive).toContain('aria-label="Start voice conversation"');
  });
  it('provides native buttons and distinct decorative SVGs', () => {
    const html = render();
    expect(html).toContain('aria-label="Voice input"');
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html).toContain('data-voice-icon="microphone"');
    expect(html).toContain('data-voice-icon="waveform"');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html).not.toContain('tabindex=');
    expect(html).toContain('Audio is processed to transcribe your message. Nothing is sent until you select Send.');
  });
  it.each([{ textBusy: true }, { otherMode: true }, { locked: true }])
    ('disables both entry buttons for %j', props => {
      expect(render(props).match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
    });
  it('keeps Stop and Cancel when an enabled recording loses config', () => {
    const html = renderToStaticMarkup(createElement(ComposerVoiceControls,
      { ...base, config: null, locked: true, recording: true, status: 'Recording' }));
    expect(html).toContain('aria-label="Stop dictation"');
    expect(html).toContain('aria-label="Cancel dictation"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Recording');
  });
  it('disables Stop during finalizing but keeps Cancel available', () => {
    const html = render({ locked: true, finalizing: true, status: 'Finalizing dictation' });
    expect(html).toMatch(/<button[^>]*aria-label="Stop dictation"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*aria-label="Cancel dictation"(?![^>]*disabled)/);
  });
  it('has no custom tab order or keyboard handler and recording status is not transcript text', () => {
    const html = render({ locked: true, recording: true, status: 'Recording' });
    expect(html).not.toContain('tabindex=');
    expect(html).not.toContain('contenteditable');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('■');
    expect(html).not.toContain('Before OLD after');
  });
});

