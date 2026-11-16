/**
 * ============================================================================
 * FILE: speech-prose.spec.ts
 * LOCATION: backend/test/voice/agent/speech-prose.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for SpeechProse incremental safe prose normalization.
 *
 * ROLE IN PROJECT:
 *    Proves safe streaming token normalization: filters out reasoning tags, code
 *    blocks, inline code, JSON, tables, while preserving identifiers, numbers,
 *    Unicode, and factual negations across arbitrary chunk splits.
 *
 * KEY COMPONENTS:
 *    - SpeechProse: Incremental streaming prose normalizer.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { SpeechProse } from '../../../src/voice/agent/speech-prose.js';
import type { CanvasArtifactSource } from '../../../src/contracts/voice-wire.js';

const normalize = (chunks: string[]) => {
  const f = new SpeechProse();
  return chunks.map(c => f.push(c)).join('') + f.finish();
};

function splitVisual(chunks: string[]) {
  const artifacts: CanvasArtifactSource[] = [];
  const filter = new SpeechProse(32000, artifact => artifacts.push(artifact));
  const spoken = chunks.map(chunk => filter.push(chunk)).join('') + filter.finish();
  return { artifacts, spoken, suffix: filter.visualSuffixStarted };
}

function partition(str: string, pattern: number[]): string[] {
  const res: string[] = [];
  let idx = 0;
  let pIdx = 0;
  while (idx < str.length) {
    const len = pattern[pIdx % pattern.length];
    res.push(str.slice(idx, idx + len));
    idx += len;
    pIdx++;
  }
  return res;
}

it('streams completed prose units but never split reasoning, code, JSON or tables', () => {
  const raw = '<think>private thought. Still private.</think>\n**Do not** change ABC-42.\n' +
    '```json\n{"secret": true}\n```\n{"tool": "hidden"}\n| name | value |\n' +
    '### Price is 12.50 on 2026-10-08.\nSee [Aurvin](https://example.test).';
  const expected = 'Do not change ABC-42. Price is 12.50 on 2026-10-08. See Aurvin.';
  expect(normalize([raw])).toBe(expected);
  expect(normalize([...raw])).toBe(expected);
  for (let cut = 0; cut <= raw.length; cut++) expect(normalize([raw.slice(0, cut), raw.slice(cut)])).toBe(expected);
});

it('preserves factual identifiers, Unicode, repetitions, dates, amounts and negations', () => {
  expect(normalize(['Do not cancel demo_id. Repeat repeat ₹12.50 for Priya on 2026-10-08.']))
    .toBe('Do not cancel demo_id. Repeat repeat ₹12.50 for Priya on 2026-10-08.');
  expect(normalize(['Use `ABC-42`, not `ABC-43`.'])).toBe('Use ABC-42, not ABC-43.');
});

it('emits before provider completion without speaking an ambiguous incomplete syntax unit', () => {
  const f = new SpeechProse();
  expect(f.push('Hello. Next ')).toBe('Hello.');
  expect(f.push('sentence. ')).toBe(' Next sentence.');
  expect(f.finish()).toBe('');
  expect(normalize(['<analysis>never close'])).toBe('');
  expect(normalize(['```\nnever close'])).toBe('');
  expect(normalize(['[unclosed link'])).toBe('');
});

it('suppresses embedded hidden blocks and raw inline code across arbitrary token splits', () => {
  const raw = 'Safe prefix <think>private one. private two. private three.</think> Safe conclusion.';
  for (let cut = 0; cut <= raw.length; cut++) expect(normalize([raw.slice(0, cut), raw.slice(cut)]))
    .toBe('Safe prefix Safe conclusion.');
  expect(normalize(['Use `rm -rf private_path`.'])).toBe('');
  expect(normalize(['Before {"tool":"x","arguments":{"text":"private one. private two."}} After.']))
    .toBe('Before After.');
  expect(normalize(['[1, 2, 3]'])).toBe('');
});

it('bounds raw input and unfinished units instead of buffering forever', () => {
  const f = new SpeechProse(32);
  expect(() => f.push('<think>' + 'x'.repeat(33))).toThrow();
});

it('emits bounded safe plain clauses before an unpunctuated answer finishes without splitting words', () => {
  const raw = 'Do not change Aurvin or demo_id and keep ₹12.50 on 2026-10-08 unchanged while continuing this safe explanation without punctuation for a useful incremental answer';
  const f = new SpeechProse();
  const first = f.push(raw);
  expect(first.length).toBeGreaterThan(0);
  expect(first.length).toBeLessThan(raw.length);
  expect(first + f.finish()).toBe(raw);
  expect(normalize([...raw])).toBe(raw);
  for (const syntax of ['<think>hidden forever ', '```hidden code ', '{"hidden":"', '| hidden | table | ']) {
    const hidden = new SpeechProse();
    expect(hidden.push(syntax + 'private '.repeat(30))).toBe('');
    expect(hidden.finish()).toBe('');
  }
});

it('releases a completed 24-character plain clause before the next sentence', () => {
  const f = new SpeechProse();
  expect(f.push('Keep every word in orde')).toBe('');
  expect(f.push('r ')).toBe('Keep every word in order');
  expect(f.push('and preserve demo_id exactly ₹12.50')).toBe(' and preserve demo_id exactly');
  expect(f.finish()).toBe(' ₹12.50');
});

it('keeps guarded syntax private at every cut with the lower release threshold', () => {
  const secret = 'private reasoning and code must never become speech '.repeat(4);
  const cases: Array<[string, string]> = [
    [`<analysis>${secret}</analysis>Keep every word in order and do not cancel ABC-42.`,
      'Keep every word in order and do not cancel ABC-42.'],
    [`<think data-x="1">${secret}</think>Safe final answer.`, 'Safe final answer.'],
    ['```ts\n' + secret + '\n```\nSafe final answer.', 'Safe final answer.'],
    ['~~~ts\n' + secret + '\n~~~\nSafe final answer.', 'Safe final answer.'],
    [`{"tool":{"text":"${secret}"}}\nSafe final answer.`, 'Safe final answer.'],
    [`| ${secret} | value |\nSafe final answer.`, 'Safe final answer.'],
    ['[an incomplete link with many words and private syntax', ''],
    ['Use `rm -rf private_path`.', ''],
    ['**Do not cancel ABC-42** on 2026-10-08. See [Aurvin](https://example.test).',
      'Do not cancel ABC-42 on 2026-10-08. See Aurvin.'],
  ];
  for (const [raw, expected] of cases) {
    expect(normalize([raw])).toBe(expected);
    expect(normalize([...raw])).toBe(expected);
    for (let cut = 0; cut <= raw.length; cut++)
      expect(normalize([raw.slice(0, cut), raw.slice(cut)])).toBe(expected);
  }
});

it('keeps complete long identifiers and whitespace-delimited facts in exact order', () => {
  const raw = 'Do not cancel ' + 'A'.repeat(90) + ' or demo_id on 2026-10-08 for ₹12.50';
  expect(normalize([raw])).toBe(raw);
  expect(normalize([...raw])).toBe(raw);
  const f = new SpeechProse();
  expect(f.push('Keep every word in order\t')).toBe('Keep every word in order');
  expect(f.finish()).toBe('');
});

it('captures closed visual suffixes and never speaks syntax or trailing commentary at any cut', () => {
  const source = 'flowchart TD\nA --> B';
  const raw = 'Explain the concept. Follow A to B.\n```mermaid title="Approval path"\n' +
    source + '\n```\nThis trailing commentary must be silent.';
  const expected = { spoken: 'Explain the concept. Follow A to B.', suffix: true,
    artifacts: [{ ordinal: 0, kind: 'mermaid', subType: 'Flowchart', title: 'Approval path', rawSource: source }] };
  expect(splitVisual([raw])).toEqual(expected);
  expect(splitVisual([...raw])).toEqual(expected);
  for (let cut = 0; cut <= raw.length; cut++)
    expect(splitVisual([raw.slice(0, cut), raw.slice(cut)])).toEqual(expected);
});

it('emits a complete artifact before finish but never an unterminated one', () => {
  const artifacts: CanvasArtifactSource[] = [];
  const filter = new SpeechProse(32000, artifact => artifacts.push(artifact));
  expect(filter.push('Safe intro.\n~~~mermaid\nflowchart TD\nA --> B\n~~')).toBe('Safe intro.');
  expect(artifacts).toEqual([]);
  expect(filter.push('~\n')).toBe('');
  expect(artifacts).toHaveLength(1);
  expect(filter.push('~~~chart\n{"type":"bar","data":[')).toBe('');
  expect(filter.finish()).toBe('');
  expect(artifacts).toHaveLength(1);
});

it('captures diverse supported visual types with correct classification and cuts', () => {
  const fixtures: Array<{
    name: string;
    raw: string;
    spoken: string;
    artifact: CanvasArtifactSource;
  }> = [
    {
      name: 'mermaid sequence',
      raw: 'Here is the sequence.\n```mermaid\nsequenceDiagram\nAlice->>Bob: Hello\n```\nAfter commentary.',
      spoken: 'Here is the sequence.',
      artifact: { ordinal: 0, kind: 'mermaid', subType: 'Sequence Diagram', title: 'Sequence Diagram', rawSource: 'sequenceDiagram\nAlice->>Bob: Hello' },
    },
    {
      name: 'json bar chart',
      raw: 'Here is data.\n```json\n{"type": "bar", "title": "Revenue", "data": [10, 20]}\n```',
      spoken: 'Here is data.',
      artifact: { ordinal: 0, kind: 'chart', subType: 'Bar Chart', title: 'Revenue', rawSource: '{"type": "bar", "title": "Revenue", "data": [10, 20]}' },
    },
    {
      name: 'json line chart',
      raw: 'Trend explanation.\n```json\n{"type": "line", "title": "Trend", "data": [1, 2, 3]}\n```',
      spoken: 'Trend explanation.',
      artifact: { ordinal: 0, kind: 'chart', subType: 'Line Graph', title: 'Trend', rawSource: '{"type": "line", "title": "Trend", "data": [1, 2, 3]}' },
    },
    {
      name: 'json pie chart',
      raw: 'Share explanation.\n```json\n{"type": "pie", "title": "Share", "data": [50, 50]}\n```',
      spoken: 'Share explanation.',
      artifact: { ordinal: 0, kind: 'chart', subType: 'Pie Chart', title: 'Share', rawSource: '{"type": "pie", "title": "Share", "data": [50, 50]}' },
    },
    {
      name: 'json scatter plot',
      raw: 'Point explanation.\n```json\n{"type": "scatter", "title": "Cluster", "points": [{"x": 1, "y": 2}]}\n```',
      spoken: 'Point explanation.',
      artifact: { ordinal: 0, kind: 'chart', subType: 'X-Y Point Plot', title: 'Cluster', rawSource: '{"type": "scatter", "title": "Cluster", "points": [{"x": 1, "y": 2}]}' },
    },
    {
      name: 'untyped graph defaults to line graph',
      raw: 'Graph explanation.\n```graph\nx-axis 1, 2\n(1, 2)\n(2, 4)\n```',
      spoken: 'Graph explanation.',
      artifact: { ordinal: 0, kind: 'chart', subType: 'Line Graph', title: 'Line Graph', rawSource: 'x-axis 1, 2\n(1, 2)\n(2, 4)' },
    },
    {
      name: 'graph with scatter type',
      raw: 'Scatter explanation.\n```graph type=scatter\n(1, 2)\n(2, 4)\n```',
      spoken: 'Scatter explanation.',
      artifact: { ordinal: 0, kind: 'chart', subType: 'X-Y Point Plot', title: 'X-Y Point Plot', rawSource: '(1, 2)\n(2, 4)' },
    },
    {
      name: 'labeled coordinates in fenced chart',
      raw: 'Labeled plot explanation.\n```scatter title="Embedding Map"\nDog: (8, 9.5)\nToaster: (-4, -3)\n```',
      spoken: 'Labeled plot explanation.',
      artifact: { ordinal: 0, kind: 'chart', subType: 'X-Y Point Plot', title: 'Embedding Map', rawSource: 'Dog: (8, 9.5)\nToaster: (-4, -3)' },
    },
    {
      name: 'line-oriented chart with title',
      raw: 'Line chart.\n```chart\ntitle: Growth\n2020: 10\n2021: 20\n```',
      spoken: 'Line chart.',
      artifact: { ordinal: 0, kind: 'chart', subType: 'Bar Chart', title: 'Growth', rawSource: 'title: Growth\n2020: 10\n2021: 20' },
    },
    {
      name: 'svg visual',
      raw: 'SVG visual.\n```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/><title>Circle</title></svg>\n```',
      spoken: 'SVG visual.',
      artifact: { ordinal: 0, kind: 'svg', subType: 'SVG Visual', title: 'Circle', rawSource: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/><title>Circle</title></svg>' },
    },
    {
      name: 'aurvin-canvas wrapper with attributes',
      raw: 'Canvas wrapper.\n<aurvin-canvas type="flowchart" title="Workflow">\nflowchart TD\nStart --> Stop\n</aurvin-canvas>',
      spoken: 'Canvas wrapper.',
      artifact: { ordinal: 0, kind: 'mermaid', subType: 'Flowchart', title: 'Workflow', rawSource: 'flowchart TD\nStart --> Stop' },
    },
    {
      name: 'mmd alias and CRLF',
      raw: 'MMD alias.\r\n```mmd\r\nflowchart LR\r\nA --> B\r\n```',
      spoken: 'MMD alias.',
      artifact: { ordinal: 0, kind: 'mermaid', subType: 'Flowchart', title: 'Flowchart', rawSource: 'flowchart LR\nA --> B' },
    },
  ];

  for (const f of fixtures) {
    const expected = { spoken: f.spoken, suffix: true, artifacts: [f.artifact] };
    expect(splitVisual([f.raw]), f.name).toEqual(expected);
    expect(splitVisual([...f.raw]), f.name).toEqual(expected);
    expect(splitVisual(partition(f.raw, [1, 2, 5, 13])), f.name).toEqual(expected);
    for (let cut = 0; cut <= f.raw.length; cut++) {
      expect(splitVisual([f.raw.slice(0, cut), f.raw.slice(cut)]), `${f.name} cut ${cut}`).toEqual(expected);
    }
  }
});

it('rejects invalid or oversized candidate blocks and enforces ordinal stability', () => {
  // Empty block is rejected
  expect(splitVisual(['Intro.\n```mermaid\n```']).artifacts).toHaveLength(0);

  // Hidden reasoning containing visual must NOT produce visual artifacts
  const hiddenVisual = 'Intro.\n<think>\n```mermaid\nflowchart TD\nA --> B\n```\n</think>\nReal speech.';
  expect(splitVisual([hiddenVisual])).toEqual({ spoken: 'Intro. Real speech.', suffix: false, artifacts: [] });

  // Four candidate blocks: at most 3 captured
  const four = 'Intro.\n' +
    '```mermaid\nflowchart TD\nA --> B\n```\n' +
    '```mermaid\nflowchart TD\nB --> C\n```\n' +
    '```mermaid\nflowchart TD\nC --> D\n```\n' +
    '```mermaid\nflowchart TD\nD --> E\n```';
  const fourRes = splitVisual([four]);
  expect(fourRes.artifacts).toHaveLength(3);
  expect(fourRes.artifacts.map(a => a.ordinal)).toEqual([0, 1, 2]);

  // Oversized ordinal 0 followed by valid ordinal 1: ordinal 0 is discarded, ordinal 1 retains ordinal: 1
  const oversizedFirst = 'Intro.\n' +
    '```mermaid\nflowchart TD\n' + 'A --> B\n'.repeat(2000) + '```\n' +
    '```mermaid\nflowchart TD\nC --> D\n```';
  const overRes = splitVisual([oversizedFirst]);
  expect(overRes.artifacts).toHaveLength(1);
  expect(overRes.artifacts[0].ordinal).toBe(1);

  // Safe unpunctuated prefix before a visual drains before visual
  const unpunct = 'This is an unpunctuated intro\n```mermaid\nflowchart TD\nA --> B\n```';
  expect(splitVisual([unpunct]).spoken).toBe('This is an unpunctuated intro');

  // Unsupported code fence does not consume candidate ordinal or latch suffix
  const codeBefore = 'Intro.\n```typescript\nconst x = 1;\n```\nMiddle speech.\n```mermaid\nflowchart TD\nA --> B\n```';
  const codeRes = splitVisual([codeBefore]);
  expect(codeRes.spoken).toBe('Intro. Middle speech.');
  expect(codeRes.artifacts).toHaveLength(1);
  expect(codeRes.artifacts[0].ordinal).toBe(0);
});

it('recognizes labeled coordinates in a fenced chart including positive, negative, and decimal values', () => {
  const input =
    'Here are the coordinates.\n' +
    '```chart\n' +
    'type: scatter\n' +
    'title: Spatial Distribution\n' +
    'Alpha: (10, 20.5)\n' +
    'Beta: (-5.5, -12)\n' +
    'Gamma: [-3, 8.25]\n' +
    '```\n' +
    'Post visual silence.';

  const result = splitVisual([input]);
  expect(result.spoken).toBe('Here are the coordinates.');
  expect(result.artifacts).toEqual([
    {
      ordinal: 0,
      kind: 'chart',
      subType: 'X-Y Point Plot',
      title: 'Spatial Distribution',
      rawSource:
        'type: scatter\n' +
        'title: Spatial Distribution\n' +
        'Alpha: (10, 20.5)\n' +
        'Beta: (-5.5, -12)\n' +
        'Gamma: [-3, 8.25]',
    },
  ]);
  expect(result.suffix).toBe(true);
});
