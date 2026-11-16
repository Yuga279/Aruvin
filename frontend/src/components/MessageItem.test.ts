/**
 * ============================================================================
 * FILE: MessageItem.test.ts
 * LOCATION: frontend/src/components/MessageItem.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Check placeholder placement, copy actions, and unchanged terminal/user markup.
 *
 * ROLE IN PROJECT:
 *    Supplements pure presentation tests with static React markup in Node.
 *    Ensures shimmer is attached only to the live generating words and copy
 *    buttons attach to prompt and response text.
 *
 * KEY COMPONENTS:
 *    - Top placeholder and first-token removal
 *    - Terminal badge ordering, Retry, and user plaintext preservation
 *    - Copy message / Copy response controls and clipboard helper
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiClient } from '../api/client.ts';
import type { VisibleMessage } from '../api/protocol.ts';
import { ChatProvider } from '../features/chat/state/chat-context.tsx';
import { copyTextToClipboard, MessageItem } from './MessageItem.tsx';

const message: VisibleMessage = {
  messageId: 'assistant_1', turnId: 'turn_1', eventId: 'event_1', sequence: 2,
  role: 'assistant', content: '', createdAt: '2026-10-08T00:00:00Z',
  completionStatus: 'streaming', truncated: false,
};

function renderMessage(overrides: Partial<VisibleMessage> = {}, liveStatus?: string) {
  const client = new ApiClient({ fetch: async () => { throw new Error('No network in markup tests'); } });
  return renderToStaticMarkup(createElement(ChatProvider, {
    client,
    children: createElement(MessageItem, { message: { ...message, ...overrides }, liveStatus }),
  }));
}

describe('MessageItem turn status presentation', () => {
  it.each(['submitting', 'accepted', 'generating', 'streaming'])(
    'puts empty live %s placeholder first without an empty Markdown/caret wrapper',
    (status) => {
      const html = renderMessage({}, status);
      expect(html).toContain(
        '<div class="aurvin-message-body"><span class="aurvin-generating-placeholder">Generating…</span>',
      );
      expect(html).not.toContain('aurvin-message-content');
      expect(html).not.toContain('aurvin-status-badge');
      expect(html).not.toContain('Finalizing…');
    },
  );

  it.each(['accepted', 'generating', 'streaming', 'finalizing'])(
    'shows Markdown without in-flight labels/shimmer after text arrives during %s',
    (status) => {
      const html = renderMessage({ content: '**Answer**' }, status);
      expect(html).toContain('<strong>Answer</strong>');
      expect(html).toContain('aurvin-message-content');
      expect(html).not.toContain('aurvin-avatar');
      expect(html).not.toContain('Generating…');
      expect(html).not.toContain('Finalizing…');
      expect(html).not.toContain('aurvin-generating-placeholder');
    },
  );

  it('renders no in-flight label or shimmer even when finalizing is empty', () => {
    const html = renderMessage({}, 'finalizing');
    expect(html).not.toContain('Generating…');
    expect(html).not.toContain('Finalizing…');
    expect(html).not.toContain('aurvin-generating-placeholder');
  });

  it.each([
    ['cancelled', 'Cancelled', false],
    ['failed', 'Generation failed', true],
    ['interrupted', 'Generation interrupted', true],
    ['truncated', 'Response reached maximum length', false],
  ] as const)('keeps %s after partial text and preserves Retry availability', (status, label, retry) => {
    for (const liveStatus of [undefined, status]) {
      const html = renderMessage({ content: 'Partial answer', completionStatus: status }, liveStatus);
      expect(html).toContain(label);
      expect(html.indexOf(label)).toBeGreaterThan(html.indexOf('Partial answer'));
      expect(html.includes('aria-label="Retry generation"')).toBe(retry);
      expect(html).not.toContain('aurvin-generating-placeholder');
    }
  });

  it('leaves completed messages and durable streaming records unlabelled', () => {
    for (const completionStatus of ['completed', 'streaming'] as const) {
      const html = renderMessage({ completionStatus });
      expect(html).not.toContain('aurvin-status-badge');
      expect(html).not.toContain('Generating…');
      expect(html).not.toContain('aurvin-generating-placeholder');
    }
  });

  it('keeps user bubbles as escaped plaintext without assistant decorations', () => {
    const html = renderMessage({ role: 'user', content: '**User** <script>' }, 'generating');
    expect(html).toContain('<div class="aurvin-bubble">**User** &lt;script&gt;</div>');
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain('class="aurvin-copy-btn"');
    expect(html).toContain('Copy message');
    expect(html).not.toContain('aurvin-message-body');
    expect(html).not.toContain('Copy response');
    expect(html).not.toContain('Generating…');
    expect(html).not.toContain('aurvin-generating-placeholder');
  });

  it('exposes Copy response on assistant text and omits copy while generating is empty', () => {
    const withText = renderMessage({ content: '**Answer**' }, 'streaming');
    expect(withText).toContain('aria-label="Copy response"');
    expect(withText).toContain('class="aurvin-message-actions"');
    expect(withText).toContain('Copy response');
    expect(withText).not.toContain('Copy message');

    const emptyLive = renderMessage({}, 'generating');
    expect(emptyLive).not.toContain('aurvin-copy-btn');
    expect(emptyLive).not.toContain('Copy response');
    expect(emptyLive).not.toContain('aurvin-message-actions');
  });

  it('copies through the clipboard API and reports unavailability', async () => {
    const writes: string[] = [];
    const previous = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (value: string) => {
            writes.push(value);
          },
        },
      },
    });
    await expect(copyTextToClipboard('prompt text')).resolves.toBe(true);
    expect(writes).toEqual(['prompt text']);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });
    await expect(copyTextToClipboard('ignored')).resolves.toBe(false);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: previous,
    });
  });

  it('renders Voice Chat indicator pill with tooltip and duration when voiceSessionId is present', () => {
    const html = renderMessage({
      voiceSessionId: 'voice_sess_123',
      voiceDurationSeconds: 5,
      voiceTranscripts: [
        { role: 'user', content: 'Hello Aurvin' },
        { role: 'assistant', content: 'Hello, how can I help you?' },
      ],
    });

    expect(html).toContain('class="aurvin-voice-chat-indicator"');
    expect(html).toContain('data-voice-session-id="voice_sess_123"');
    expect(html).toContain('class="aurvin-voice-chat-pill"');
    expect(html).toContain('title="&quot;show transcript&quot;"');
    expect(html).toContain('aria-label="Voice Chat · 5s. &quot;show transcript&quot;"');
    expect(html).toContain('Voice Chat · 5s');
    expect(html).toContain('class="aurvin-voice-chat-waveform"');
    expect(html).toContain('<span class="aurvin-voice-tooltip" role="tooltip">&quot;show transcript&quot;</span>');
  });

  it('labels a durable per-message voice archive without inventing a session duration', () => {
    const html = renderMessage({ voiceSessionId: 'voice-1', voiceDurationSeconds: undefined,
      voiceTranscripts: [{ role: 'assistant', content: 'Generated answer.' }] });
    expect(html).toContain('Voice message'); expect(html).not.toContain('Voice Chat · 0s');
  });

  it('renders voice messages with canvasArtifacts as voice chat indicator pill without leaking into text chat region', () => {
    const html = renderMessage({
      messageId: 'voice_vis_1',
      turnId: 'turn_vis_1',
      role: 'assistant',
      content: '',
      completionStatus: 'interrupted',
      mode: 'live',
      voiceSessionId: 'voice_sess_vis',
      voiceTranscripts: [
        {
          role: 'assistant',
          content: 'Notice how traffic splits across the primary and standby regions.',
          canvasArtifacts: [
            {
              responseId: 'resp_vis_1',
              ordinal: 0,
              kind: 'mermaid',
              subType: 'Flowchart',
              title: 'Region Failover',
              rawSource: 'flowchart TD\n  DNS --> Primary\n  DNS --> Standby',
            },
          ],
        },
      ],
      canvasArtifacts: [
        {
          responseId: 'resp_vis_1',
          ordinal: 0,
          kind: 'mermaid',
          subType: 'Flowchart',
          title: 'Region Failover',
          rawSource: 'flowchart TD\n  DNS --> Primary\n  DNS --> Standby',
        },
      ],
    });

    expect(html).toContain('aurvin-voice-chat-indicator');
    expect(html).toContain('aurvin-voice-chat-pill');
    expect(html).not.toContain('Notice how traffic splits across the primary and standby regions.');
    expect(html).not.toContain('data-canvas-artifact-id');
  });

  it('renders voice chat indicator pill for cancelled, interrupted, or fallback voice turns', () => {
    const preAudioInterruptedHtml = renderMessage({
      messageId: 'voice_pre_audio',
      turnId: 'turn_pre_audio',
      role: 'assistant',
      content: '',
      completionStatus: 'cancelled',
      mode: 'live',
      voiceSessionId: 'voice_sess_pre',
      voiceTranscripts: [{ role: 'assistant', content: '' }],
    });
    expect(preAudioInterruptedHtml).toContain('aurvin-voice-chat-indicator');
    expect(preAudioInterruptedHtml).toContain('aurvin-voice-chat-pill');

    const malformedFallbackHtml = renderMessage({
      messageId: 'voice_malformed',
      role: 'assistant',
      content: '',
      mode: 'live',
      voiceSessionId: 'voice_sess_bad',
      voiceDurationSeconds: 11,
      voiceTranscripts: [{ role: 'assistant', content: 'Clean fallback speech.' }],
      canvasArtifacts: [
        {
          responseId: 'resp_bad',
          ordinal: 0,
          kind: 'mermaid',
          subType: 'Flowchart',
          title: 'Empty Source',
          rawSource: 'flowchart TD',
        },
      ],
    });
    expect(malformedFallbackHtml).toContain('aurvin-voice-chat-indicator');
    expect(malformedFallbackHtml).toContain('Voice Chat · 11s');
    expect(malformedFallbackHtml).not.toContain('aurvin-canvas-card');
  });
});
