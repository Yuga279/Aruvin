/**
 * ============================================================================
 * FILE: safe-markdown.tsx
 * LOCATION: frontend/src/features/chat/markdown/safe-markdown.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Render parsed Markdown tokens as sanitized React elements.
 *
 * ROLE IN PROJECT:
 *    Converts assistant transcript text into headings, lists, code, and links
 *    without dangerouslySetInnerHTML, disarming unsafe URI schemes as it goes.
 *
 * KEY COMPONENTS:
 *    - renderInlineText: Bold, italic, code, and sanitized links.
 *    - SafeMarkdown: Token-to-DOM renderer for progressive stream content.
 * ============================================================================
 */

import { memo, useMemo, type ReactNode } from 'react';
import {
  CanvasArtifactCard,
} from '../../canvas/index.ts';
import { prepareCanvasMarkdown } from '../../canvas/canvas-artifacts.ts';
import type { MarkdownToken } from './parse-markdown.ts';
import { sanitizeUrl } from './sanitize-url.ts';

const MATH_SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', div: '÷', cdot: '·', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  pm: '±', mp: '∓', oplus: '⊕', otimes: '⊗',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
  cong: '≅', equiv: '≡', sim: '∼', simeq: '≃', propto: '∝', ll: '≪', gg: '≫',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', iff: '⇔', implies: '⇒',
  impliedby: '⇐', mapsto: '↦', uparrow: '↑', downarrow: '↓',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', nexists: '∄',
  neg: '¬', lnot: '¬', land: '∧', lor: '∨',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆',
  supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  angle: '∠', measuredangle: '∡', triangle: '△', perp: '⊥', parallel: '∥',
  degree: '°', prime: '′', sum: '∑', prod: '∏', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  dots: '…', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  qquad: '\u2003\u2003', quad: '\u2003', ';': '\u2004', ':': '\u2005', ',': '\u2009',
  '!': '', ' ': '\u00a0', '{': '{', '}': '}', '|': '‖', '%': '%', '&': '&', '#': '#', '_': '_',
};

const MATH_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim', 'sup', 'inf',
  'min', 'max', 'det', 'dim', 'ker', 'deg', 'gcd', 'lcm', 'mod', 'arg',
]);

const SIZING_COMMANDS = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'middle']);
const BLACKBOARD_BOLD: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' };

function readMathArg(src: string, start: number): { value: string; next: number } {
  let i = start;
  while (i < src.length && /\s/.test(src[i] ?? '')) i += 1;
  if (i >= src.length) return { value: '', next: i };
  if (src[i] === '{') {
    let depth = 1;
    i += 1;
    const contentStart = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '\\') {
        i += 2;
        continue;
      }
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    return { value: src.slice(contentStart, depth === 0 ? i - 1 : i), next: i };
  }
  if (src[i] === '\\') {
    let end = i + 1;
    while (end < src.length && /[A-Za-z]/.test(src[end] ?? '')) end += 1;
    if (end === i + 1 && end < src.length) end += 1;
    return { value: src.slice(i, end), next: end };
  }
  return { value: src[i] ?? '', next: i + 1 };
}

