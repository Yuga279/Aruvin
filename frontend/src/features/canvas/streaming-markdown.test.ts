/**
 * ============================================================================
 * FILE: streaming-markdown.test.ts
 * LOCATION: frontend/src/features/canvas/streaming-markdown.test.ts
 * ============================================================================
 * PURPOSE:
 *    Verify streaming parse equivalence and deterministic prefix work reduction.
 * ROLE IN PROJECT:
 *    Guards shared Canvas extraction/render preparation without browser timing.
 * KEY COMPONENTS:
 *    - Prefix work counts and progressive parser/artifact equivalence checks.
 * ============================================================================
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMarkdown } from '../chat/markdown/parse-markdown.ts';
import { SafeMarkdown } from '../chat/markdown/safe-markdown.tsx';
import { parseCanvasCodeBlock, prepareCanvasMarkdown, preprocessCanvasTags } from './canvas-artifacts.ts';

vi.mock('../chat/markdown/parse-markdown.ts', { spy: true });

describe('streaming Markdown preparation', () => {
  it('does not repeatedly tokenize completed prefix lines', () => {
    vi.mocked(parseMarkdown).mockClear();
    let content = '';
    const snapshots = [prepareCanvasMarkdown(content, 'work-growth', true)];
    for (let index = 0; index < 120; index += 1) {
      content += `Completed **line ${index}**.\n`;
      const next = prepareCanvasMarkdown(content, 'work-growth', true);
      snapshots.push(next);
    }
    const parsedChars = vi.mocked(parseMarkdown).mock.calls.reduce((sum, [text]) => sum + text.length, 0);
    expect(parsedChars).toBe(content.length);
    expect(snapshots[120]!.tokens[0]).toBe(snapshots[1]!.tokens[0]);
  });

  it('reuses completed artifact descriptors and renders the same partial/final markup after eviction', () => {
    const prefix = 'Intro **bold**\n```chart\nA: 1\n```\n';
    const first = prepareCanvasMarkdown(prefix, 'render-equivalence', true);
    const next = prepareCanvasMarkdown(`${prefix}More $x^2$`, 'render-equivalence', true);
    expect(next.artifacts[0]).toBe(first.artifacts[0]);
    for (const isStreaming of [true, false]) {
      for (const suffix of ['More $x^2$', '\\[x\n+y', '- one\n- two\n', '<aurvin-canvas type="chart">B: 2']) {
        const content = prefix + suffix;
        const render = () => renderToStaticMarkup(createElement(SafeMarkdown, {
          content, messageId: 'render-equivalence', isStreaming,
        }));
        const incremental = render();
        // Exceed the existing bounded cache to force the independent full-parse path.
        for (let index = 0; index < 33; index += 1) {
          prepareCanvasMarkdown('Eviction', `eviction-${index}`, true);
        }
        expect(render()).toBe(incremental);
      }
    }
  });

  it('matches full parsing and artifact IDs at every split, including final output', () => {
    const sources = [
      '# Heading\r\nPlain **bold** and $x$.\r\n- one\r\n- two\r\n\r\n1. first\r\n2. second\r\n> quote\n',
      'Before\n```mermaid title="Flow"\nflowchart TD\nA-->B\n```\nAfter\n```chart\nA: 2\n```\n',
      'Before\n<aurvin-canvas type="chart"\n title="Data">\r\nA: 2\r\n</aurvin-canvas>\nAfter',
      '$$x\n+y\n$$\n\\[z\n+q\\]\n$$inline$$\n```text\nunclosed\n',
      '- list\n```chart\nA: 1\n```\n<aurvin-canvas type="svg"><svg></svg></aurvin-canvas>',
    ];
    for (const [sourceIndex, source] of sources.entries()) {
      const id = `equivalence-${sourceIndex}`;
      for (let end = 0; end <= source.length; end += 1) {
        const content = source.slice(0, end);
        for (const streaming of [true, false]) {
          const actual = prepareCanvasMarkdown(content, id, streaming);
          const expectedTokens = parseMarkdown(preprocessCanvasTags(content));
          let ordinal = 0;
          const expectedArtifacts = expectedTokens.map((token) => {
            const artifact = token.type === 'code_block'
              ? parseCanvasCodeBlock(token.lang, token.code, id, ordinal, streaming) : null;
            if (artifact) ordinal += 1;
            return artifact;
          });
          expect(actual.tokens).toEqual(expectedTokens);
          expect(actual.tokenArtifacts).toEqual(expectedArtifacts);
          expect(actual.artifacts).toEqual(expectedArtifacts.filter(Boolean));
        }
      }
    }
  });

  it('isolates replacements, resets, sessions and cached identical preparations', () => {
    const original = 'Intro\n```chart\nA: 1\n```\n';
    const first = prepareCanvasMarkdown(original, 'session-a', true);
    expect(prepareCanvasMarkdown(original, 'session-a', true)).toBe(first);
    for (const content of ['Different\n- list', '', original, 'Intro\nplain\n']) {
      expect(prepareCanvasMarkdown(content, 'session-a', true).tokens)
        .toEqual(parseMarkdown(preprocessCanvasTags(content)));
    }
    const other = prepareCanvasMarkdown(original, 'session-b', true);
    expect(other.artifacts[0]?.artifactId).toBe('session-b::canvas::0');
    expect(first.artifacts[0]?.artifactId).toBe('session-a::canvas::0');
  });
});
