/**
 * ============================================================================
 * FILE: shared-parsing.test.ts
 * LOCATION: frontend/src/features/chat/markdown/shared-parsing.test.ts
 * ============================================================================
 * PURPOSE: Check shared, bounded Markdown/Canvas parsing on the real render path.
 * ROLE IN PROJECT: Prevent duplicate tokenization while retaining safe rendering.
 * KEY COMPONENTS: Parser call counts, streaming invalidation, cache eviction.
 * ============================================================================
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import * as parser from './parse-markdown.ts';
import { collectSessionCanvasArtifacts, extractMessageCanvasArtifacts } from '../../canvas/canvas-artifacts.ts';
import { SafeMarkdown } from './safe-markdown.tsx';

it('shares tokenization and Canvas classification between extraction and rendering', () => {
  const spy = vi.spyOn(parser, 'parseMarkdown');
  const content = '<aurvin-canvas type="chart">Q1: 42</aurvin-canvas>\n<script>unsafe()</script>';
  const [artifact] = extractMessageCanvasArtifacts(content, 'shared');
  const html = renderToStaticMarkup(createElement(SafeMarkdown, { content, messageId: 'shared' }));
  expect(artifact?.title).toBe('Bar Chart');
  expect(html).toContain('View chart');
  expect(html).not.toContain('<script>');
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});

it('reuses identical parses, invalidates streaming text, and evicts old entries', () => {
  const first = extractMessageCanvasArtifacts('```chart\nA: 1', 'bounded', true);
  expect(extractMessageCanvasArtifacts('```chart\nA: 1', 'bounded', true)[0]).toBe(first[0]);
  const next = extractMessageCanvasArtifacts('```chart\nA: 12', 'bounded', true);
  expect(next[0]?.rawSource).toContain('12');
  expect(extractMessageCanvasArtifacts('```chart\nA: 12', 'other', false)[0]).toMatchObject({
    messageId: 'other', isStreaming: false,
  });
  for (let i = 0; i < 64; i++) extractMessageCanvasArtifacts(`filler ${i}`, `m${i}`);
  expect(extractMessageCanvasArtifacts('```chart\nA: 1', 'bounded', true)[0]).not.toBe(first[0]);
});

it('bounds retained source characters and bypasses oversized messages', () => {
  const first = extractMessageCanvasArtifacts('```chart\nA: 1\n```', 'char-budget');
  for (let i = 0; i < 4; i++) {
    extractMessageCanvasArtifacts('x'.repeat(90_000), `large-${i}`);
  }
  expect(extractMessageCanvasArtifacts('```chart\nA: 1\n```', 'char-budget')[0]).not.toBe(first[0]);
  const oversized = '```mermaid\ngraph LR\n A --> B\n```\n' + 'x'.repeat(300_000);
  const spy = vi.spyOn(parser, 'parseMarkdown');
  extractMessageCanvasArtifacts(oversized, 'oversized');
  extractMessageCanvasArtifacts(oversized, 'oversized');
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});

it('reuses the message snapshot without scanning archive content on each delta', () => {
  const message = { messageId: 'archived', turnId: 'turn', eventId: 'event', sequence: 1,
    role: 'assistant' as const, get content() { return '```chart\nA: 1\n```'; }, createdAt: '',
    completionStatus: 'completed' as const, truncated: false };
  const archived = collectSessionCanvasArtifacts([message], '', false);
  const getter = vi.spyOn(message, 'content', 'get');
  const result = collectSessionCanvasArtifacts([message], '```chart\nB: 2', true, {}, archived);
  expect(getter).not.toHaveBeenCalled();
  expect(result.map(item => item.messageId)).toEqual(['archived', 'streaming_in_flight']);
  getter.mockRestore();
});