function renderMathInline(expr: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) {
      nodes.push(buf);
      buf = '';
    }
  };

  while (i < expr.length) {
    const ch = expr[i] ?? '';
    if (ch === '{' || ch === '}') {
      i += 1;
      continue;
    }
    if (ch === '^' || ch === '_') {
      const arg = readMathArg(expr, i + 1);
      i = arg.next;
      if (ch === '^' && (arg.value === '\\circ' || arg.value === '∘')) {
        buf += '°';
        continue;
      }
      flush();
      const children = renderMathInline(arg.value, `${keyPrefix}-s-${i}`);
      nodes.push(ch === '^' ? <sup key={`${keyPrefix}-sup-${i}`}>{children}</sup> : <sub key={`${keyPrefix}-sub-${i}`}>{children}</sub>);
      continue;
    }
    if (ch === '\\') {
      let end = i + 1;
      while (end < expr.length && /[A-Za-z]/.test(expr[end] ?? '')) end += 1;
      if (end === i + 1 && end < expr.length) end += 1;
      const cmd = expr.slice(i + 1, end);
      i = end;

      if (SIZING_COMMANDS.has(cmd)) {
        if (cmd === 'right' && expr[i] === '.') i += 1;
        continue;
      }
      if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac' || cmd === 'cfrac') {
        flush();
        const num = readMathArg(expr, i);
        const den = readMathArg(expr, num.next);
        i = den.next;
        nodes.push(
          <span key={`${keyPrefix}-f-${i}`} className="aurvin-math-frac">
            <span className="aurvin-math-num">{renderMathInline(num.value, `${keyPrefix}-fn-${i}`)}</span>
            <span className="sr-only">/</span>
            <span className="aurvin-math-den">{renderMathInline(den.value, `${keyPrefix}-fd-${i}`)}</span>
          </span>,
        );
        continue;
      }
      if (cmd === 'sqrt') {
        flush();
        let degree = '';
        while (i < expr.length && /\s/.test(expr[i] ?? '')) i += 1;
        if (expr[i] === '[') {
          const close = expr.indexOf(']', i + 1);
          if (close !== -1) {
            degree = expr.slice(i + 1, close);
            i = close + 1;
          }
        }
        const rad = readMathArg(expr, i);
        i = rad.next;
        nodes.push(
          <span key={`${keyPrefix}-sq-${i}`} className="aurvin-math-sqrt">
            {degree ? <sup>{renderMathInline(degree, `${keyPrefix}-sqd-${i}`)}</sup> : null}
            <span aria-hidden="true">√</span>
            <span className="aurvin-math-sqrt-body">{renderMathInline(rad.value, `${keyPrefix}-sqr-${i}`)}</span>
          </span>,
        );
        continue;
      }
      if (cmd === 'text' || cmd === 'textrm' || cmd === 'textup' || cmd === 'mathrm' || cmd === 'operatorname') {
        flush();
        const arg = readMathArg(expr, i);
        i = arg.next;
        nodes.push(<span key={`${keyPrefix}-t-${i}`} className="aurvin-math-text">{arg.value}</span>);
        continue;
      }
      if (cmd === 'textbf' || cmd === 'mathbf' || cmd === 'boldsymbol') {
        flush();
        const arg = readMathArg(expr, i);
        i = arg.next;
        nodes.push(<strong key={`${keyPrefix}-mb-${i}`}>{renderMathInline(arg.value, `${keyPrefix}-mb-${i}`)}</strong>);
        continue;
      }
      if (cmd === 'textit' || cmd === 'mathit' || cmd === 'emph') {
        flush();
        const arg = readMathArg(expr, i);
        i = arg.next;
        nodes.push(<em key={`${keyPrefix}-mi-${i}`}>{renderMathInline(arg.value, `${keyPrefix}-mi-${i}`)}</em>);
        continue;
      }
      if (cmd === 'mathbb') {
        const arg = readMathArg(expr, i);
        i = arg.next;
        buf += BLACKBOARD_BOLD[arg.value] ?? arg.value;
        continue;
      }
      if (MATH_FUNCTIONS.has(cmd)) {
        flush();
        nodes.push(<span key={`${keyPrefix}-fn-${i}`} className="aurvin-math-fn">{cmd}</span>);
        if (i < expr.length && /[A-Za-z0-9]/.test(expr[i] ?? '')) buf += '\u2009';
        continue;
      }
      if (cmd in MATH_SYMBOLS) {
        buf += MATH_SYMBOLS[cmd];
        while (i < expr.length && expr[i] === ' ') i += 1;
        continue;
      }
      buf += cmd;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return nodes;
}

function renderMathBlock(expression: string, keyPrefix: string): ReactNode {
  const cleaned = expression
    .replace(/\\(?:begin|end)\{[^}]+\}/g, '')
    .replace(/&/g, ' ')
    .trim();
  const rows = cleaned.includes('\\\\')
    ? cleaned.split(/\\\\/).map((row) => row.trim()).filter(Boolean)
    : [cleaned.replace(/\s*\n\s*/g, ' ')];

  return (
    <div key={keyPrefix} className="aurvin-math-block">
      {rows.map((row, rowIdx) => (
        <div key={`${keyPrefix}-r-${rowIdx}`} className="aurvin-math">
          {renderMathInline(row, `${keyPrefix}-r-${rowIdx}`)}
        </div>
      ))}
    </div>
  );
}

