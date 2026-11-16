/**
 * ============================================================================
 * FILE: canvas.test.ts
 * LOCATION: frontend/src/features/canvas/canvas.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Aurvin's Canvas extraction, inline card replacement, SVG renderers,
 *    tabbed side panel, and chat reducer transitions.
 *
 * ROLE IN PROJECT:
 *    Node-environment test suite proving Mermaid diagrams, charts, and SVGs
 *    are stripped from inline chat text into interactive Canvas cards and
 *    rendered safely inside CanvasPanel without dangerouslySetInnerHTML.
 *
 * KEY COMPONENTS:
 *    - Artifact extraction and SafeMarkdown inline card tests.
 *    - MermaidRenderer, ChartRenderer, and SvgRenderer SVG output checks.
 *    - CanvasPanel and chatReducer multi-tab lifecycle tests.
 * ============================================================================
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from '../chat/markdown/safe-markdown.tsx';
import { chatReducer, initialChatState } from '../chat/state/chat-reducer.ts';
import type { VisibleMessage } from '../../api/protocol.ts';
import {
  CanvasPanel,
  CANVAS_TRANSITION_MS,
  ChartRenderer,
  claimNewAutoOpenArtifactId,
  collectSessionCanvasArtifacts,
  computeWheelZoomView,
  extractMessageCanvasArtifacts,
  extractVoiceMessageCanvasArtifacts,
  forcedChartKindFromSubType,
  MermaidRenderer,
  mergeSessionCanvasArtifacts,
  parseMermaidSource,
  prefersReducedCanvasMotion,
  projectionToCanvasArtifact,
  resolveCanvasCloseFocusTarget,
  restoreCanvasCloseFocus,
  SvgRenderer,
} from './index.ts';

describe("Aurvin's Canvas extraction and inline chat replacement", () => {
  it('replaces Mermaid diagram fences in SafeMarkdown with a "View diagram" Canvas card while keeping normal code inline', () => {
    const markdown = [
      'Here is the architecture overview:',
      '```mermaid title="Auth Service Flow"',
      'flowchart TD',
      '  Client[Browser Client] -->|POST /login| Gateway{API Gateway}',
      '  Gateway -->|Valid| Auth[(User DB)]',
      '```',
      'And a quick TypeScript helper:',
      '```typescript',
      'export const verify = (token: string) => Boolean(token);',
      '```',
    ].join('\n');

    const html = renderToStaticMarkup(
      createElement(SafeMarkdown, { content: markdown, messageId: 'msg_1' }),
    );

    // Raw mermaid syntax is removed from the inline response and replaced by the Canvas button card
    expect(html).toContain('class="aurvin-canvas-card"');
    expect(html).toContain('Auth Service Flow');
    expect(html).toContain('View diagram');
    expect(html).not.toContain('POST /login');
    expect(html).toContain('data-canvas-artifact-id="msg_1::canvas::0"');

    // Standard code block remains inline
    expect(html).toContain('class="aurvin-code-block"');
    expect(html).toContain('export const verify');
  });

  it('replaces chart and graph blocks with "View chart" and "View graph" buttons', () => {
    const markdown = [
      'Quarterly revenue breakdown:',
      '```chart title="Q1-Q4 Revenue"',
      '{"type":"bar","labels":["Q1","Q2","Q3","Q4"],"datasets":[{"label":"Revenue","data":[120,180,240,310]}]}',
      '```',
      'Latency trend over time:',
      '```graph title="P95 Latency"',
      '{"type":"line","labels":["Mon","Tue","Wed"],"datasets":[{"label":"ms","data":[42,38,31]}]}',
      '```',
    ].join('\n');

    const html = renderToStaticMarkup(
      createElement(SafeMarkdown, { content: markdown, messageId: 'msg_2' }),
    );

    expect(html).toContain('Q1-Q4 Revenue');
    expect(html).toContain('View chart');
    expect(html).toContain('P95 Latency');
    expect(html).toContain('View graph');
    expect(html).not.toContain('"datasets"');
  });

  it('normalizes <aurvin-canvas> tags into Canvas artifacts', () => {
    const content = [
      'Visualizing the workflow:',
      '<aurvin-canvas type="mermaid" title="Release Pipeline">',
      'flowchart LR',
      '  Build --> Test --> Deploy',
      '</aurvin-canvas>',
    ].join('\n');

    const artifacts = extractMessageCanvasArtifacts(content, 'msg_xml');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.title).toBe('Release Pipeline');
    expect(artifacts[0]?.kind).toBe('mermaid');
    expect(artifacts[0]?.buttonLabel).toBe('View diagram');
  });
});

describe("Aurvin's Canvas visual SVG renderers", () => {
  it('renders Mermaid flowcharts with subgraphs, shapes, and labeled edges into SVG', () => {
    const source = [
      'flowchart TD',
      '  subgraph Backend["Core Backend"]',
      '    A([Request]) --> B{Authorized?}',
      '    B -->|Yes| C[(MongoDB)]',
      '    B -.->|No| D((Reject))',
      '  end',
    ].join('\n');

    const html = renderToStaticMarkup(
      createElement(MermaidRenderer, { source, title: 'Request Flow' }),
    );

    expect(html).toContain('<svg');
    expect(html).toContain('Request Flow');
    expect(html).toContain('Core Backend');
    expect(html).toContain('Authorized?');
    expect(html).toContain('MongoDB');
    expect(html).toContain('Yes');
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('renders Mermaid sequence diagrams with participants, lifelines, and notes', () => {
    const source = [
      'sequenceDiagram',
      '  participant U as User',
      '  participant A as Aurvin',
      '  U->>A: Ask for a diagram',
      '  Note over U,A: Rendered in Canvas',
      '  A-->>U: Returns interactive card',
    ].join('\n');

    const html = renderToStaticMarkup(
      createElement(MermaidRenderer, { source, title: 'Interaction Sequence' }),
    );

    expect(html).toContain('<svg');
    expect(html).toContain('Interaction Sequence');
    expect(html).toContain('User');
    expect(html).toContain('Aurvin');
    expect(html).toContain('Ask for a diagram');
    expect(html).toContain('Rendered in Canvas');
  });

  it('renders bar, line, and pie charts via ChartRenderer', () => {
    const barJson = JSON.stringify({
      type: 'bar',
      title: 'Monthly Active Users',
      labels: ['Jan', 'Feb', 'Mar'],
      datasets: [{ label: 'Users', data: [1200, 1900, 2600] }],
    });
    const barHtml = renderToStaticMarkup(createElement(ChartRenderer, { source: barJson }));
    expect(barHtml).toContain('<svg');
    expect(barHtml).toContain('Monthly Active Users');
    expect(barHtml).toContain('Jan');
    expect(barHtml).toContain('2600');

    const pieSource = [
      'pie title Browser Share',
      '  "Chrome" : 65',
      '  "Firefox" : 20',
      '  "Safari" : 15',
    ].join('\n');
    const pieHtml = renderToStaticMarkup(createElement(MermaidRenderer, { source: pieSource }));
    expect(pieHtml).toContain('<svg');
    expect(pieHtml).toContain('Browser Share');
    expect(pieHtml).toContain('Chrome');
    expect(pieHtml).toContain('65%');
  });

  it('sanitizes raw SVG blocks and strips scripts or event handlers', () => {
    const rawSvg = [
      '<svg viewBox="0 0 200 100">',
      '  <script>alert("xss")</script>',
      '  <rect x="10" y="10" width="80" height="40" fill="#38bdf8" onload="alert(1)" />',
      '  <text x="50" y="35">Safe Vector</text>',
      '</svg>',
    ].join('\n');

    const html = renderToStaticMarkup(createElement(SvgRenderer, { source: rawSvg }));
    expect(html).toContain('<svg');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('Safe Vector');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onload');
    expect(html).not.toContain('alert');
  });

  it('strips external SVG paint server URLs from fill and stroke while preserving safe local gradient references and normal colors', () => {
    const rawSvg = [
      '<svg viewBox="0 0 200 100">',
      '  <defs>',
      '    <linearGradient id="localGradient">',
      '      <stop offset="0%" stop-color="#38bdf8" />',
      '      <stop offset="100%" stop-color="#1e293b" />',
      '    </linearGradient>',
      '  </defs>',
      '  <rect x="10" y="10" width="80" height="40" fill="url(#localGradient)" stroke="#0284c7" />',
      '  <circle cx="50" cy="50" r="20" fill="url(https://invalid.example/tracker)" stroke="url(//evil.example/x)" />',
      '  <path d="M 0 0 L 10 10" fill="url(http://invalid.example/tracker)" stroke="url(data:image/svg+xml;base64,PHN2Zz4=)" />',
      '  <text x="20" y="20" fill="currentColor"><script>LABEL</script>Safe Text</text>',
      '</svg>',
    ].join('\n');

    const html = renderToStaticMarkup(createElement(SvgRenderer, { source: rawSvg }));

    // Safe local fragment reference and solid colors render
    expect(html).toContain('fill="url(#localGradient)"');
    expect(html).toContain('stroke="#0284c7"');
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('Safe Text');

    // External and dangerous paint server URLs are stripped / not emitted
    expect(html).not.toContain('invalid.example');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('url(https:');
    expect(html).not.toContain('url(http:');
    expect(html).not.toContain('url(//');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('<script');

    // Elements themselves still render without unsafe paint attributes
    expect(html).toContain('<circle');
    expect(html).toContain('<path');
  });

  it('lays out parallel subgraphs in separate non-overlapping clusters with full node text and no purple gradient', () => {
    const ragFlow = [
      'flowchart TD',
      '  subgraph Prep["1. Document preparation (Happens once)"]',
      '    A[Company PDFs &amp; Docs] --> B[Break into small chunks]',
      '    B --> C[Convert text into number lists / vectors]',
      '    C --> D[(Vector database)]',
      '  end',
      '  subgraph Answer["2. Answering a question (Happens every time)"]',
      '    E[User asks a question] --> F[Convert question into numbers]',
      '    F --> G[Search database for matching chunks]',
      '    D -.->|Provides stored chunks| G',
      '    G --> H[Combine question + matching chunks]',
      '    H --> I[AI Model reads both &amp; writes answer]',
      '  end',
    ].join('\n');

    const parsed = parseMermaidSource(ragFlow, 'RAG Architecture');
    expect(parsed.kind).toBe('flowchart');
    if (parsed.kind === 'flowchart') {
      // Node D belongs only to Prep subgraph, not duplicated into Answer subgraph by cross-edge D -.-> G
      const prepSg = parsed.subgraphs.find((s) => s.id === 'Prep');
      const answerSg = parsed.subgraphs.find((s) => s.id === 'Answer');
      expect(prepSg?.nodeIds).toContain('D');
      expect(answerSg?.nodeIds).not.toContain('D');
    }

    const html = renderToStaticMarkup(
      createElement(MermaidRenderer, { source: ragFlow, title: 'RAG Architecture' }),
    );

    // No purple gradient or truncated labels
    expect(html).not.toContain('aurvin-mermaid-node-grad');
    expect(html).not.toContain('#6366f1');
    expect(html).not.toContain('#8b5cf6');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('1. Document preparation (Happens once)');
    expect(html).toContain('2. Answering a question (Happens every time)');
    expect(html).toContain('Vector database');
    expect(html).not.toContain('Vector databa…');
  });

  it('plots 2D coordinate points on X and Y axes and draws connected graphs', () => {
    const xyGraphJson = JSON.stringify({
      type: 'scatter',
      title: '2D Vector Embedding Space',
      xAxisLabel: 'Dimension X (Pet / Domestic)',
      yAxisLabel: 'Dimension Y (Feline / Canine)',
      xMin: -5,
      xMax: 10,
      yMin: -5,
      yMax: 10,
      datasets: [
        {
          label: 'Animals',
          showLine: true,
          smooth: true,
          points: [
            { x: 7.2, y: 8.1, label: 'Dog' },
            { x: 6.8, y: 7.7, label: 'Puppy' },
            { x: 6.1, y: -3.2, label: 'Cat' },
          ],
        },
        {
          label: 'Appliances',
          points: [{ x: -3.8, y: -4.1, label: 'Toaster' }],
        },
      ],
    });

    const html = renderToStaticMarkup(createElement(ChartRenderer, { source: xyGraphJson }));
    expect(html).toContain('aurvin-canvas-xy-svg');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('2D Vector Embedding Space');
    expect(html).toContain('Dimension X (Pet / Domestic)');
    expect(html).toContain('Dimension Y (Feline / Canine)');
    expect(html).toContain('data-point-x="7.2"');
    expect(html).toContain('data-point-y="8.1"');
    expect(html).toContain('Dog (7.2, 8.1)');
    expect(html).toContain('Toaster (-3.8, -4.1)');
    expect(html).not.toContain('#6366f1');
    expect(html).not.toContain('#8b5cf6');
  });

  it('parses plain-text (x, y) coordinates and Mermaid quadrantChart into 2D X-Y plots', () => {
    const plainCoords = [
      'Dog: (8, 9)',
      'Puppy: (7.5, 8.4)',
      'Toaster: (-4, -3)',
    ].join('\n');

    const plainHtml = renderToStaticMarkup(
      createElement(ChartRenderer, { source: plainCoords, title: 'Word Coordinates' }),
    );
    expect(plainHtml).toContain('aurvin-canvas-xy-svg');
    expect(plainHtml).toContain('data-point-x="8"');
    expect(plainHtml).toContain('data-point-y="9"');
    expect(plainHtml).toContain('Dog (8, 9)');

    const quadrantSource = [
      'quadrantChart',
      '  title Semantic Clustering',
      '  x-axis Low Pet --> High Pet',
      '  y-axis Low Size --> High Size',
      '  quadrant-1 Companions',
      '  quadrant-2 Wild Giants',
      '  quadrant-3 Objects',
      '  quadrant-4 Small Pets',
      '  Dog: [0.85, 0.78]',
      '  Toaster: [0.12, 0.15]',
    ].join('\n');

    const quadHtml = renderToStaticMarkup(
      createElement(MermaidRenderer, { source: quadrantSource }),
    );
    expect(quadHtml).toContain('aurvin-canvas-xy-svg');
    expect(quadHtml).toContain('Semantic Clustering');
    expect(quadHtml).toContain('Companions');
    expect(quadHtml).toContain('data-point-x="0.85"');
    expect(quadHtml).toContain('data-point-y="0.78"');
  });
});

describe("Aurvin's Canvas side panel and reducer state transitions", () => {
  it('reuses immutable archive artifacts while independently extracting stream drafts and changed content', () => {
    const message = { messageId: 'm1', turnId: 't1', eventId: 'e1', sequence: 1, role: 'assistant' as const,
      content: '```mermaid title="Archive"\ngraph LR\n A --> B\n```', createdAt: '',
      completionStatus: 'completed' as const, truncated: false };
    const first = collectSessionCanvasArtifacts([message], '', false);
    expect(first).toHaveLength(1);
    const second = collectSessionCanvasArtifacts([message], '```chart\nQ1: 40\n```', true);
    expect(second).toHaveLength(2);
    expect(second[0]).toBe(first[0]);
    expect(collectSessionCanvasArtifacts([message], '', false)).toEqual(first);
    message.content = 'plain text after redaction';
    expect(collectSessionCanvasArtifacts([message], '', false)).toEqual([]);
  });
  it('renders tabbed split panel with 3+ tabs, accessible close buttons on every tab, and active diagram', () => {
    const artifacts = collectSessionCanvasArtifacts(
      [
        {
          messageId: 'm1',
          turnId: 't1',
          eventId: 'e1',
          sequence: 1,
          role: 'assistant',
          content: '```mermaid title="System Graph"\ngraph LR\n  A --> B\n```',
          createdAt: '2026-10-16T00:00:00Z',
          completionStatus: 'completed',
          truncated: false,
        },
        {
          messageId: 'm2',
          turnId: 't2',
          eventId: 'e2',
          sequence: 2,
          role: 'assistant',
          content: '```chart title="Sales Chart"\nQ1: 40\nQ2: 75\n```',
          createdAt: '2026-10-16T00:01:00Z',
          completionStatus: 'completed',
          truncated: false,
        },
        {
          messageId: 'm3',
          turnId: 't3',
          eventId: 'e3',
          sequence: 3,
          role: 'assistant',
          content: '```graph title="Embedding Plot"\nDog: (8, 9)\nCat: (7, 6)\n```',
          createdAt: '2026-10-16T00:02:00Z',
          completionStatus: 'completed',
          truncated: false,
        },
      ],
      '',
      false,
    );

    expect(artifacts).toHaveLength(3);

    const html = renderToStaticMarkup(
      createElement(CanvasPanel, {
        artifacts,
        activeArtifactId: artifacts[2]!.artifactId,
        onSelectArtifact: () => {},
        onCloseTab: () => {},
        onClosePanel: () => {},
      }),
    );

    expect(html).toContain('aria-label="Aurvin Canvas"');
    expect(html).toContain('System Graph');
    expect(html).toContain('Sales Chart');
    expect(html).toContain('Embedding Plot');
    expect(html).toContain('aria-label="Close System Graph tab"');
    expect(html).toContain('aria-label="Close Sales Chart tab"');
    expect(html).toContain('aria-label="Close Embedding Plot tab"');
    expect(html).toContain('100%');
    expect(html).toContain('Preview');
    expect(html).toContain('Code');
  });

  it('tracks open/close tab actions and preserves streaming artifact selection on STREAM_COMPLETED', () => {
    let state = chatReducer(initialChatState, {
      type: 'OPEN_CANVAS_ARTIFACT',
      payload: { artifactId: 'streaming_in_flight::canvas::0' },
    });
    expect(state.canvasOpen).toBe(true);
    expect(state.activeCanvasArtifactId).toBe('streaming_in_flight::canvas::0');

    state = chatReducer(
      { ...state, isStreaming: true, streamText: '```mermaid\ngraph TD\nA-->B\n```' },
      {
        type: 'STREAM_COMPLETED',
        payload: { assistantMessageId: 'msg_final_99', outcome: 'completed' },
      },
    );
    expect(state.activeCanvasArtifactId).toBe('msg_final_99::canvas::0');

    state = chatReducer(state, {
      type: 'CLOSE_CANVAS_TAB',
      payload: { artifactId: 'msg_final_99::canvas::0', fallbackArtifactId: null },
    });
    expect(state.canvasOpen).toBe(false);
    expect(state.closedCanvasArtifactIds).toContain('msg_final_99::canvas::0');
  });

  it('zooms in and out on mouse wheel scroll while anchoring pan around the cursor offset', () => {
    const initial = { zoom: 100, panX: 0, panY: 0 };

    // Scroll up (negative deltaY) zooms in and adjusts pan toward cursor offset (100, -50)
    const zoomedIn = computeWheelZoomView(initial, -100, 100, -50);
    expect(zoomedIn.zoom).toBe(115);
    expect(zoomedIn.panX).toBe(-15);
    expect(zoomedIn.panY).toBe(8);

    // Scroll down (positive deltaY) zooms out
    const zoomedOut = computeWheelZoomView(zoomedIn, 100, 100, -50);
    expect(zoomedOut.zoom).toBe(100);
    expect(zoomedOut.panX).toBe(0);
    expect(zoomedOut.panY).toBe(0);

    // Clamps at minZoom (25%) and maxZoom (300%)
    expect(computeWheelZoomView({ zoom: 25, panX: 0, panY: 0 }, 120).zoom).toBe(25);
    expect(computeWheelZoomView({ zoom: 300, panX: 0, panY: 0 }, -120).zoom).toBe(300);
  });
});
describe('Multimodal voice Canvas projections, archive merging, and panel exit semantics', () => {
  const mermaidProjection = {
    responseId: 'resp_voice_1',
    ordinal: 0,
    kind: 'mermaid' as const,
    subType: 'Flowchart',
    title: 'Auth Pipeline',
    rawSource: 'flowchart TD\n  Gateway --> AuthDB',
  };

  it('converts valid Mermaid, sequence, bar/line/pie, scatter, and sanitized SVG projections with deterministic IDs', () => {
    const flow = projectionToCanvasArtifact(mermaidProjection);
    expect(flow).toEqual({
      artifactId: 'resp_voice_1::canvas::0',
      messageId: 'resp_voice_1',
      index: 0,
      kind: 'mermaid',
      subType: 'Flowchart',
      title: 'Auth Pipeline',
      buttonLabel: 'View diagram',
      rawSource: 'flowchart TD\n  Gateway --> AuthDB',
      isStreaming: false,
    });

    const seq = projectionToCanvasArtifact({
      responseId: 'resp_voice_1',
      ordinal: 1,
      kind: 'mermaid',
      subType: 'Sequence Diagram',
      title: 'Handshake',
      rawSource: 'sequenceDiagram\n  User->>Aurvin: Speak\n  Aurvin-->>User: Visual',
    });
    expect(seq?.artifactId).toBe('resp_voice_1::canvas::1');
    expect(seq?.buttonLabel).toBe('View diagram');

    const untypedLineGraph = projectionToCanvasArtifact({
      responseId: 'resp_voice_1',
      ordinal: 2,
      kind: 'chart',
      subType: 'Line Graph',
      title: 'Latency Trend',
      rawSource: 'Mon: 42\nTue: 38\nWed: 31',
    });
    expect(untypedLineGraph?.buttonLabel).toBe('View graph');
    expect(forcedChartKindFromSubType('Line Graph', 'Mon: 42\nTue: 38')).toBe('line');

    // CanvasPanel renders untyped Line Graph projection as a line path rather than defaulting to bar rects
    const linePanelHtml = renderToStaticMarkup(
      createElement(CanvasPanel, {
        artifacts: [untypedLineGraph!],
        activeArtifactId: untypedLineGraph!.artifactId,
        onSelectArtifact: () => {},
        onCloseTab: () => {},
        onClosePanel: () => {},
      }),
    );
    expect(linePanelHtml).toContain('Latency Trend');
    expect(linePanelHtml).toContain('<path');

    const scatter = projectionToCanvasArtifact({
      responseId: 'resp_voice_2',
      ordinal: 0,
      kind: 'chart',
      subType: 'X-Y Point Plot',
      title: 'Clusters',
      rawSource: 'Dog: (8, 9)\nToaster: (-4, -3)',
    });
    expect(scatter?.buttonLabel).toBe('View graph');

    const safeSvg = projectionToCanvasArtifact({
      responseId: 'resp_voice_2',
      ordinal: 2,
      kind: 'svg',
      subType: 'SVG Visual',
      title: 'Badge',
      rawSource: '<svg viewBox="0 0 80 40"><script>alert(1)</script><rect x="2" y="2" width="40" height="20" /></svg>',
    });
    expect(safeSvg?.artifactId).toBe('resp_voice_2::canvas::2');
    expect(safeSvg?.buttonLabel).toBe('View diagram');
  });

  it('rejects malformed or empty unrenderable projections without throwing', () => {
    expect(
      projectionToCanvasArtifact({
        ...mermaidProjection,
        rawSource: 'flowchart TD',
      }),
    ).toBeNull();
    expect(
      projectionToCanvasArtifact({
        ...mermaidProjection,
        kind: 'chart',
        subType: 'Bar Chart',
        rawSource: '{"type":"bar","labels":["A"],"datasets":[]}',
      }),
    ).toBeNull();
    expect(
      projectionToCanvasArtifact({
        ...mermaidProjection,
        kind: 'svg',
        subType: 'SVG Visual',
        rawSource: '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>',
      }),
    ).toBeNull();
    expect(
      projectionToCanvasArtifact({
        ...mermaidProjection,
        ordinal: 4,
      }),
    ).toBeNull();
  });

  it('validates archive voice messages via isVisibleMessageCanvasArtifacts and deduplicates live-to-archive merges', () => {
    const validVoiceMsg: VisibleMessage = {
      messageId: 'msg_voice_9',
      turnId: 'turn_9',
      eventId: 'evt_9',
      sequence: 4,
      role: 'assistant',
      content: '',
      createdAt: '2026-11-02T10:00:00.000Z',
      completionStatus: 'completed',
      truncated: false,
      mode: 'live',
      voiceSessionId: 'vs_1',
      voiceTranscripts: [{ role: 'assistant', content: 'Explaining the auth pipeline.' }],
      canvasArtifacts: [mermaidProjection],
    };

    const invalidUserMsg: VisibleMessage = {
      ...validVoiceMsg,
      messageId: 'msg_bad_user',
      role: 'user',
    };

    expect(extractVoiceMessageCanvasArtifacts(invalidUserMsg)).toEqual([]);
    const archived = collectSessionCanvasArtifacts([invalidUserMsg, validVoiceMsg], '', false);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.artifactId).toBe('resp_voice_1::canvas::0');
    expect(archived[0]?.messageId).toBe('msg_voice_9');

    const secondLive = {
      responseId: 'resp_voice_2',
      ordinal: 1,
      kind: 'chart' as const,
      subType: 'Pie Chart',
      title: 'Share',
      rawSource: '{"type":"pie","labels":["A","B"],"datasets":[{"label":"S","data":[60,40]}]}',
    };

    const merged = mergeSessionCanvasArtifacts(archived, [mermaidProjection, secondLive]);
    expect(merged.map((item) => item.artifactId)).toEqual([
      'resp_voice_1::canvas::0',
      'resp_voice_2::canvas::1',
    ]);
    // Durable archive artifact wins over provisional live projection with identical artifactId
    expect(merged[0]?.messageId).toBe('msg_voice_9');
  });

  it('claims auto-open once per unique live artifact, closes last tab cleanly, and renders exiting panel as inert', () => {
    const seen = new Set<string>();
    expect(claimNewAutoOpenArtifactId([mermaidProjection], seen)).toBe('resp_voice_1::canvas::0');
    expect(claimNewAutoOpenArtifactId([mermaidProjection], seen)).toBeNull();

    // Closing last tab closes panel even if activeCanvasArtifactId had drifted
    const closedLast = chatReducer(
      {
        ...initialChatState,
        canvasOpen: true,
        activeCanvasArtifactId: 'stale_id',
      },
      {
        type: 'CLOSE_CANVAS_TAB',
        payload: { artifactId: 'resp_voice_1::canvas::0', fallbackArtifactId: null },
      },
    );
    expect(closedLast.canvasOpen).toBe(false);
    expect(closedLast.activeCanvasArtifactId).toBeNull();

    expect(CANVAS_TRANSITION_MS).toBeGreaterThanOrEqual(300);
    expect(CANVAS_TRANSITION_MS).toBeLessThanOrEqual(350);
    expect(prefersReducedCanvasMotion({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(prefersReducedCanvasMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);

    const focusSpy = { focus: (opts?: FocusOptions) => opts };
    let focusedWith: FocusOptions | undefined;
    const liveToggle = {
      focus: (opts?: FocusOptions) => {
        focusedWith = opts;
      },
    } as unknown as HTMLElement;
    expect(
      resolveCanvasCloseFocusTarget({
        liveActive: true,
        liveCanvasToggle: liveToggle,
        headerCanvasToggle: focusSpy as unknown as HTMLElement,
      }),
    ).toBe(liveToggle);
    restoreCanvasCloseFocus({ liveActive: true, liveCanvasToggle: liveToggle });
    expect(focusedWith).toEqual({ preventScroll: true });

    const artifact = projectionToCanvasArtifact(mermaidProjection)!;
    const exitingHtml = renderToStaticMarkup(
      createElement(CanvasPanel, {
        artifacts: [artifact],
        activeArtifactId: artifact.artifactId,
        onSelectArtifact: () => {},
        onCloseTab: () => {},
        onClosePanel: () => {},
        transitionState: 'exiting',
      }),
    );
    expect(exitingHtml).toContain('id="aurvin-canvas-panel"');
    expect(exitingHtml).toContain('data-canvas-state="exiting"');
    expect(exitingHtml).toContain('aria-hidden="true"');
    expect(exitingHtml).toContain('inert=""');
  });
});
