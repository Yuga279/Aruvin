/**
 * ============================================================================
 * FILE: speech-prose.ts
 * LOCATION: backend/src/voice/agent/speech-prose.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Incremental safe prose normalizer and visual suffix extractor for streamed speech synthesis.
 *
 * ROLE IN PROJECT:
 *    Filters streaming model tokens to safe spoken prose: removes hidden tags,
 *    code fences, raw JSON, markdown tables, and unpronounceable syntax while
 *    preserving factual names, numbers, dates, and negations. Captures closed,
 *    bounded Canvas visual suffixes into structured artifacts without speech syntax leakage.
 *
 * KEY COMPONENTS:
 *    - SpeechProse: Bounded incremental prose filter and unit-level emitter.
 *    - classifyVisual: Classifies fences and aurvin-canvas blocks into CanvasArtifactSource.
 * ============================================================================
 */

import { AppError } from '../../platform/errors/app-error.js';
import {
  CANVAS_ARTIFACT_LIMITS,
  isCanvasArtifactSource,
  type CanvasArtifactKind,
  type CanvasArtifactSource,
} from '../../contracts/voice-wire.js';

const MERMAID_HEADER_RE =
  /^(?:---\s*\n[\s\S]*?\n---\s*\n\s*)?(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|pie|xychart-beta|quadrantChart|gantt|mindmap)\b/i;

const SUPPORTED_VISUAL_TOKENS = new Set([
  'mermaid', 'mmd',
  'chart', 'graph', 'plot', 'scatter', 'xy', 'xy-plot',
  'line-graph', 'bar-chart', 'line-chart', 'pie-chart', 'area-chart',
  'svg', 'canvas',
]);

function getAttr(info: string, name: string): { val?: string; conflict: boolean } {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'gi');
  let match: RegExpExecArray | null;
  const values: string[] = [];
  while ((match = re.exec(info)) !== null) {
    values.push((match[1] ?? match[2] ?? match[3] ?? '').trim());
  }
  if (values.length === 0) return { conflict: false };
  const first = values[0];
  if (values.some(v => v.toLowerCase() !== first.toLowerCase())) return { conflict: true };
  return { val: first, conflict: false };
}

function stripMermaidFrontmatter(code: string): { title?: string; body: string } {
  let text = code.replace(/\r\n/g, '\n').trim();
  let frontmatterTitle: string | undefined;
  const fmMatch = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (fmMatch?.[1]) {
    const tMatch = /^\s*title\s*:\s*(.+)$/im.exec(fmMatch[1]);
    if (tMatch?.[1]) {
      frontmatterTitle = tMatch[1].trim().replace(/^["']|["']$/g, '');
    }
    text = text.slice(fmMatch[0].length).trim();
  }
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('%%')) continue;
    lines.push(line);
  }
  return { title: frontmatterTitle, body: lines.join('\n').trim() };
}

function normalizeChartSubtype(rawType?: string, jsonPayload?: Record<string, unknown>): string {
  const lower = (rawType ?? '').toLowerCase().trim();
  if (lower.includes('scatter') || lower.includes('point') || lower.includes('xy') || lower.includes('plot')) {
    if (jsonPayload?.showLine || (Array.isArray(jsonPayload?.datasets) && jsonPayload.datasets.some((d: any) => d && d.showLine))) {
      return 'Coordinate Graph';
    }
    return 'X-Y Point Plot';
  }
  if (lower.includes('line') || lower.includes('graph') || lower.includes('curve')) {
    return 'Line Graph';
  }
  if (lower.includes('area')) return 'Area Graph';
  if (lower.includes('pie') || lower.includes('donut') || lower.includes('doughnut')) return 'Pie Chart';
  return 'Bar Chart';
}

