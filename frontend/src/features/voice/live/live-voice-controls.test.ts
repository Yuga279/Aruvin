/**
 * ============================================================================
 * FILE: live-voice-controls.test.ts
 * LOCATION: frontend/src/features/voice/live/live-voice-controls.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for LiveVoiceControls component.
 *
 * ROLE IN PROJECT:
 *    Verifies native icon buttons for Pause/Unpause (Mute/Unmute microphone)
 *    and X (Exit voice), disabled state policies, and handler wiring.
 *
 * KEY COMPONENTS:
 *    - LiveVoiceControls tests
 * ============================================================================
 */

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { LiveVoiceControls, type LiveVoiceControlsProps } from './LiveVoiceControls.tsx';
import { initialLiveVoice } from '../state/live-voice-reducer.ts';

const props = (): LiveVoiceControlsProps => ({ view: { ...initialLiveVoice, phase: 'active', connection: 'connected',
  agent: 'speaking', response: { turnId: 't1', responseId: 'r1' } }, onMute: vi.fn(), onInterrupt: vi.fn(), onExit: vi.fn() });

function buttons(node: ReactElement): ReactElement<{ onClick: () => void; disabled?: boolean }>[] {
  const result: ReactElement<{ onClick: () => void; disabled?: boolean }>[] = [];
  const visit = (child: unknown) => {
    if (Array.isArray(child)) { child.forEach(visit); return; }
    if (!child || typeof child !== 'object' || !('type' in child) || !('props' in child)) return;
    const element = child as ReactElement<{ children?: unknown }>;
    if (element.type === 'button') result.push(element as ReactElement<{ onClick: () => void; disabled?: boolean }>);
    const inner = element.props as { children?: unknown };
    visit(inner.children);
  };
  visit(node); return result;
}

it('exposes pressed mute state, accessible Stop speaking during active response, and Hang up without tooltips', () => {
  const idleProps: LiveVoiceControlsProps = {
    ...props(),
    view: { ...props().view, agent: 'idle', response: null },
  };
  const idleHtml = renderToStaticMarkup(createElement(LiveVoiceControls, idleProps));
  expect(idleHtml.match(/type="button"/g)).toHaveLength(2);
  expect(idleHtml).toContain('aria-label="Mute microphone"');
  expect(idleHtml).toContain('aria-pressed="false"');
  expect(idleHtml).toContain('aria-label="Hang up"');
  expect(idleHtml).not.toContain('Stop speaking');
  expect(idleHtml).not.toContain('aurvin-live-canvas-toggle');

  const speakingProps = props();
  const speakingHtml = renderToStaticMarkup(createElement(LiveVoiceControls, speakingProps));
  expect(speakingHtml.match(/type="button"/g)).toHaveLength(3);
  expect(speakingHtml).toContain('aria-label="Stop speaking"');
  expect(speakingHtml).toContain('aria-keyshortcuts="Escape"');
  expect(speakingHtml).not.toContain('role="tooltip"');
  expect(speakingHtml).not.toContain('tabindex=');

  const muted = renderToStaticMarkup(
    createElement(LiveVoiceControls, {
      ...speakingProps,
      view: { ...speakingProps.view, input: 'muted' },
    }),
  );
  expect(muted).toContain('aria-label="Unmute microphone"');
  expect(muted).toContain('aria-pressed="true"');
});

it('wires each enabled button to its real action and leaves Exit usable during connection/recovery', () => {
  const p = props();
  buttons(LiveVoiceControls(p)).forEach((button) => button.props.onClick());
  expect(p.onMute).toHaveBeenCalledTimes(1);
  expect(p.onInterrupt).toHaveBeenCalledTimes(1);
  expect(p.onExit).toHaveBeenCalledTimes(1);
  for (const phase of ['requesting_permission', 'connecting', 'suspended'] as const) {
    const controls = buttons(
      LiveVoiceControls({
        ...p,
        view: { ...p.view, phase, response: null, connection: 'reconnecting' },
      }),
    );
    expect(controls[0].props.disabled).toBe(true);
    expect(controls[1].props.disabled).not.toBe(true);
  }
});

