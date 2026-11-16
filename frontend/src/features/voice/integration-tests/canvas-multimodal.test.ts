/**
 * ============================================================================
 * FILE: canvas-multimodal.test.ts
 * LOCATION: frontend/src/features/voice/integration-tests/canvas-multimodal.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Frontend integration test suite for live voice Canvas multimodal features.
 *
 * ROLE IN PROJECT:
 *    Validates event isolation, pre-audio artifact retention, dismissal/media stability,
 *    local stop-before-network, accessible markup, renderer safety parity, and archive reconciliation.
 *
 * KEY COMPONENTS:
 *    - Receiver & State: Pre-audio visuals, cancelled/stale turn fencing, session isolation
 *    - Portable receiver: Malformed and oversized payload rejection outside the live channel
 *    - Dismissal & Media: Stable selection, media resource continuity, tab and replay isolation
 *    - Local Stop: Pre-network local audio cutoff and visual retention
 *    - Accessibility & Markup: LiveVoicePanel and CanvasPanel inert/motion/focus semantics
 *    - Renderer Safety: Render parity for visual types and inert malicious SVG/Chart/Mermaid payloads
 *    - Archive Reconciliation: VisibleMessage collection, merge, legacy compatibility, and inline card grouping
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matrixFixture } from './matrix-fixture.ts';
import { settle } from '../state/testing/live-voice-fixture.ts';
import type { LiveVoiceBindings } from '../state/live-voice-controller.ts';
import { VISUALS, SPEECH, sourceOf } from './canvas-multimodal-fixtures.ts';
import { parseVoiceControl, type CanvasArtifactProjection, type VoiceServerPayload }
  from '../../../api/voice-protocol.ts';
import type { VisibleMessage } from '../../../api/protocol.ts';
import { chatReducer, initialChatState } from '../../chat/state/chat-reducer.ts';
import { collectSessionCanvasArtifacts, mergeSessionCanvasArtifacts, projectionToCanvasArtifact,
  forcedChartKindFromSubType, CANVAS_TRANSITION_MS, handleLiveCanvasShortcut, prefersReducedCanvasMotion,
  restoreCanvasCloseFocus } from '../../canvas/canvas-artifacts.ts';
import { CanvasPanel, ChartRenderer, MermaidRenderer, SvgRenderer } from '../../canvas/index.ts';
import { LiveVoicePanel } from '../live/LiveVoicePanel.tsx';
import { initialLiveVoice } from '../state/live-voice-reducer.ts';
import { groupVoiceMessages } from '../../../components/group-voice-messages.ts';
import { MessageItem } from '../../../components/MessageItem.tsx';
import { ChatProvider } from '../../chat/state/chat-context.tsx';
import { ApiClient } from '../../../api/client.ts';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const projection = (responseId = 'response-1', ordinal = 0): CanvasArtifactProjection =>
  ({ responseId, ...sourceOf(VISUALS[0]!), ordinal });

const artifactEvent = (responseId = 'response-1', ordinal = 0): VoiceServerPayload =>
  ({ type: 'canvas.artifact', turnId: `turn-${responseId}`, ...projection(responseId, ordinal) });

const canvasBindings = (openCanvasArtifact = vi.fn()): LiveVoiceBindings => ({
  claimVoiceInput: vi.fn(() => 'lease-1'), writeVoiceDraft: vi.fn(() => true),
  releaseVoiceInput: vi.fn(), bindVoiceConversation: vi.fn(() => true),
  refreshSessions: vi.fn(), openCanvasArtifact,
});

function archivedMessage(p: CanvasArtifactProjection): VisibleMessage {
  return {
    messageId: 'assistant-archive-1',
    turnId: 'turn-response-1',
    eventId: 'archive-event-1',
    sequence: 2,
    role: 'assistant',
    content: '',
    createdAt: '2026-11-02T10:00:00Z',
    completionStatus: 'completed',
    truncated: false,
    mode: 'live',
    voiceSessionId: 'voice-archive-1',
    voiceDurationSeconds: 3,
    voiceTranscripts: [{ role: 'assistant', content: SPEECH }],
    canvasArtifacts: [p],
  };
}

describe('Frontend Canvas Multimodal Integration', () => {
  it('retains pre-audio visuals once, fences cancelled/stale turns and isolates conversations', async () => {
    const openCanvasArtifact = vi.fn();
    const f = matrixFixture('granted', { bindings: canvasBindings(openCanvasArtifact) });
    try {
      await f.begin(); f.event({ type: 'conversation.bound', conversationId: 'conversation-1' });
      f.event(artifactEvent()); f.event(artifactEvent());
      expect(f.controller.getSnapshot().response).toBeNull();
      expect(f.controller.getSnapshot().artifacts).toEqual([projection()]);
      expect(openCanvasArtifact).toHaveBeenCalledExactlyOnceWith('response-1::canvas::0');
      f.event({ type: 'response.cancelled', turnId: 'turn-response-1', responseId: 'response-1', lastAudioSequence: null });
      f.event(artifactEvent('response-1', 1));
      f.event(artifactEvent('response-2'), f.response.connectionEpoch - 1);
      expect(f.controller.getSnapshot().artifacts).toEqual([projection()]);
      f.event(artifactEvent('response-2')); f.event(artifactEvent('response-1', 2));
      expect(f.controller.getSnapshot().artifacts).toEqual([projection(), projection('response-2')]);
      f.controller.exit('navigation'); await settle();
      expect(f.controller.getSnapshot().artifacts).toEqual([]);
      expect(f.controller.getSnapshot().conversationId).toBeNull();
    } finally { f.controller.exit(); await settle(); }
  });

  it('portable receiver rejects malformed and oversized visuals outside the live server channel', () => {
    const event = { protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1,
      eventId: 'event-1', sequence: 1, ...artifactEvent() };
    expect(parseVoiceControl(JSON.stringify(event), 'server', 'live')).toEqual(event);
    expect(() => parseVoiceControl(JSON.stringify(event), 'server', 'dictation')).toThrow('INVALID_VOICE_CONTROL');
    expect(() => parseVoiceControl(JSON.stringify(event), 'client', 'live')).toThrow('INVALID_VOICE_CONTROL');
    for (const patch of [{ kind: 'graph' }, { ordinal: 3 }, { responseId: 'bad id' }, { turnId: '' },
      { title: 'x'.repeat(121) }, { rawSource: '界'.repeat(6000) }, { rawSource: 'x'.repeat(8193) }, { extra: true }]) {
      expect(() => parseVoiceControl(JSON.stringify({ ...event, ...patch }), 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
    }
    const json = JSON.stringify(event);
    const padded = json + ' '.repeat(131072 - new TextEncoder().encode(json).byteLength);
    expect(parseVoiceControl(padded, 'server', 'live')).toEqual(event);
    expect(() => parseVoiceControl(padded + ' ', 'server', 'live')).toThrow('INVALID_VOICE_CONTROL');
  });

  it('close reopen tab and replay keep count, selection and media resources stable', async () => {
    let chat = { ...initialChatState };
    const open = vi.fn((id: string) => { chat = chatReducer(chat,
      { type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId: id } }); });
    const f = matrixFixture('granted', { bindings: canvasBindings(open) });
    try {
      await f.begin(); f.event({ type: 'conversation.bound', conversationId: 'conversation-1' });
      const client = f.client(), room = f.rtc.room, mic = f.rtc.mic, track = f.track;
      const captureCalls = f.rtc.microphone.mock.calls.length;
      const publishCalls = f.rtc.participant.publishTrack.mock.calls.length;
      const stopCalls = f.rtc.mic.stop.mock.calls.length;
      f.event(artifactEvent());
      expect(chat.canvasOpen).toBe(true);
      chat = chatReducer(chat, { type: 'CLOSE_CANVAS' });
      f.event(artifactEvent()); f.listening();
      expect(chat.canvasOpen).toBe(false);
      f.event(artifactEvent('response-2'));
      expect(chat.canvasOpen).toBe(true);
      let list = mergeSessionCanvasArtifacts([], f.controller.getSnapshot().artifacts);
      expect(list).toHaveLength(2);
      chat = chatReducer(chat, { type: 'CLOSE_CANVAS_TAB', payload: {
        artifactId: 'response-2::canvas::0', fallbackArtifactId: 'response-1::canvas::0' } });
      expect(chat.canvasOpen).toBe(true);
      chat = chatReducer(chat, { type: 'CLOSE_CANVAS_TAB', payload: {
        artifactId: 'response-1::canvas::0', fallbackArtifactId: null } });
      expect(chat.canvasOpen).toBe(false);
      chat = chatReducer(chat, { type: 'OPEN_CANVAS_ARTIFACT', payload: { artifactId: 'response-1::canvas::0' } });
      expect(chat.activeCanvasArtifactId).toBe('response-1::canvas::0');
      list = mergeSessionCanvasArtifacts([], f.controller.getSnapshot().artifacts);
      expect(list).toHaveLength(2); // Closing is not deletion.
      expect(f.client()).toBe(client); expect(f.rtc.room).toBe(room);
      expect(f.rtc.mic).toBe(mic); expect(f.track).toBe(track);
      expect(f.rtc.microphone).toHaveBeenCalledTimes(captureCalls);
      expect(f.rtc.participant.publishTrack).toHaveBeenCalledTimes(publishCalls);
      expect(f.rtc.mic.stop).toHaveBeenCalledTimes(stopCalls);
      expect(f.rtc.room.disconnect).not.toHaveBeenCalled();
    } finally { f.controller.exit(); await settle(); }
  });

  it('stops LiveKit output before a failed control publish and freezes the virtual cursor', async () => {
    const f = matrixFixture('granted');
    try {
      await f.begin(); f.attach();
      f.event({ type: 'conversation.bound', conversationId: 'conversation-1' });
      f.event(artifactEvent());
      const ref = { turnId: 'turn-response-1', responseId: 'response-1' };
      f.event({ type: 'audio.start', ...ref, sampleRate: 24000, firstAudioSequence: 0, firstAudioSample: 0 });
      f.event({ type: 'audio.watermark', ...ref, firstAudioSample: 0,
        queuedSamples: 4800, lastAudioSample: 4800, final: false });
      f.client().progress();
      f.rtc.clock.value = 100;
      expect(f.client().progress().playedSamples).toBe(2400);
      const retained = structuredClone(f.controller.getSnapshot().artifacts);
      f.rtc.participant.publishData.mockImplementation(async bytes => {
        const packet = JSON.parse(new TextDecoder().decode(bytes));
        if (packet.type === 'response.interrupt') {
          expect(f.rtc.audio.muted).toBe(true);
          expect(f.rtc.audio.pause).toHaveBeenCalled();
          throw new Error('fixture send failure');
        }
      });
      f.rtc.clock.value = 200;
      f.controller.interrupt();
      expect(f.rtc.audio.muted).toBe(true);
      expect(f.rtc.audio.pause).toHaveBeenCalled();
      expect(f.controller.getSnapshot().artifacts).toEqual(retained);
      f.rtc.clock.value = 300;
      expect(f.client().progress().playedSamples).toBe(4800);
      await settle();
      expect(f.rtc.room.disconnect).toHaveBeenCalledOnce();
    } finally { f.controller.exit(); await settle(); }
  });

  it('live controls and exiting Canvas expose paused keyboard and focus-safe semantics', () => {
    const onToggle = vi.fn();
    const view = { ...initialLiveVoice, phase: 'active' as const, connection: 'connected' as const,
      agent: 'speaking' as const, response: { turnId: 'turn-response-1', responseId: 'response-1' },
      conversationId: 'conversation-1', artifacts: [projection()] };
    const voice = { view, start: vi.fn(), toggleMute: vi.fn(), interrupt: vi.fn(), exit: vi.fn(), resume: vi.fn() };
    const speaking = renderToStaticMarkup(createElement(LiveVoicePanel,
      { voice, canvas: { artifactCount: 1, open: true, onToggle } }));
    expect(speaking).toContain('aria-label="Stop speaking"');
    expect(speaking).toContain('aria-label="Close Canvas (1)"');
    expect(speaking).toContain('aria-expanded="true"');
    expect(speaking).toContain('aria-controls="aurvin-canvas-panel"');
    const paused = renderToStaticMarkup(createElement(LiveVoicePanel, {
      voice: { ...voice, view: { ...view, phase: 'suspended', resumeRequired: true, response: null } },
      canvas: { artifactCount: 1, open: false, onToggle },
    }));
    expect(paused).toContain('aria-label="Open Canvas (1)"');
    const empty = renderToStaticMarkup(createElement(LiveVoicePanel,
      { voice, canvas: { artifactCount: 0, open: false, onToggle } }));
    expect(empty).not.toContain('aria-controls="aurvin-canvas-panel"');
    const a = projectionToCanvasArtifact(projection())!;
    const exiting = renderToStaticMarkup(createElement(CanvasPanel, { artifacts: [a], activeArtifactId: a.artifactId,
      onSelectArtifact: () => {}, onCloseTab: () => {}, onClosePanel: () => {}, transitionState: 'exiting' }));
    expect(exiting).toContain('inert=""'); expect(exiting).toContain('aria-hidden="true"');
    expect(CANVAS_TRANSITION_MS).toBeGreaterThanOrEqual(300); expect(CANVAS_TRANSITION_MS).toBeLessThanOrEqual(350);
    expect(prefersReducedCanvasMotion({ matchMedia: () => ({ matches: true }) } as unknown as Window)).toBe(true);
    const focus = vi.fn(); restoreCanvasCloseFocus({ liveActive: true, liveCanvasToggle: { focus } as unknown as HTMLElement });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    const key = { key: 'c', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
      repeat: false, defaultPrevented: false, isComposing: false, target: null, preventDefault: vi.fn() };
    expect(handleLiveCanvasShortcut(key, { artifactCount: 1, onToggle })).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(handleLiveCanvasShortcut({ ...key, isComposing: true }, { artifactCount: 1, onToggle })).toBe(false);
    expect(handleLiveCanvasShortcut({ ...key, target: { closest: () => ({}) } as unknown as EventTarget },
      { artifactCount: 1, onToggle })).toBe(false);
  });

  it.each(VISUALS)('renders $subType through the existing Canvas path', item => {
    const p = { responseId: 'render-response', ...sourceOf(item) };
    const a = projectionToCanvasArtifact(p)!;
    expect(a).not.toBeNull(); expect(a.rawSource).toBe(item.rawSource);
    const html = renderToStaticMarkup(createElement(CanvasPanel, { artifacts: [a],
      activeArtifactId: a.artifactId, onSelectArtifact: () => {}, onCloseTab: () => {}, onClosePanel: () => {} }));
    expect(html).toContain('<svg'); expect(html).toContain(item.title);
    if (item.language === 'graph') {
      expect(forcedChartKindFromSubType(a.subType, a.rawSource)).toBe('line');
      expect(html).toContain('<path');
    }
  });

  it('preserves SVG safety and keeps malicious labels inert in every renderer', () => {
    const unsafe = '<svg viewBox="0 0 80 40"><script>EXECUTE_ME()</script><foreignObject><div>BAD_HTML</div></foreignObject>' +
      '<image href="https://invalid.example/tracker"/><rect onload="EXECUTE_ME()" style="fill:url(https://invalid.example/tracker)" ' +
      'fill="url(https://invalid.example/tracker)" x="2" y="2" width="20" height="20"/></svg>';
    const html = renderToStaticMarkup(createElement(SvgRenderer, { source: unsafe, title: 'Safe' }));
    expect(html).toContain('<rect');
    expect(html).not.toMatch(/<script|foreignObject|<image|onload=|EXECUTE_ME|BAD_HTML|invalid\.example|javascript:|data:/i);
    const chart = renderToStaticMarkup(createElement(ChartRenderer, {
      source: '{"type":"bar","labels":["<script>LABEL</script>"],"datasets":[{"label":"Count","data":[1]}]}', title: 'Chart' }));
    expect(chart).not.toContain('<script>'); expect(chart).toContain('&lt;script&gt;');
    const mermaid = renderToStaticMarkup(createElement(MermaidRenderer, {
      source: 'flowchart TD\nA[<script>LABEL</script>] --> B[Safe]', title: 'Diagram' }));
    expect(mermaid).not.toContain('<script>');
    expect(mermaid).not.toMatch(/href="https?:|onclick=/i);
  });

  it('archive reload replaces provisional ownership once and keeps legacy speech separate', () => {
    const p = projection(), row = archivedMessage(p);
    const live = mergeSessionCanvasArtifacts([], [p]);
    const archive = collectSessionCanvasArtifacts([row], '', false);
    const merged = mergeSessionCanvasArtifacts(archive, [p, p]);
    expect(live[0]!.artifactId).toBe(merged[0]!.artifactId);
    expect(merged).toHaveLength(1); expect(merged[0]!.messageId).toBe(row.messageId);
    expect(merged[0]!.rawSource).toBe(p.rawSource);
    const { canvasArtifacts: removed, ...legacy } = row;
    expect(removed).toEqual([p]);
    expect(collectSessionCanvasArtifacts([legacy], '', false)).toEqual([]);
    expect(legacy.voiceTranscripts![0]!.content).toBe(SPEECH);
    expect(collectSessionCanvasArtifacts([{ ...row, role: 'user' }], '', false)).toEqual([]);
    expect(collectSessionCanvasArtifacts([{ ...row, canvasArtifacts: [] }], '', false)).toEqual([]);
  });

  it('post-call grouping consolidates call into single indicator pill while retaining visuals inside transcript items', () => {
    const assistant = archivedMessage(projection());
    const user: VisibleMessage = { ...assistant, messageId: 'voice-user-1', sequence: 1,
      role: 'user', canvasArtifacts: undefined,
      voiceTranscripts: [{ role: 'user', content: 'Explain the path.' }] };
    delete user.canvasArtifacts;
    const grouped = groupVoiceMessages([user, assistant]);
    const client = new ApiClient({ fetch: async () => { throw new Error('No network in Canvas markup fixture'); } });
    const html = renderToStaticMarkup(createElement(ChatProvider, { client,
      children: createElement('div', {}, ...grouped.map(row => createElement(MessageItem,
        { key: row.messageId, message: row }))) }));
    // In chat region, only the Voice Chat pill is rendered without leaking responses or canvas cards
    expect(grouped).toHaveLength(1);
    expect(html).toContain('aurvin-voice-chat-indicator');
    expect(html).toContain('Voice Chat · 3s');
    expect(html).not.toContain('data-canvas-artifact-id');
    expect(html).not.toContain(SPEECH);
    expect(html).not.toContain('A[Start] --> B[Finish]');
    expect(grouped[0]!.voiceTranscripts).toHaveLength(2);
    expect(grouped[0]!.voiceTranscripts![1]!.canvasArtifacts).toEqual([projection()]);
    expect(grouped.some(row => row.voiceDurationSeconds === 3 && (row.voiceTranscripts?.length ?? 0) >= 2)).toBe(true);

    // Multi-visual extension on the same message
    const multiVisualAssistant: VisibleMessage = {
      ...assistant,
      messageId: 'assistant-multi-1',
      canvasArtifacts: [projection('resp-m', 0), projection('resp-m', 1)],
    };
    const multiGrouped = groupVoiceMessages([user, multiVisualAssistant]);
    expect(multiGrouped).toHaveLength(1);
    expect(multiGrouped[0]!.voiceTranscripts![1]!.canvasArtifacts).toHaveLength(2);

    // Legacy voice-only call extension (no canvas artifacts)
    const legacyAssistant: VisibleMessage = {
      ...assistant,
      messageId: 'assistant-legacy-1',
      canvasArtifacts: undefined,
    };
    const legacyGrouped = groupVoiceMessages([user, legacyAssistant]);
    expect(legacyGrouped).toHaveLength(1);
    expect(legacyGrouped[0]!.voiceTranscripts!.some(t => t.canvasArtifacts?.length)).toBe(false);
  });
});
