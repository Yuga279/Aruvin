/**
 * ============================================================================
 * FILE: ChatView.voice.test.ts
 * LOCATION: frontend/src/features/chat/ChatView.voice.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    SSR and conditional rendering tests for ChatView live voice mode.
 *
 * ROLE IN PROJECT:
 *    Verifies that active live voice replaces transcript and composer without
 *    exposing secret draft/transcript text in the DOM or accessibility tree.
 *
 * KEY COMPONENTS:
 *    - ChatView SSR tests with mocked ChatContext and live voice props
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatView } from './ChatView.tsx';
import { initialLiveVoice } from '../voice/state/live-voice-reducer.ts';
import type { LiveVoiceSurface } from '../voice/state/useLiveVoice.ts';
import { foldCalendarFrame } from '../canvas/calendar-workspace.ts';
import { agenda, calendarMessage, NOW, proposal } from '../canvas/testing/calendar-view-fixtures.ts';
import { initialChatState } from './state/chat-reducer.ts';

const context = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), actions: {
  startNewChat: vi.fn(), selectSession: vi.fn(), loadOlderMessages: vi.fn(), loadMoreSessions: vi.fn(),
  setDraft: vi.fn(), submitMessage: vi.fn(), cancelCurrentTurn: vi.fn(), retryTurn: vi.fn(),
  isVoiceInputLocked: vi.fn(() => false), renameSession: vi.fn(), pinSession: vi.fn(), deleteSession: vi.fn(),
} }));
vi.mock('./state/chat-context.tsx', () => ({ useChat: () => context }));
vi.mock('../voice/dictation/useDictation.ts', () => ({ useDictation: () => ({ config: null,
  locked: false, phase: 'idle', status: '', notice: null, start: vi.fn(), stop: vi.fn(), cancel: vi.fn() }) }));

beforeEach(() => { context.state = { ...initialChatState, draftInput: 'UNSENT_SECRET_DRAFT',
  activeSessionId: 'chat-1', messages: [{ messageId: 'm1', turnId: 't1', eventId: 'e1', sequence: 0,
    role: 'user', content: 'EXISTING_SECRET_TRANSCRIPT', createdAt: '2026-10-08T00:00:00Z', completionStatus: 'completed', truncated: false }] }; });
const voice = (phase: LiveVoiceSurface['view']['phase']): LiveVoiceSurface => ({
  view: { ...initialLiveVoice, phase, connection: 'connected',
    notice: phase === 'idle' ? 'Voice ended. Your draft is unchanged.' : null },
  start: vi.fn(), toggleMute: vi.fn(), interrupt: vi.fn(), exit: vi.fn(), resume: vi.fn(),
});

it.each(['requesting_permission', 'connecting', 'active', 'suspended'] as const)
  ('unmounts composer/transcript and all their accessibility text during %s', phase => {
    const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: voice(phase) }));
    expect(html).toContain('Live voice conversation'); expect(html).toContain('New chat');
    expect(html).not.toContain('<textarea'); expect(html).not.toContain('aurvin-transcript');
    expect(html).not.toContain('UNSENT_SECRET_DRAFT'); expect(html).not.toContain('EXISTING_SECRET_TRANSCRIPT');
  });

it('returns to text on exit/ending, restores the unchanged draft, and shows only an operational notice', () => {
  for (const phase of ['idle', 'ending'] as const) {
    const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: voice(phase) }));
    expect(html).toContain('<textarea'); expect(html).toContain('UNSENT_SECRET_DRAFT');
    expect(html).toContain('EXISTING_SECRET_TRANSCRIPT'); expect(html).not.toContain('Live voice conversation');
  }
  const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: voice('idle') }));
  expect(html).toContain('Voice ended. Your draft is unchanged.');
});

it('preserves the original text-only empty chat behavior without live assembly', () => {
  context.state = { ...initialChatState, draftInput: 'draft' };
  const html = renderToStaticMarkup(createElement(ChatView));
  expect(html).toContain('aurvin-composer-centered'); expect(html).not.toContain('Live voice conversation');
});
it('mounts CanvasPanel beside LiveVoicePanel during active voice while keeping draft and transcript unmounted', () => {
  const liveProjection = {
    responseId: 'resp_live_1',
    ordinal: 0,
    kind: 'mermaid' as const,
    subType: 'Flowchart',
    title: 'Request Routing',
    rawSource: 'flowchart LR\n  Client --> Edge --> Service',
  };
  context.state = {
    ...initialChatState,
    draftInput: 'UNSENT_SECRET_DRAFT',
    activeSessionId: 'chat-1',
    canvasOpen: true,
    activeCanvasArtifactId: 'resp_live_1::canvas::0',
    messages: [
      {
        messageId: 'm1',
        turnId: 't1',
        eventId: 'e1',
        sequence: 0,
        role: 'user',
        content: 'EXISTING_SECRET_TRANSCRIPT',
        createdAt: '2026-10-08T00:00:00Z',
        completionStatus: 'completed',
        truncated: false,
      },
    ],
  };

  const surface: LiveVoiceSurface = {
    ...voice('active'),
    view: {
      ...voice('active').view,
      conversationId: 'chat-1',
      agent: 'speaking',
      response: { turnId: 'turn_live_1', responseId: 'resp_live_1' },
      artifacts: [liveProjection],
    },
  };

  const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: surface }));
  expect(html).toContain('Live voice conversation');
  expect(html).toContain('aurvin-layout-canvas-open');
  expect(html).toContain('id="aurvin-canvas-panel"');
  expect(html).toContain('data-canvas-state="open"');
  expect(html).toContain('data-active-artifact-id="resp_live_1::canvas::0"');
  expect(html).toContain('aria-label="Close Canvas (1)"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('aria-label="Stop speaking"');
  expect(html).not.toContain('aurvin-canvas-header-btn');
  expect(html).not.toContain('<textarea');
  expect(html).not.toContain('UNSENT_SECRET_DRAFT');
  expect(html).not.toContain('EXISTING_SECRET_TRANSCRIPT');
});

it('deduplicates identical live and archived artifact IDs in the unified count and keeps dismissed Canvas hidden during voice', () => {
  const sharedProjection = {
    responseId: 'resp_shared_1',
    ordinal: 0,
    kind: 'chart' as const,
    subType: 'Line Graph',
    title: 'Throughput',
    rawSource: 'Q1: 12\nQ2: 18\nQ3: 27',
  };
  context.state = {
    ...initialChatState,
    activeSessionId: 'chat-1',
    canvasOpen: false,
    activeCanvasArtifactId: 'resp_shared_1::canvas::0',
    messages: [
      {
        messageId: 'v_arch_1',
        turnId: 't_arch_1',
        eventId: 'e_arch_1',
        sequence: 1,
        role: 'assistant',
        content: '',
        createdAt: '2026-11-02T10:00:00Z',
        completionStatus: 'completed',
        truncated: false,
        mode: 'live',
        voiceSessionId: 'vs_1',
        voiceTranscripts: [{ role: 'assistant', content: 'Throughput climbed each quarter.' }],
        canvasArtifacts: [sharedProjection],
      },
    ],
  };

  const surface: LiveVoiceSurface = {
    ...voice('active'),
    view: {
      ...voice('active').view,
      conversationId: 'chat-1',
      artifacts: [sharedProjection],
    },
  };

  const html = renderToStaticMarkup(createElement(ChatView, { liveVoice: surface }));
  expect(html).not.toContain('id="aurvin-canvas-panel"');
  expect(html).toContain('aria-label="Open Canvas (1)"');
  expect(html).toContain('aria-expanded="false"');
});

it('bridges provisional live artifacts across ending/messagesLoading and drops unpersisted live artifacts once idle reload settles', () => {
  const unpersistedProjection = {
    responseId: 'resp_unpersisted',
    ordinal: 0,
    kind: 'svg' as const,
    subType: 'SVG Visual',
    title: 'Transient Sketch',
    rawSource: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="12" /></svg>',
  };

  context.state = {
    ...initialChatState,
    activeSessionId: 'chat-1',
    messagesLoading: true,
    canvasOpen: true,
    activeCanvasArtifactId: 'resp_unpersisted::canvas::0',
    messages: [],
  };
  const loadingIdleSurface: LiveVoiceSurface = {
    ...voice('idle'),
    view: {
      ...voice('idle').view,
      conversationId: 'chat-1',
      artifacts: [unpersistedProjection],
    },
  };
  const duringReloadHtml = renderToStaticMarkup(
    createElement(ChatView, { liveVoice: loadingIdleSurface }),
  );
  expect(duringReloadHtml).toContain('id="aurvin-canvas-panel"');
  expect(duringReloadHtml).toContain('Transient Sketch');

  // Once messagesLoading finishes (false) and phase is idle, authoritative messages win:
  context.state = {
    ...initialChatState,
    activeSessionId: 'chat-1',
    messagesLoading: false,
    canvasOpen: true,
    activeCanvasArtifactId: 'resp_unpersisted::canvas::0',
    messages: [],
  };
  const settledIdleHtml = renderToStaticMarkup(
    createElement(ChatView, { liveVoice: loadingIdleSurface }),
  );
  expect(settledIdleHtml).not.toContain('id="aurvin-canvas-panel"');
  expect(settledIdleHtml).not.toContain('aurvin-canvas-header-btn');
});

it('renders a loading Calendar workspace beside live voice without mounting transcript/composer',()=>{
  context.state={...initialChatState,activeSessionId:'chat-1',canvasOpen:true,activeCanvasArtifactId:'calendar:turn-1::canvas::calendar'};
  const workspace=foldCalendarFrame([],{type:'calendar.frame',turnId:'turn-1',attemptId:'a',responseId:'r',
    event:{type:'calendar-progress',phase:'executing'}});
  const surface={...voice('active'),view:{...voice('active').view,conversationId:'chat-1',calendarWorkspaces:workspace}};
  const html=renderToStaticMarkup(createElement(ChatView,{liveVoice:surface}));
  expect(html).toContain('Running Calendar action');expect(html).toContain('Close Canvas (1)');
  expect(html).not.toContain('<textarea');expect(html).not.toContain('aurvin-transcript');
});

it('does not mount a Calendar workspace belonging to another conversation',()=>{
  context.state={...initialChatState,activeSessionId:'chat-2',canvasOpen:true};
  const surface={...voice('active'),view:{...voice('active').view,conversationId:'chat-1',
    calendarWorkspaces:foldCalendarFrame([],{type:'calendar.frame',turnId:'turn-1',attemptId:'a',responseId:'r',event:{type:'calendar-view',view:agenda()}})}};
  const html=renderToStaticMarkup(createElement(ChatView,{liveVoice:surface}));
  expect(html).not.toContain('Design sync');expect(html).not.toContain('id="aurvin-canvas-panel"');
});

it('drops a closed Calendar tab and shows the archived snapshot read-only after voice exit',()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);
  try {
    context.state={...initialChatState,activeSessionId:'chat-1',canvasOpen:false,
      closedCanvasArtifactIds:['calendar:turn-1::canvas::calendar'],
      messages:[calendarMessage(proposal())]};
    const workspaces=foldCalendarFrame([],{type:'calendar.frame',turnId:'turn-1',attemptId:'a',responseId:'r',
      event:{type:'calendar-view',view:proposal()}});
    const surface={...voice('idle'),view:{...voice('idle').view,conversationId:'chat-1',calendarWorkspaces:workspaces}};
    expect(renderToStaticMarkup(createElement(ChatView,{liveVoice:surface}))).not.toContain('id="aurvin-canvas-panel"');
    context.state={...initialChatState,activeSessionId:'chat-1',canvasOpen:true,
      activeCanvasArtifactId:'assistant-1::canvas::calendar',
      messages:[calendarMessage(proposal())]};
    const html=renderToStaticMarkup(createElement(ChatView,{liveVoice:surface}));
    expect(html).toContain('id="aurvin-canvas-panel"');
    expect(html).toContain('Historical snapshot');
    expect(html).not.toContain('Confirm event');
  } finally { vi.useRealTimers(); }
});