it('exposes keyboard-accessible Canvas toggle with expanded state and unique artifact count while speaking or paused, and omits it when 0', () => {
  const onToggleCanvas = vi.fn();
  const zeroHtml = renderToStaticMarkup(
    createElement(LiveVoiceControls, {
      ...props(),
      canvasArtifactCount: 0,
      canvasOpen: false,
      onToggleCanvas,
    }),
  );
  expect(zeroHtml).not.toContain('aurvin-live-canvas-toggle');

  const openSpeakingHtml = renderToStaticMarkup(
    createElement(LiveVoiceControls, {
      ...props(),
      canvasArtifactCount: 2,
      canvasOpen: true,
      onToggleCanvas,
    }),
  );
  expect(openSpeakingHtml).toContain('aria-label="Close Canvas (2)"');
  expect(openSpeakingHtml).toContain('aria-expanded="true"');
  expect(openSpeakingHtml).toContain('aria-controls="aurvin-canvas-panel"');
  expect(openSpeakingHtml).toContain('<span class="aurvin-live-canvas-count">2</span>');

  // Must remain enabled and operable even when audio/call is paused (phase === 'suspended')
  const pausedNode = LiveVoiceControls({
    ...props(),
    view: {
      ...props().view,
      phase: 'suspended',
      connection: 'connected',
      resumeRequired: true,
      response: null,
    },
    canvasArtifactCount: 3,
    canvasOpen: false,
    onToggleCanvas,
  });
  const pausedHtml = renderToStaticMarkup(pausedNode);
  expect(pausedHtml).toContain('aria-label="Open Canvas (3)"');
  expect(pausedHtml).toContain('aria-expanded="false"');
  const toggleBtn = buttons(pausedNode).find((b) =>
    String((b.props as { className?: string }).className).includes('aurvin-live-canvas-toggle'),
  );
  expect(toggleBtn).toBeDefined();
  expect(toggleBtn?.props.disabled).not.toBe(true);
  toggleBtn?.props.onClick();
  expect(onToggleCanvas).toHaveBeenCalledTimes(1);
});

it('serializes Unmute when busy and muted, and leaves Mute enabled during pending unmute', () => {
  const p = props();
  expect(buttons(LiveVoiceControls({ ...p, view: { ...p.view, input: 'muted', inputBusy: true } }))[0].props.disabled).toBe(true);
  expect(buttons(LiveVoiceControls({ ...p, view: { ...p.view, input: 'listening', inputBusy: true } }))[0].props.disabled).toBe(false);
});

it('quiet input is not muted, and Hang up stays available while requesting, reconnecting, or blocked', () => {
  const p = props();
  const quiet = renderToStaticMarkup(createElement(LiveVoiceControls, { ...p, view: { ...p.view, input: 'suspended' } }));
  expect(quiet).toContain('aria-label="Mute microphone"');
  expect(quiet).toContain('aria-pressed="false"');
  expect(quiet).not.toContain('aria-pressed="true"');
  expect(buttons(LiveVoiceControls({ ...p, view: { ...p.view, input: 'suspended' } }))[0].props.disabled).toBe(false);
  for (const view of [
    { phase: 'requesting_permission' as const, connection: 'connecting' as const },
    { phase: 'connecting' as const, connection: 'connecting' as const },
    { phase: 'suspended' as const, connection: 'reconnecting' as const },
    { phase: 'suspended' as const, connection: 'disconnected' as const, canResume: false },
  ]) {
    const controls = buttons(LiveVoiceControls({ ...p, view: { ...p.view, ...view, response: null } }));
    expect(controls[1].props.disabled).not.toBe(true);
  }
});