function classifyVisual(
  firstToken: string,
  info: string,
  body: string,
): { kind: CanvasArtifactKind; subType: string; title: string; rawSource: string } | null {
  const rawSource = body.replace(/\r\n/g, '\n').trim();
  if (!rawSource) return null;
  if (
    rawSource.length > CANVAS_ARTIFACT_LIMITS.sourceMaxChars ||
    new TextEncoder().encode(rawSource).byteLength > CANVAS_ARTIFACT_LIMITS.sourceMaxBytes
  ) {
    return null;
  }

  const titleAttr = getAttr(info, 'title');
  const typeAttr = getAttr(info, 'type');
  if (titleAttr.conflict || typeAttr.conflict) return null;

  const explicitTitle = titleAttr.val;
  const explicitType = typeAttr.val?.toLowerCase();
  const trailingPlainTitle =
    !explicitTitle && !info.includes('=') && info.length > firstToken.length
      ? info.slice(firstToken.length).trim().replace(/^["']|["']$/g, '')
      : undefined;
  const titleCandidate = explicitTitle || trailingPlainTitle;

  let kind: CanvasArtifactKind | null = null;
  if (firstToken === 'mermaid' || firstToken === 'mmd') {
    kind = 'mermaid';
  } else if (
    ['chart', 'graph', 'plot', 'scatter', 'xy', 'xy-plot',
      'line-graph', 'bar-chart', 'line-chart', 'pie-chart', 'area-chart'].includes(firstToken)
  ) {
    kind = 'chart';
  } else if (firstToken === 'svg') {
    kind = 'svg';
  } else if (firstToken === 'canvas') {
    if (['mermaid', 'diagram', 'flowchart'].includes(explicitType ?? '')) {
      kind = 'mermaid';
    } else if (
      ['chart', 'graph', 'plot', 'scatter', 'xy', 'bar', 'line', 'pie', 'area'].includes(explicitType ?? '')
    ) {
      kind = 'chart';
    } else if (explicitType === 'svg') {
      kind = 'svg';
    } else if (MERMAID_HEADER_RE.test(rawSource)) {
      kind = 'mermaid';
    } else if (/^\s*<svg\b/i.test(rawSource)) {
      kind = 'svg';
    } else {
      kind = 'chart';
    }
  } else if (firstToken === 'json') {
    if (
      rawSource.startsWith('{') &&
      /"type"\s*:\s*"(?:bar|line|area|pie|donut|doughnut|scatter|point|xy|plot|graph)"/i.test(rawSource) &&
      (/"datasets"\s*:/i.test(rawSource) || /"data"\s*:/i.test(rawSource) || /"points"\s*:/i.test(rawSource))
    ) {
      kind = 'chart';
    } else {
      return null;
    }
  } else if (firstToken === '' && MERMAID_HEADER_RE.test(rawSource)) {
    kind = 'mermaid';
  }

  if (!kind) return null;

  if (kind === 'mermaid') {
    if (!MERMAID_HEADER_RE.test(rawSource)) return null;
    const { title: fmTitle, body: cleanBody } = stripMermaidFrontmatter(rawSource);
    const titleDirective = /^\s*(?:title|accTitle)\s*:?\s+(.+)$/im.exec(cleanBody)?.[1]?.trim().replace(/^["']|["']$/g, '');
    const firstLine = cleanBody.split('\n')[0]?.trim() ?? '';

    let subType = 'Flowchart';
    let inferredTitle: string | undefined = fmTitle ?? titleDirective;

    if (/^pie\b/i.test(firstLine)) {
      subType = 'Pie Chart';
      const pieTitle = /^pie\s+(?:showData\s+)?title\s+(.+)$/i.exec(firstLine)?.[1]?.trim().replace(/^["']|["']$/g, '');
      inferredTitle = pieTitle || inferredTitle || 'Pie Chart';
    } else if (/^(?:xychart-beta|quadrantChart)\b/i.test(firstLine)) {
      subType = 'Coordinate Graph';
      inferredTitle = inferredTitle || 'Coordinate Graph';
    } else if (/^gantt\b/i.test(firstLine)) {
      subType = 'Timeline Chart';
      inferredTitle = inferredTitle || 'Timeline Chart';
    } else if (/^sequenceDiagram\b/i.test(firstLine)) {
      subType = 'Sequence Diagram';
      inferredTitle = inferredTitle || 'Sequence Diagram';
    } else if (/^stateDiagram(?:-v2)?\b/i.test(firstLine)) {
      subType = 'State Diagram';
      inferredTitle = inferredTitle || 'State Diagram';
    } else if (/^classDiagram\b/i.test(firstLine)) {
      subType = 'Class Diagram';
      inferredTitle = inferredTitle || 'Class Diagram';
    } else if (/^erDiagram\b/i.test(firstLine)) {
      subType = 'ER Diagram';
      inferredTitle = inferredTitle || 'ER Diagram';
    } else if (/^mindmap\b/i.test(firstLine)) {
      subType = 'Mindmap';
      inferredTitle = inferredTitle || 'Mindmap';
    } else {
      subType = 'Flowchart';
      inferredTitle = inferredTitle || 'Flowchart';
    }

    const title = (titleCandidate || inferredTitle || subType).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
    return { kind, subType, title: title || subType, rawSource };
  }

  if (kind === 'chart') {
    if (rawSource.startsWith('{') || rawSource.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawSource);
      } catch {
        return null;
      }
      if (parsed === null || typeof parsed !== 'object') return null;

      const rec = parsed as Record<string, unknown>;
      const jsonTitle = typeof rec.title === 'string' ? rec.title.trim() : undefined;
      const jsonType = typeof rec.type === 'string' ? rec.type.toLowerCase().trim() : undefined;

      let subType = 'Bar Chart';
      if (jsonType) {
        subType = normalizeChartSubtype(jsonType, rec);
      } else if (firstToken === 'graph') {
        subType = 'Line Graph';
      } else if (firstToken === 'scatter' || firstToken === 'plot' || firstToken === 'xy' || firstToken === 'xy-plot') {
        subType = 'X-Y Point Plot';
      } else if (explicitType) {
        subType = normalizeChartSubtype(explicitType, rec);
      }

      const title = (titleCandidate || jsonTitle || subType).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
      return { kind, subType, title: title || subType, rawSource };
    }

    // Line-oriented chart
    const lines = rawSource.split('\n').map(l => l.trim()).filter(Boolean);
    let hasData = false;
    let lineType: string | undefined;
    let lineTitle: string | undefined;
    let hasCoords = false;

    for (const l of lines) {
      const tMatch = /^type\s*:\s*([a-z0-9_-]+)/i.exec(l);
      if (tMatch) {
        lineType = tMatch[1].toLowerCase();
        continue;
      }
      const titMatch = /^title\s*:\s*(.+)$/i.exec(l);
      if (titMatch) {
        lineTitle = titMatch[1].trim().replace(/^["']|["']$/g, '');
        continue;
      }
      if (/^(?:x-axis|y-axis|labels)\b/i.test(l)) continue;
      if (/^\(?\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)?$/.test(l)) {
        hasData = true;
        hasCoords = true;
      } else if (/^["']?[^"':()[\]]+["']?\s*:\s*[[(]\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*[\])]$/.test(l)) {
        hasData = true;
        hasCoords = true;
      } else if (/^["']?[^"':]+["']?\s*:\s*-?\d+(?:\.\d+)?$/.test(l)) {
        hasData = true;
      }
    }

    if (!hasData) return null;

    const effType = lineType || explicitType || (firstToken === 'graph' ? 'line' : firstToken === 'scatter' ? 'scatter' : undefined);
    let subType = 'Bar Chart';
    if (effType) {
      subType = normalizeChartSubtype(effType);
    } else if (hasCoords) {
      subType = 'Coordinate Graph';
    } else if (firstToken === 'graph') {
      subType = 'Line Graph';
    }

    const title = (titleCandidate || lineTitle || subType).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
    return { kind, subType, title: title || subType, rawSource };
  }

  if (kind === 'svg') {
    if (!/^\s*<svg\b/i.test(rawSource) || (!/<\/svg>\s*$/i.test(rawSource) && !/\/>\s*$/i.test(rawSource))) {
      return null;
    }
    const svgTitle =
      /<title[^>]*>([^<]+)<\/title>/i.exec(rawSource)?.[1]?.trim() ||
      /aria-label="([^"]+)"/i.exec(rawSource)?.[1]?.trim();
    const subType = 'SVG Visual';
    const title = (titleCandidate || svgTitle || subType).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
    return { kind, subType, title: title || subType, rawSource };
  }

  return null;
}

export class SpeechProse {
  private buffer = '';
  private total = 0;
  private emitted = false;
  private _visualSuffixStarted = false;
  private candidateCount = 0;

  constructor(
    private readonly maximum = 32000,
    private readonly onArtifact?: (artifact: CanvasArtifactSource) => void,
  ) {}

  get visualSuffixStarted(): boolean {
    return this._visualSuffixStarted;
  }

  push(text: string) {
    this.total += text.length;
    if (this.total > this.maximum) {
      throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The answer exceeded its speech limit.');
    }
    this.buffer += text;
    return this.drain(false);
  }

  finish() {
    return this.drain(true);
  }

  private acceptVisual(source: CanvasArtifactSource) {
    if (isCanvasArtifactSource(source)) {
      this.onArtifact?.(source);
    }
  }

  private plain(raw: string) {
    if (/[{}|<>]/u.test(raw)) return '';
    if ([...raw.matchAll(/`([^`\n]+)`/gu)].some(match => !/^[\p{L}\p{N}_./:@-]+$/u.test(match[1]))) return '';
    let text = raw.replace(/^\s{0,3}(?:#{1,6}\s+|>\s+|[-+*]\s+|\d+[.)]\s+)/u, '')
      .replace(/!?\[([^\]\n]+)\]\([^\)\n]+\)/gu, '$1')
      .replace(/`([^`\n]+)`/gu, '$1')
      .replace(/\*\*([^*\n]+)\*\*/gu, '$1').replace(/__([^_\n]+)__/gu, '$1')
      .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/gu, '$1')
      .replace(/(?<!\w)_([^_\n]+)_(?!\w)/gu, '$1')
      .replace(/&amp;/gu, '&').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'")
      .replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (/[`\[\]*]/u.test(text) || /&(?:\w+|#\d+);/u.test(text) || /^[-=]{3,}$/u.test(text)) return '';
    if (!text) return '';
    text = (this.emitted ? ' ' : '') + text;
    this.emitted = true;
    return text;
  }

  private findClosingFence(startIdx: number, fenceChar: string, fenceLen: number): { closeIndex: number; closeEnd: number } | null {
    const text = this.buffer.slice(startIdx);
    const regex = new RegExp(`(?:\\r?\\n)[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*(?:\\r?\\n|$)`, 'g');
    const match = regex.exec(text);
    if (!match) return null;
    return { closeIndex: startIdx + match.index, closeEnd: startIdx + match.index + match[0].length };
  }

  private drain(final: boolean) {
    let output = '';
    // ponytail: bounded 32k answer, conservative syntax recognition and visual suffix extraction; upgrade path to full streaming Markdown AST parser.

    while (this.buffer) {
      const leading = this.buffer.match(/^\s+/u)?.[0].length ?? 0;
      this.buffer = this.buffer.slice(leading);
      if (!this.buffer) break;

      // Check for hidden tags (e.g. <think>, <analysis>) first (precedence over candidates)
      const hidden = this.buffer.match(/^<([a-z][a-z0-9_-]*)(?:\s[^>]*)?>/iu);
      if (hidden && hidden[1].toLowerCase() !== 'aurvin-canvas') {
        const close = this.buffer.toLowerCase().indexOf(`</${hidden[1].toLowerCase()}>`, hidden[0].length);
        if (close < 0) {
          if (final) this.buffer = '';
          break;
        }
        this.buffer = this.buffer.slice(close + hidden[1].length + 3);
        continue;
      }

      // Check for <aurvin-canvas ...> wrapper
      const canvasWrapperMatch = this.buffer.match(/^<aurvin-canvas([^>]*)>/i);
      if (canvasWrapperMatch) {
        const header = canvasWrapperMatch[1];
        if (
          header.length > CANVAS_ARTIFACT_LIMITS.headerMaxChars ||
          new TextEncoder().encode(header).byteLength > CANVAS_ARTIFACT_LIMITS.headerMaxBytes
        ) {
          // Exceeds header cap - discard wrapper
          this.buffer = '';
          break;
        }

        const closeTag = '</aurvin-canvas>';
        const closeIdx = this.buffer.toLowerCase().indexOf(closeTag, canvasWrapperMatch[0].length);
        if (closeIdx < 0) {
          if (final) this.buffer = '';
          break;
        }

        const body = this.buffer.slice(canvasWrapperMatch[0].length, closeIdx);
        this.buffer = this.buffer.slice(closeIdx + closeTag.length);

        this._visualSuffixStarted = true;
        const ord = this.candidateCount++;
        if (ord < CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse) {
          if (!body.toLowerCase().includes('<aurvin-canvas')) {
            const classified = classifyVisual('canvas', header, body);
            if (classified) {
              this.acceptVisual({ ordinal: ord, ...classified });
            }
          }
        }
        continue;
      }

      // Check for code fence opener at start: ^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)(?:\r?\n|$)
      const fenceMatch = this.buffer.match(/^([ \t]{0,3})(`{3,}|~{3,})([^\n]*)(?:\r?\n|$)/);
      if (fenceMatch) {
        if (!final && !this.buffer.includes('\n')) {
          // Opener line incomplete, wait for newline
          break;
        }

        const fenceChar = fenceMatch[2][0];
        const fenceLen = fenceMatch[2].length;
        const info = fenceMatch[3].trim();
        const firstToken = (info.split(/\s+/)[0] ?? '').toLowerCase();
        const isSupportedAlias = SUPPORTED_VISUAL_TOKENS.has(firstToken);
        const openerLineEnd = fenceMatch[0].length;

        const closing = this.findClosingFence(openerLineEnd, fenceChar, fenceLen);
        if (!closing) {
          if (final) {
            this.buffer = '';
          }
          break;
        }

        const body = this.buffer.slice(openerLineEnd, closing.closeIndex);
        this.buffer = this.buffer.slice(closing.closeEnd);

        if (isSupportedAlias) {
          this._visualSuffixStarted = true;
          const ord = this.candidateCount++;
          if (ord < CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse) {
            const classified = classifyVisual(firstToken, info, body);
            if (classified) {
              this.acceptVisual({ ordinal: ord, ...classified });
            }
          }
        } else if (firstToken === 'json' || firstToken === '') {
          // Inspect body for chart or mermaid
          const classified = classifyVisual(firstToken, info, body);
          if (classified) {
            this._visualSuffixStarted = true;
            const ord = this.candidateCount++;
            if (ord < CANVAS_ARTIFACT_LIMITS.maxArtifactsPerResponse) {
              this.acceptVisual({ ordinal: ord, ...classified });
            }
          }
          // If not classified, it was an ordinary code fence, so continue without latching suffix
        }
        // Unsupported code fences simply skipped
        continue;
      }

      // Check for standalone JSON object { ... }
      if (this.buffer[0] === '{') {
        let depth = 0, quoted = false, escaped = false, end = -1;
        for (let i = 0; i < this.buffer.length; i++) {
          const c = this.buffer[i];
          if (quoted) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') quoted = false;
          } else if (c === '"') {
            quoted = true;
          } else if (c === '{' || c === '[') {
            depth++;
          } else if (c === '}' || c === ']') {
            if (--depth === 0) {
              end = i + 1;
              break;
            }
          }
        }
        if (end < 0) {
          if (final) this.buffer = '';
          break;
        }
        this.buffer = this.buffer.slice(end);
        continue;
      }

      // If visual suffix started, ALL subsequent prose is silent!
      if (this._visualSuffixStarted) {
        // Discard until next visual opener or end
        const nextOpener = this.buffer.search(/(?:^|\n)[ \t]{0,3}(?:`{3,}|~{3,}|<aurvin-canvas)/i);
        if (nextOpener < 0) {
          if (!final) {
            // Check if trailing part could be an incomplete opener prefix
            const partial = this.buffer.search(/\n[ \t]{0,3}(?:`{0,2}|~{0,2}|<[a-z0-9_-]*)$/i);
            if (partial >= 0) {
              this.buffer = this.buffer.slice(partial);
              break;
            }
          }
          this.buffer = '';
          break;
        }
        // Slice up to the next opener (advance past newline if nextOpener matched \n)
        const advance = this.buffer[nextOpener] === '\n' ? nextOpener + 1 : nextOpener;
        this.buffer = this.buffer.slice(advance);
        continue;
      }

      // Normal speech prose extraction
      let inline = false, brackets = 0, parens = 0, end = -1;
      for (let i = 0; i < this.buffer.length; i++) {
        const c = this.buffer[i];
        if (c === '`') inline = !inline;
        if (!inline) {
          // Lookahead for candidate opener, hidden tag, or JSON object
          if (i > 0) {
            if (c === '{') {
              end = i;
              break;
            }
            if (/^<([a-z][a-z0-9_-]*)(?:\s[^>]*)?>/iu.test(this.buffer.slice(i))) {
              end = i;
              break;
            }
            // Candidate fence opener at line boundary:
            if (c === '\n') {
              const rest = this.buffer.slice(i + 1);
              if (/^[ \t]{0,3}(?:`{3,}|~{3,}|<aurvin-canvas)/i.test(rest)) {
                end = i;
                break;
              }
              // Ambiguous partial opener at end of buffer
              if (!final && /^[ \t]{0,3}(?:`{1,2}|~{1,2}|<[a-z0-9_-]*)$/i.test(rest)) {
                end = i;
                break;
              }
            }
          }

          if (c === '[') brackets++;
          else if (c === ']') brackets--;
          if (c === '(') parens++;
          else if (c === ')') parens--;

          if (brackets === 0 && parens === 0 && (c === '\n' ||
            (/[.!?]/u.test(c) && i + 1 < this.buffer.length && /\s/u.test(this.buffer[i + 1])))) {
            end = i + 1;
            break;
          }
        }
      }

      // Fast plain clause release (exclude ~ as well as `)
      if (end < 0 && !final && this.buffer.length >= 24 &&
        !/[`\[\]{}|<>*&#~]/u.test(this.buffer) && !/(?:^|\s)_(?:_|\w)|__(?:\w|$)/u.test(this.buffer)) {
        const boundary = this.buffer.slice(0, 65).search(/\s+\S*$/u);
        if (boundary >= 24) end = boundary;
      }

      if (end < 0) {
        if (!final) break;
        end = this.buffer.length;
      }

      const unit = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      output += this.plain(unit);
    }

    return output;
  }
}
