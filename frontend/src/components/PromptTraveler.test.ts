/**
 * ============================================================================
 * FILE: PromptTraveler.test.ts
 * LOCATION: frontend/src/components/PromptTraveler.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify prompt extraction, cosine-wave tick magnification, rail hover
 *    mapping, SSR markup, and scroll-to-prompt-top behavior.
 *
 * ROLE IN PROJECT:
 *    Node-environment unit and static-markup tests for the right-side prompt
 *    traveling minimap rail and floating prompt history window.
 *
 * KEY COMPONENTS:
 *    - extractUserPrompts filtering tests
 *    - computeTickMetrics resting and hover wave magnification tests
 *    - computeRailHoverState and computeWindowBounds windowing tests
 *    - scrollTranscriptToPrompt top alignment and dynamic bottom clearance tests
 *    - PromptTraveler static markup and Transcript integration tests
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { VisibleMessage } from '../api/protocol.ts';
import {
  computeRailHoverState,
  computeTickMetrics,
  computeWindowBounds,
  extractUserPrompts,
  MAX_VISIBLE_TICKS,
  PromptTraveler,
  scrollTranscriptToPrompt,
} from './PromptTraveler.tsx';

function makeMessage(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  overrides: Partial<VisibleMessage> = {},
): VisibleMessage {
  return {
    messageId: id,
    turnId: `turn_${id}`,
    eventId: `evt_${id}`,
    sequence: 1,
    role,
    content,
    createdAt: '2026-10-21T00:00:00Z',
    completionStatus: 'completed',
    truncated: false,
    ...overrides,
  };
}

describe('PromptTraveler logic and rendering', () => {
  it('extracts only non-empty text user prompts in chronological order', () => {
    const messages: VisibleMessage[] = [
      makeMessage('u1', 'user', 'First prompt'),
      makeMessage('a1', 'assistant', 'First reply'),
      makeMessage('v1', 'user', 'Voice transcript', { voiceSessionId: 'voice_1' }),
      makeMessage('u_empty', 'user', '   '),
      makeMessage('u2', 'user', 'Second prompt'),
    ];

    const prompts = extractUserPrompts(messages);
    expect(prompts).toEqual([
      { messageId: 'u1', turnId: 'turn_u1', content: 'First prompt', index: 0 },
      { messageId: 'u2', turnId: 'turn_u2', content: 'Second prompt', index: 1 },
    ]);
  });

  it('computes resting tick metrics with active slot widened and brightened', () => {
    const metrics = computeTickMetrics(5, 3, null);
    expect(metrics).toHaveLength(5);
    expect(metrics[3]?.widthPx).toBe(18);
    expect(metrics[3]?.opacity).toBe(1);
    expect(metrics[3]?.isHighlighted).toBe(true);

    for (const idx of [0, 1, 2, 4]) {
      expect(metrics[idx]?.widthPx).toBe(10);
      expect(metrics[idx]?.opacity).toBe(0.28);
      expect(metrics[idx]?.isHighlighted).toBe(false);
    }

    for (const metric of metrics) {
      expect(metric.heightPx).toBe(2);
    }
  });

  it('computes smooth cosine-wave magnification across neighboring ticks on vertical hover', () => {
    const metrics = computeTickMetrics(8, 7, 3);
    // Hovered slot (3) is widest and brightest
    expect(metrics[3]?.widthPx).toBe(22);
    expect(metrics[3]?.opacity).toBe(1);
    expect(metrics[3]?.isHighlighted).toBe(true);

    // Immediate neighbors (2 and 4) scale symmetrically between peak and base
    expect(metrics[2]?.widthPx).toBeGreaterThan(14);
    expect(metrics[2]?.widthPx).toBeLessThan(22);
    expect(metrics[4]?.widthPx).toBe(metrics[2]?.widthPx);

    // Second neighbors (1 and 5) taper further down
    expect(metrics[1]?.widthPx).toBeGreaterThan(10);
    expect(metrics[1]?.widthPx).toBeLessThan(metrics[2]!.widthPx);
    expect(metrics[5]?.widthPx).toBe(metrics[1]?.widthPx);

    // Distant ticks (0, 6, 7) remain at base width and opacity
    expect(metrics[0]?.widthPx).toBe(10);
    expect(metrics[6]?.widthPx).toBe(10);
    expect(metrics[7]?.widthPx).toBe(10);

    // All ticks preserve strictly constant height to prevent vertical jitter
    for (const metric of metrics) {
      expect(metric.heightPx).toBe(2);
    }
  });

  it('maps vertical pointer coordinates along the rail to hover slot, prompt index, and window bounds', () => {
    const topState = computeRailHoverState(100, 100, 200, 12, MAX_VISIBLE_TICKS);
    expect(topState).toEqual({
      ratio: 0,
      hoverSlot: 0,
      promptIndex: 0,
      windowStart: 0,
    });

    const midState = computeRailHoverState(200, 100, 200, 12, MAX_VISIBLE_TICKS);
    expect(midState.ratio).toBe(0.5);
    expect(midState.hoverSlot).toBe(3.5);
    expect(midState.promptIndex).toBe(6);
    expect(midState.windowStart).toBe(2);

    const bottomState = computeRailHoverState(300, 100, 200, 12, MAX_VISIBLE_TICKS);
    expect(bottomState).toEqual({
      ratio: 1,
      hoverSlot: 7,
      promptIndex: 11,
      windowStart: 4,
    });

    const boundsAtBottom = computeWindowBounds(12, 11, MAX_VISIBLE_TICKS);
    expect(boundsAtBottom.canScrollUp).toBe(true);
    expect(boundsAtBottom.canScrollDown).toBe(false);

    const boundsAtTop = computeWindowBounds(12, 0, MAX_VISIBLE_TICKS);
    expect(boundsAtTop.canScrollUp).toBe(false);
    expect(boundsAtTop.canScrollDown).toBe(true);
  });

  it('scrolls the chosen prompt to the top of the transcript and adds bottom clearance when needed', () => {
    const scrollTo = vi.fn();
    let padProperty = '';
    const promptEl = {
      getAttribute: (attr: string) => (attr === 'data-message-id' ? 'u2' : null),
      getBoundingClientRect: () => ({ top: 520, height: 42 }),
      offsetTop: 420,
    };
    const fakeContainer = {
      scrollTop: 100,
      scrollHeight: 800,
      clientHeight: 600,
      style: {
        getPropertyValue: () => padProperty,
        setProperty: (_name: string, val: string) => {
          padProperty = val;
        },
        removeProperty: () => {
          padProperty = '';
        },
      },
      getBoundingClientRect: () => ({ top: 100, height: 600 }),
      querySelectorAll: () => [promptEl],
      scrollTo,
    } as unknown as HTMLElement;

    const scrolled = scrollTranscriptToPrompt(fakeContainer, 'u2', 'smooth');
    expect(scrolled).toBe(true);
    // relativeTop = (520 - 100) + 100 = 520; desiredScrollTop = 520 - 12 = 508
    expect(scrollTo).toHaveBeenCalledWith({ top: 508, behavior: 'smooth' });
    // maxAvailableScroll = 800 - 600 = 200; requiredExtraPad = 508 - 200 = 308px
    expect(padProperty).toBe('308px');
  });

  it('renders nothing when there are no user prompts and renders rail + popover items when prompts exist', () => {
    const ref = { current: null };
    const emptyHtml = renderToStaticMarkup(
      createElement(PromptTraveler, {
        scrollContainerRef: ref,
        messages: [makeMessage('a1', 'assistant', 'Only assistant')],
      }),
    );
    expect(emptyHtml).toBe('');

    const messages = Array.from({ length: 10 }, (_, idx) =>
      makeMessage(`u_${idx + 1}`, 'user', `Prompt number ${idx + 1}`),
    );
    const html = renderToStaticMarkup(
      createElement(PromptTraveler, {
        scrollContainerRef: ref,
        messages,
      }),
    );

    expect(html).toContain('class="aurvin-prompt-traveler"');
    expect(html).toContain('class="aurvin-prompt-traveler-rail"');
    expect(html).toContain('class="aurvin-prompt-traveler-popover"');
    expect(html).toContain('Prompt number 1');
    expect(html).toContain('Prompt number 10');
    // Up chevron is visible when anchored at the newest prompt (10th of 10 > 8 visible ticks)
    expect(html).toContain('aurvin-prompt-traveler-chevron-up" data-visible="true"');
    expect(html).toContain('aurvin-prompt-traveler-chevron-down" data-visible="false"');
  });
});
