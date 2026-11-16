/**
 * ============================================================================
 * FILE: markdown.test.ts
 * LOCATION: frontend/src/features/chat/markdown/markdown.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Markdown tokenization, URL sanitizing, and XSS disarming.
 *
 * ROLE IN PROJECT:
 *    Ensures progressive assistant rendering stays safe without a browser DOM
 *    or HTML sanitizer dependency.
 *
 * KEY COMPONENTS:
 *    - sanitizeUrl tests: Protocol whitelist and dangerous-scheme rejection.
 *    - parseMarkdown tests: Headings, fences, lists, quotes, raw HTML text.
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './parse-markdown.ts';
import { SafeMarkdown } from './safe-markdown.tsx';
import { sanitizeUrl } from './sanitize-url.ts';

describe('sanitizeUrl', () => {
  it('allows http, https, and mailto protocols', () => {
    expect(sanitizeUrl('https://example.com/test')).toBe('https://example.com/test');
    expect(sanitizeUrl('http://insecure.org')).toBe('http://insecure.org');
    expect(sanitizeUrl('mailto:peter@example.com')).toBe('mailto:peter@example.com');
  });

  it('disarms dangerous protocols: javascript, data, vbscript, and file', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBe('');
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(sanitizeUrl('vbscript:msgbox("evil")')).toBe('');
    expect(sanitizeUrl('file:///etc/passwd')).toBe('');
  });

  it('allows safe relative paths', () => {
    expect(sanitizeUrl('/docs/quickstart')).toBe('/docs/quickstart');
    expect(sanitizeUrl('#heading-1')).toBe('#heading-1');
  });
});

describe('parseMarkdown', () => {
  it('parses headings correctly', () => {
    const tokens = parseMarkdown('# Heading 1\n## Heading 2\n### Heading 3');
    expect(tokens).toEqual([
      { type: 'heading', level: 1, text: 'Heading 1' },
      { type: 'heading', level: 2, text: 'Heading 2' },
      { type: 'heading', level: 3, text: 'Heading 3' },
    ]);
  });

  it('parses closed and unclosed (streaming) fenced code blocks', () => {
    const closed = parseMarkdown('```typescript\nconst x = 1;\n```');
    expect(closed).toEqual([
      { type: 'code_block', lang: 'typescript', code: 'const x = 1;' },
    ]);

    const unclosed = parseMarkdown('```python\ndef test():\n    return 42');
    expect(unclosed).toEqual([
      { type: 'code_block', lang: 'python', code: 'def test():\n    return 42' },
    ]);
  });

  it('parses inline formatting: bold, italic, inline code, and links', () => {
    const text = 'Here is **bold**, *italic*, `code`, and [Link](https://google.com)';
    const tokens = parseMarkdown(text);
    expect(tokens[0]?.type).toBe('paragraph');
  });

  it('parses blockquotes and bullet lists', () => {
    const content = '> A wise quote\n\n- Item 1\n- Item 2\n\n1. First\n2. Second';
    const tokens = parseMarkdown(content);
    expect(tokens.some((t) => t.type === 'blockquote')).toBe(true);
    expect(tokens.some((t) => t.type === 'bullet_list')).toBe(true);
    expect(tokens.some((t) => t.type === 'ordered_list')).toBe(true);
  });

  it('treats raw HTML as plain paragraph text', () => {
    const tokens = parseMarkdown('<script>alert(1)</script>');
    expect(tokens).toEqual([{ type: 'paragraph', text: '<script>alert(1)</script>' }]);
  });

  it('parses single-line, multi-line, and streaming math blocks', () => {
    const multi = parseMarkdown(
      '\\[\n\n\\sin(\\theta)=\\frac35,\\qquad\n\n\\cos(\\theta)=\\frac45\n\n\\]',
    );
    expect(multi).toEqual([
      {
        type: 'math_block',
        expression: '\\sin(\\theta)=\\frac35,\\qquad\n\\cos(\\theta)=\\frac45',
      },
    ]);

    const streaming = parseMarkdown('\\[\n\\tan(\\theta)=\\frac34');
    expect(streaming).toEqual([
      { type: 'math_block', expression: '\\tan(\\theta)=\\frac34' },
    ]);
  });

  it('renders inline and block LaTeX mathematical symbols and fractions in SafeMarkdown', () => {
    const sample = [
      'For an angle \\( \\theta \\), label the sides:',
      '- **Sine:** \\(\\sin(\\theta)=\\dfrac{\\text{opposite}}{\\text{hypotenuse}}\\)',
      '\\[',
      '\\sin(\\theta)=\\frac35,\\qquad',
      '\\cos(\\theta)=\\frac45,\\qquad',
      '\\tan(\\theta)=\\frac34',
      '\\]',
    ].join('\n');

    const html = renderToStaticMarkup(createElement(SafeMarkdown, { content: sample }));
    expect(html).toContain('θ');
    expect(html).toContain('class="aurvin-math-fn">sin</span>');
    expect(html).toContain('class="aurvin-math-text">opposite</span>');
    expect(html).toContain('class="aurvin-math-text">hypotenuse</span>');
    expect(html).toContain('class="aurvin-math-frac"');
    expect(html).toContain('class="aurvin-math-block"');
    expect(html).not.toContain('\\(');
    expect(html).not.toContain('\\[');
    expect(html).not.toContain('\\theta');
    expect(html).not.toContain('\\dfrac');
    expect(html).not.toContain('\\frac35');
  });
});