function formatInlineStyles(text: string, keyPrefix: string): ReactNode {
  const nodes: ReactNode[] = [];
  const regex = /(`[^`]+`|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\\\((?:(?!\\\))[\s\S])+$|\$\$[^$]+\$\$|\$(?!\s)(?:\\.|[^$\\\n])+?(?<!\s)\$(?!\d)|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-c-${index}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('\\[') && token.endsWith('\\]')) {
      nodes.push(
        <span key={`${keyPrefix}-mb-${index}`} className="aurvin-math">
          {renderMathInline(token.slice(2, -2).trim(), `${keyPrefix}-mb-${index}`)}
        </span>,
      );
    } else if (token.startsWith('\\(')) {
      const inner = token.endsWith('\\)') ? token.slice(2, -2).trim() : token.slice(2).trim();
      nodes.push(
        <span key={`${keyPrefix}-m-${index}`} className="aurvin-math">
          {renderMathInline(inner, `${keyPrefix}-m-${index}`)}
        </span>,
      );
    } else if (token.startsWith('$$')) {
      nodes.push(
        <span key={`${keyPrefix}-md-${index}`} className="aurvin-math">
          {renderMathInline(token.slice(2, -2).trim(), `${keyPrefix}-md-${index}`)}
        </span>,
      );
    } else if (token.startsWith('$')) {
      nodes.push(
        <span key={`${keyPrefix}-ms-${index}`} className="aurvin-math">
          {renderMathInline(token.slice(1, -1).trim(), `${keyPrefix}-ms-${index}`)}
        </span>,
      );
    } else if (token.startsWith('***')) {
      nodes.push(
        <strong key={`${keyPrefix}-bi-${index}`}>
          <em>{formatInlineStyles(token.slice(3, -3), `${keyPrefix}-bi-${index}`)}</em>
        </strong>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${index}`}>
          {formatInlineStyles(token.slice(2, -2), `${keyPrefix}-b-${index}`)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={`${keyPrefix}-i-${index}`}>
          {formatInlineStyles(token.slice(1, -1), `${keyPrefix}-i-${index}`)}
        </em>,
      );
    }

    lastIndex = regex.lastIndex;
    index += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  if (nodes.length === 0) {
    return text;
  }
  return nodes;
}

function renderInlineText(text: string): ReactNode[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let linkIndex = 0;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(formatInlineStyles(text.slice(lastIndex, match.index), `pre-${linkIndex}`));
    }

    const linkText = match[1] ?? '';
    const rawHref = match[2] ?? '';
    const safeHref = sanitizeUrl(rawHref);
    const formattedLinkText = formatInlineStyles(linkText, `lnk-${linkIndex}`);

    if (safeHref) {
      parts.push(
        <a
          key={`link-${match.index}`}
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="aurvin-link"
        >
          {formattedLinkText}
        </a>,
      );
    } else {
      parts.push(<span key={`disarmed-${match.index}`}>{formattedLinkText}</span>);
    }

    lastIndex = linkRegex.lastIndex;
    linkIndex += 1;
  }

  if (lastIndex < text.length) {
    parts.push(formatInlineStyles(text.slice(lastIndex), 'tail'));
  }

  return parts;
}

export type SafeMarkdownProps = {
  content: string;
  messageId?: string;
  isStreaming?: boolean;
  activeArtifactId?: string | null;
  onOpenArtifact?: (artifactId: string) => void;
};

export function SafeMarkdown({
  content,
  messageId = 'msg',
  isStreaming = false,
  activeArtifactId = null,
  onOpenArtifact,
}: SafeMarkdownProps) {
  const { tokens, tokenArtifacts } = useMemo(
    () => prepareCanvasMarkdown(content, messageId, isStreaming),
    [content, messageId, isStreaming],
  );

  return (
    <div className="aurvin-markdown">
      {tokens.map((token: MarkdownToken, idx: number) => {
        const artifact = tokenArtifacts[idx];
        return artifact ? (
          <CanvasArtifactCard
            key={idx}
            artifact={artifact}
            isActive={activeArtifactId === artifact.artifactId}
            onOpen={onOpenArtifact}
          />
        ) : <MarkdownTokenContent key={idx} token={token} idx={idx} />;
      })}
    </div>
  );
}

// Prefix token identity survives stream appends. Keep inline/math rendering out
// of artifact selection and callback updates, which do not change prose content.
const MarkdownTokenContent = memo(function MarkdownTokenContent({ token, idx }: {
  token: MarkdownToken;
  idx: number;
}) {
  switch (token.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, token.level));
      const children = renderInlineText(token.text);
      if (level === 1) return <h1>{children}</h1>;
      if (level === 2) return <h2>{children}</h2>;
      if (level === 3) return <h3>{children}</h3>;
      if (level === 4) return <h4>{children}</h4>;
      if (level === 5) return <h5>{children}</h5>;
      return <h6>{children}</h6>;
    }
    case 'code_block':
      return (
        <div className="aurvin-code-block">
          {token.lang ? <div className="aurvin-code-header">{token.lang}</div> : null}
          <pre><code>{token.code}</code></pre>
        </div>
      );
    case 'math_block':
      return renderMathBlock(token.expression, `math-block-${idx}`);
    case 'blockquote':
      return <blockquote className="aurvin-blockquote">{renderInlineText(token.text)}</blockquote>;
    case 'bullet_list':
      return (
        <ul className="aurvin-list">
          {token.items.map((item, itemIdx) => <li key={itemIdx}>{renderInlineText(item)}</li>)}
        </ul>
      );
    case 'ordered_list':
      return (
        <ol className="aurvin-list">
          {token.items.map((item, itemIdx) => <li key={itemIdx}>{renderInlineText(item)}</li>)}
        </ol>
      );
    case 'paragraph':
    default:
      return <p>{renderInlineText(token.text)}</p>;
  }
});
