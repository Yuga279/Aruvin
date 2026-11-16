/**
 * ============================================================================
 * FILE: parse-markdown.ts
 * LOCATION: frontend/src/features/chat/markdown/parse-markdown.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Tokenize progressive Markdown, including unclosed streaming code fences.
 *
 * ROLE IN PROJECT:
 *    Zero-dependency parser used by SafeMarkdown so assistant text can render
 *    incrementally without waiting for a complete document or a HTML library.
 *
 * KEY COMPONENTS:
 *    - MarkdownToken: Heading, code, quote, list, and paragraph shapes.
 *    - parseMarkdown: Line-oriented tokenizer with streaming fence support.
 * ============================================================================
 */

export type MarkdownToken =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code_block'; lang: string; code: string }
  | { type: 'math_block'; expression: string }
  | { type: 'blockquote'; text: string }
  | { type: 'bullet_list'; items: string[] }
  | { type: 'ordered_list'; items: string[] }
  | { type: 'paragraph'; text: string };

export function parseMarkdown(
  markdown: string,
  // Reports offsets in CRLF-normalized text, before the unfinished tail.
  onStablePrefix?: (chars: number, tokenCount: number) => void,
): MarkdownToken[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const tokens: MarkdownToken[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let inMathBlock: '\\]' | '$$' | null = null;
  let mathBlockLines: string[] = [];
  let pendingListType: 'bullet' | 'ordered' | null = null;
  let pendingListItems: string[] = [];
  let offset = 0;
  let stableChars = 0;
  let stableTokenCount = 0;

  function flushList() {
    if (pendingListType === 'bullet' && pendingListItems.length > 0) {
      tokens.push({ type: 'bullet_list', items: [...pendingListItems] });
    } else if (pendingListType === 'ordered' && pendingListItems.length > 0) {
      tokens.push({ type: 'ordered_list', items: [...pendingListItems] });
    }
    pendingListType = null;
    pendingListItems = [];
  }

  for (let i = 0; i < lines.length; i++) {
    // Only a complete line with no open multi-line construct can be retained.
    // The last (possibly partial) line is always reparsed on the next update.
    if (!inCodeBlock && !inMathBlock && !pendingListType) {
      stableChars = offset;
      stableTokenCount = tokens.length;
    }
    const line = lines[i] ?? '';
    offset += line.length + 1;
    const trimmed = line.trim();

    if (inCodeBlock) {
      if (trimmed.startsWith('```')) {
        tokens.push({
          type: 'code_block',
          lang: codeBlockLang,
          code: codeBlockLines.join('\n'),
        });
        inCodeBlock = false;
        codeBlockLang = '';
        codeBlockLines = [];
      } else {
        codeBlockLines.push(line);
      }
      continue;
    }

    if (inMathBlock) {
      if (trimmed.endsWith(inMathBlock)) {
        const beforeClose = trimmed.slice(0, -inMathBlock.length).trim();
        if (beforeClose) {
          mathBlockLines.push(beforeClose);
        }
        tokens.push({
          type: 'math_block',
          expression: mathBlockLines.join('\n').trim(),
        });
        inMathBlock = null;
        mathBlockLines = [];
      } else if (trimmed !== '') {
        mathBlockLines.push(line);
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushList();
      inCodeBlock = true;
      codeBlockLang = trimmed.slice(3).trim();
      codeBlockLines = [];
      continue;
    }

    if (trimmed.startsWith('\\[')) {
      flushList();
      if (trimmed.endsWith('\\]') && trimmed.length >= 4) {
        tokens.push({
          type: 'math_block',
          expression: trimmed.slice(2, -2).trim(),
        });
      } else {
        inMathBlock = '\\]';
        const afterOpen = trimmed.slice(2).trim();
        mathBlockLines = afterOpen ? [afterOpen] : [];
      }
      continue;
    }

    if (trimmed.startsWith('$$')) {
      flushList();
      if (trimmed.endsWith('$$') && trimmed.length >= 4) {
        tokens.push({
          type: 'math_block',
          expression: trimmed.slice(2, -2).trim(),
        });
      } else {
        inMathBlock = '$$';
        const afterOpen = trimmed.slice(2).trim();
        mathBlockLines = afterOpen ? [afterOpen] : [];
      }
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch?.[1] && headingMatch[2] !== undefined) {
      flushList();
      tokens.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushList();
      tokens.push({
        type: 'blockquote',
        text: trimmed.replace(/^>\s?/, ''),
      });
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bulletMatch?.[1] !== undefined) {
      if (pendingListType !== 'bullet') {
        flushList();
        pendingListType = 'bullet';
      }
      pendingListItems.push(bulletMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (orderedMatch?.[1] !== undefined) {
      if (pendingListType !== 'ordered') {
        flushList();
        pendingListType = 'ordered';
      }
      pendingListItems.push(orderedMatch[1]);
      continue;
    }

    if (trimmed === '') {
      flushList();
      continue;
    }

    flushList();
    tokens.push({ type: 'paragraph', text: trimmed });
  }

  if (inCodeBlock) {
    tokens.push({
      type: 'code_block',
      lang: codeBlockLang,
      code: codeBlockLines.join('\n'),
    });
  }

  if (inMathBlock) {
    tokens.push({
      type: 'math_block',
      expression: mathBlockLines.join('\n').trim(),
    });
  }

  flushList();
  onStablePrefix?.(stableChars, stableTokenCount);
  return tokens;
}
