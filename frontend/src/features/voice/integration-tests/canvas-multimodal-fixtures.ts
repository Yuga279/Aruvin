/**
 * ============================================================================
 * FILE: canvas-multimodal-fixtures.ts
 * LOCATION: frontend/src/features/voice/integration-tests/canvas-multimodal-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Shared synthetic visual corpus and chunk partition helpers for integrated voice Canvas verification
 *
 * ROLE IN PROJECT:
 *    Provides deterministic visual artifacts across Mermaid, Chart, and SVG formats, along with
 *    framing helpers (ticks, tildes, aurvin-canvas tags) and chunk partition generators for boundary testing.
 *
 * KEY COMPONENTS:
 *    - SPEECH / TRAILING: Constant test speech strings
 *    - VISUALS: Complete test corpus of visual artifacts (Mermaid, chart types, SVG)
 *    - sourceOf: Normalizes visual corpus items to CanvasArtifactSource
 *    - block: Formats visual items with code fences or canvas tags
 *    - partitions: Generates chunk split variations for boundary stream testing
 * ============================================================================
 */

import type { CanvasArtifactSource } from '../../../api/voice-protocol.ts';

export const SPEECH = 'Explain the concept. Follow A to B.';
export const TRAILING = 'POST_VISUAL_MUST_NOT_BE_SPOKEN';
export const VISUALS: Array<CanvasArtifactSource & { language: string }> = [
  { ordinal: 0, language: 'mermaid', kind: 'mermaid', subType: 'Flowchart',
    title: 'Flowchart', rawSource: 'flowchart TD\nA[Start] --> B[Finish]' },
  { ordinal: 0, language: 'mmd', kind: 'mermaid', subType: 'Sequence Diagram',
    title: 'Sequence Diagram', rawSource: 'sequenceDiagram\nA->>B: Hello\nB-->>A: Ready' },
  { ordinal: 0, language: 'chart', kind: 'chart', subType: 'Bar Chart',
    title: 'Bar Chart', rawSource: '{"type":"bar","labels":["A","B"],"datasets":[{"label":"Count","data":[2,3]}]}' },
  { ordinal: 0, language: 'graph', kind: 'chart', subType: 'Line Graph',
    title: 'Line Graph', rawSource: 'Mon: 42\nTue: 38\nWed: 31' },
  { ordinal: 0, language: 'chart', kind: 'chart', subType: 'Pie Chart',
    title: 'Pie Chart', rawSource: '{"type":"pie","labels":["A","B"],"datasets":[{"label":"Share","data":[60,40]}]}' },
  { ordinal: 0, language: 'scatter', kind: 'chart', subType: 'X-Y Point Plot',
    title: 'X-Y Point Plot', rawSource: 'Dog: (8, 9)\nToaster: (-4, -3)' },
  { ordinal: 0, language: 'svg', kind: 'svg', subType: 'SVG Visual',
    title: 'SVG Visual', rawSource: '<svg viewBox="0 0 80 40"><rect x="2" y="2" width="40" height="20" /></svg>' },
];

export function sourceOf(item: typeof VISUALS[number]): CanvasArtifactSource {
  return { ordinal: item.ordinal, kind: item.kind, subType: item.subType,
    title: item.title, rawSource: item.rawSource };
}
export function block(item: typeof VISUALS[number], frame: 'ticks' | 'tildes' | 'tag') {
  if (frame === 'tag') {
    const type = item.language === 'graph' || item.language === 'scatter' ? item.language : item.kind;
    return `<aurvin-canvas type="${type}" title="${item.title}">\n${item.rawSource}\n</aurvin-canvas>\n`;
  }
  const fence = frame === 'ticks' ? '```' : '~~~';
  return `${fence}${item.language} title="${item.title}"\n${item.rawSource}\n${fence}\n`;
}
export function partitions(text: string): string[][] {
  const chunks: string[] = []; let at = 0, step = 0;
  const sizes = [1, 2, 5, 13];
  while (at < text.length) { const size = sizes[step++ % sizes.length]!;
    chunks.push(text.slice(at, at + size)); at += size; }
  return [[text], text.split(''), chunks,
    ...Array.from({ length: text.length + 1 }, (_, cut) => [text.slice(0, cut), text.slice(cut)])];
}
