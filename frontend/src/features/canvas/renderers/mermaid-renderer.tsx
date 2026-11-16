/**
 * ============================================================================
 * FILE: mermaid-renderer.tsx
 * LOCATION: frontend/src/features/canvas/renderers/mermaid-renderer.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Pure React SVG renderer for Mermaid flowcharts, sequence, state, and pie diagrams.
 *
 * ROLE IN PROJECT:
 *    Converts Mermaid source text into layered SVG vector diagrams inside
 *    Aurvin's Canvas without browser-only DOM dependencies or unsafe HTML.
 *
 * KEY COMPONENTS:
 *    - layoutFlowchart: Topological rank layout for TD/TB/BT/LR/RL graphs.
 *    - renderFlowchartSvg: Renders subgraphs, Bezier edges, and node shapes.
 *    - renderSequenceSvg: Renders lifelines, actors, messages, and notes.
 *    - MermaidRenderer: Top-level component dispatching by parsed diagram kind.
 * ============================================================================
 */

import { parseMermaidSource } from '../canvas-artifacts.ts';
import type {
  MermaidEdge,
  MermaidFlowDirection,
  MermaidFlowModel,
  MermaidNode,
  MermaidSequenceModel,
} from '../canvas-types.ts';
import { ChartRenderer } from './chart-renderer.tsx';

type PositionedNode = MermaidNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
  lines: string[];
};

type PositionedSubgraph = {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function wrapNodeLabel(label: string, maxCharsPerLine = 24): string[] {
  const cleaned = label.trim();
  if (!cleaned) return [];

  const explicitParagraphs = cleaned.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of explicitParagraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    let current = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const word = words[i]!;
      if (current.length + 1 + word.length <= maxCharsPerLine) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  if (lines.length <= 3) {
    return lines;
  }
  const head = lines.slice(0, 2);
  const rest = lines.slice(2).join(' ');
  head.push(rest.length > maxCharsPerLine + 3 ? `${rest.slice(0, maxCharsPerLine)}…` : rest);
  return head;
}

function measureNode(node: MermaidNode): { width: number; height: number; lines: string[] } {
  if (node.shape === 'state-start' || node.shape === 'state-end') {
    return { width: 28, height: 28, lines: [] };
  }
  const maxWrap = node.shape === 'diamond' ? 20 : node.shape === 'circle' ? 16 : 24;
  const lines = wrapNodeLabel(node.label, maxWrap);
  const maxLineLen = Math.max(4, ...lines.map((l) => l.length));
  const lineCount = Math.max(1, lines.length);

  if (node.shape === 'circle') {
    const diameter = Math.max(68, Math.min(148, 38 + maxLineLen * 6.4 + (lineCount - 1) * 14));
    return { width: diameter, height: diameter, lines };
  }
  if (node.shape === 'diamond') {
    const width = Math.max(136, Math.min(260, 72 + maxLineLen * 7.4));
    const height = Math.max(76, 54 + lineCount * 18);
    return { width, height, lines };
  }
  if (node.shape === 'cylinder') {
    const width = Math.max(136, Math.min(256, 46 + maxLineLen * 7.5));
    const height = Math.max(60, 42 + lineCount * 18);
    return { width, height, lines };
  }
  const width = Math.max(132, Math.min(256, 44 + maxLineLen * 7.5));
  const height = Math.max(46, 28 + lineCount * 18);
  return { width, height, lines };
}

function layoutNodeGroup(
  groupNodes: MermaidNode[],
  allEdges: MermaidEdge[],
  direction: MermaidFlowDirection,
): {
  width: number;
  height: number;
  nodes: Map<string, PositionedNode>;
} {
  const memberIds = new Set(groupNodes.map((n) => n.id));
  const internalEdges = allEdges.filter(
    (e) => e.from !== e.to && memberIds.has(e.from) && memberIds.has(e.to),
  );

  const ranks = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const preds = new Map<string, string[]>();

  for (const node of groupNodes) {
    ranks.set(node.id, 0);
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
    preds.set(node.id, []);
  }

  for (const edge of internalEdges) {
    adj.get(edge.from)?.push(edge.to);
    preds.get(edge.to)?.push(edge.from);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Longest-path rank assignment with cycle cap (ponytail: bounded DAG relaxation)
  const queue: string[] = [];
  for (const node of groupNodes) {
    if ((inDegree.get(node.id) ?? 0) === 0) {
      queue.push(node.id);
    }
  }
  if (queue.length === 0 && groupNodes[0]) {
    queue.push(groupNodes[0].id);
  }

  const maxRankCap = Math.max(1, groupNodes.length);
  let visits = 0;
  while (queue.length > 0 && visits < groupNodes.length * 5) {
    const curr = queue.shift()!;
    visits += 1;
    const currRank = ranks.get(curr) ?? 0;
    for (const next of adj.get(curr) ?? []) {
      const candidate = Math.min(maxRankCap, currRank + 1);
      if (candidate > (ranks.get(next) ?? 0)) {
        ranks.set(next, candidate);
        queue.push(next);
      }
    }
  }

  // Pull slack source nodes closer to their targets so parallel branches don't stretch
  for (let pass = 0; pass < 2; pass++) {
    for (let i = groupNodes.length - 1; i >= 0; i--) {
      const node = groupNodes[i]!;
      const incoming = preds.get(node.id) ?? [];
      const outgoing = adj.get(node.id) ?? [];
      if (incoming.length === 0 && outgoing.length > 0) {
        const minTargetRank = Math.min(...outgoing.map((t) => ranks.get(t) ?? 0));
        if (minTargetRank > 1) {
          ranks.set(node.id, minTargetRank - 1);
        }
      }
    }
  }

  // Normalize ranks to start at 0 with no empty rank gaps
  const distinctRanks = Array.from(new Set(ranks.values())).sort((a, b) => a - b);
  const rankRemap = new Map<number, number>();
  distinctRanks.forEach((oldR, idx) => rankRemap.set(oldR, idx));

  const layers = new Map<number, MermaidNode[]>();
  let maxRank = 0;
  for (const node of groupNodes) {
    const r = rankRemap.get(ranks.get(node.id) ?? 0) ?? 0;
    ranks.set(node.id, r);
    maxRank = Math.max(maxRank, r);
    const list = layers.get(r) ?? [];
    list.push(node);
    layers.set(r, list);
  }

  // 2-pass barycenter ordering within each layer to minimize edge crossings
  const orderIndex = new Map<string, number>();
  const refreshOrderIndex = () => {
    for (const list of layers.values()) {
      list.forEach((n, idx) => orderIndex.set(n.id, idx));
    }
  };
  refreshOrderIndex();

  for (let r = 1; r <= maxRank; r++) {
    const list = layers.get(r);
    if (!list || list.length <= 1) continue;
    list.sort((a, b) => {
      const pa = preds.get(a.id) ?? [];
      const pb = preds.get(b.id) ?? [];
      const avgA =
        pa.length > 0
          ? pa.reduce((s, id) => s + (orderIndex.get(id) ?? 0), 0) / pa.length
          : (orderIndex.get(a.id) ?? 0);
      const avgB =
        pb.length > 0
          ? pb.reduce((s, id) => s + (orderIndex.get(id) ?? 0), 0) / pb.length
          : (orderIndex.get(b.id) ?? 0);
      return avgA - avgB;
    });
    refreshOrderIndex();
  }

  for (let r = maxRank - 1; r >= 0; r--) {
    const list = layers.get(r);
    if (!list || list.length <= 1) continue;
    list.sort((a, b) => {
      const sa = adj.get(a.id) ?? [];
      const sb = adj.get(b.id) ?? [];
      if (sa.length === 0 || sb.length === 0) return 0;
      const avgA = sa.reduce((s, id) => s + (orderIndex.get(id) ?? 0), 0) / sa.length;
      const avgB = sb.reduce((s, id) => s + (orderIndex.get(id) ?? 0), 0) / sb.length;
      return avgA - avgB;
    });
    refreshOrderIndex();
  }

  const isHorizontal = direction === 'LR' || direction === 'RL';
  const isReversed = direction === 'BT' || direction === 'RL';

  const measured = new Map<string, { width: number; height: number; lines: string[] }>();
  for (const node of groupNodes) {
    measured.set(node.id, measureNode(node));
  }

  const siblingGap = isHorizontal ? 32 : 42;
  const rankGap = isHorizontal ? 76 : 54;

  // Compute rank thicknesses and cross-axis spans
  const rankThickness: number[] = [];
  const rankSpan: number[] = [];

  for (let r = 0; r <= maxRank; r++) {
    const effectiveR = isReversed ? maxRank - r : r;
    const list = layers.get(effectiveR) ?? [];
    if (list.length === 0) {
      rankThickness.push(48);
      rankSpan.push(140);
      continue;
    }
    if (isHorizontal) {
      const maxW = Math.max(...list.map((n) => measured.get(n.id)!.width));
      const totalH =
        list.reduce((acc, n) => acc + measured.get(n.id)!.height, 0) +
        Math.max(0, list.length - 1) * siblingGap;
      rankThickness.push(maxW);
      rankSpan.push(totalH);
    } else {
      const maxH = Math.max(...list.map((n) => measured.get(n.id)!.height));
      const totalW =
        list.reduce((acc, n) => acc + measured.get(n.id)!.width, 0) +
        Math.max(0, list.length - 1) * siblingGap;
      rankThickness.push(maxH);
      rankSpan.push(totalW);
    }
  }

  const totalFlowSpan =
    rankThickness.reduce((a, b) => a + b, 0) + Math.max(0, maxRank) * rankGap;
  const maxCrossSpan = Math.max(140, ...rankSpan);

  const width = isHorizontal ? totalFlowSpan : maxCrossSpan;
  const height = isHorizontal ? maxCrossSpan : totalFlowSpan;

  const positioned = new Map<string, PositionedNode>();
  let flowCursor = 0;

  for (let step = 0; step <= maxRank; step++) {
    const effectiveR = isReversed ? maxRank - step : step;
    const list = layers.get(effectiveR) ?? [];
    const thickness = rankThickness[step] ?? 48;
    const rankCenterFlow = flowCursor + thickness / 2;

    const totalSiblingSpan = rankSpan[step] ?? 0;
    let siblingCursor = (maxCrossSpan - totalSiblingSpan) / 2;

    for (const node of list) {
      const m = measured.get(node.id)!;
      const siblingSize = isHorizontal ? m.height : m.width;
      const siblingCenter = siblingCursor + siblingSize / 2;

      const x = isHorizontal ? rankCenterFlow : siblingCenter;
      const y = isHorizontal ? siblingCenter : rankCenterFlow;

      positioned.set(node.id, {
        ...node,
        x,
        y,
        width: m.width,
        height: m.height,
        rank: step,
        lines: m.lines,
      });

      siblingCursor += siblingSize + siblingGap;
    }

    flowCursor += thickness + rankGap;
  }

  return { width, height, nodes: positioned };
}

function layoutFlowchart(model: MermaidFlowModel): {
  width: number;
  height: number;
  nodes: Map<string, PositionedNode>;
  subgraphs: PositionedSubgraph[];
} {
  const isHorizontal = model.direction === 'LR' || model.direction === 'RL';
  const padTop = model.title ? 52 : 20;
  const padBottom = 20;
  const padSide = 20;

  const activeSubgraphs = model.subgraphs.filter((sg) =>
    sg.nodeIds.some((id) => model.nodes.some((n) => n.id === id)),
  );

  if (activeSubgraphs.length === 0) {
    const group = layoutNodeGroup(model.nodes, model.edges, model.direction);
    const hasSkipEdge = model.edges.some((e) => {
      const f = group.nodes.get(e.from);
      const t = group.nodes.get(e.to);
      return f && t && Math.abs(f.rank - t.rank) > 1;
    });
    const extraSide = hasSkipEdge ? 44 : 0;
    const width = Math.max(240, group.width + (padSide + extraSide) * 2);
    const height = Math.max(200, group.height + padTop + padBottom);
    const offsetX = (width - group.width) / 2;
    const offsetY = padTop + (height - padTop - padBottom - group.height) / 2;

    const finalNodes = new Map<string, PositionedNode>();
    for (const [id, n] of group.nodes.entries()) {
      finalNodes.set(id, {
        ...n,
        x: n.x + offsetX,
        y: n.y + offsetY,
      });
    }
    return { width, height, nodes: finalNodes, subgraphs: [] };
  }

  // Compound cluster layout when subgraphs exist
  type ClusterItem = {
    clusterId: string;
    isSubgraph: boolean;
    title: string;
    memberIds: Set<string>;
    width: number;
    height: number;
    localNodes: Map<string, PositionedNode>;
    hasIndependentRoot: boolean;
  };

  const globalInDegree = new Map<string, number>();
  for (const n of model.nodes) globalInDegree.set(n.id, 0);
  for (const e of model.edges) {
    if (e.from !== e.to) {
      globalInDegree.set(e.to, (globalInDegree.get(e.to) ?? 0) + 1);
    }
  }

  const clusters: ClusterItem[] = [];
  const nodeToCluster = new Map<string, string>();

  const sgHeaderH = 46;
  const sgPadBottom = 22;

  for (const sg of activeSubgraphs) {
    const sgNodes = model.nodes.filter((n) => n.subgraphId === sg.id);
    if (sgNodes.length === 0) continue;
    const inner = layoutNodeGroup(sgNodes, model.edges, model.direction);
    const hasInternalSkipEdge = model.edges.some((e) => {
      const f = inner.nodes.get(e.from);
      const t = inner.nodes.get(e.to);
      return f && t && Math.abs(f.rank - t.rank) > 1;
    });
    const sgPadX = hasInternalSkipEdge ? 46 : 24;
    const minTitleW = Math.max(176, sg.title.length * 7.8 + 40);
    const boxW = Math.max(minTitleW, inner.width + sgPadX * 2);
    const boxH = inner.height + sgHeaderH + sgPadBottom;
    const innerOffsetX = (boxW - inner.width) / 2;
    const innerOffsetY = sgHeaderH;

    const localNodes = new Map<string, PositionedNode>();
    for (const [id, n] of inner.nodes.entries()) {
      localNodes.set(id, {
        ...n,
        x: n.x + innerOffsetX,
        y: n.y + innerOffsetY,
      });
      nodeToCluster.set(id, sg.id);
    }

    const hasIndependentRoot = sgNodes.some((n) => (globalInDegree.get(n.id) ?? 0) === 0);

    clusters.push({
      clusterId: sg.id,
      isSubgraph: true,
      title: sg.title,
      memberIds: new Set(sgNodes.map((n) => n.id)),
      width: boxW,
      height: boxH,
      localNodes,
      hasIndependentRoot,
    });
  }

  // Any top-level nodes outside subgraphs become individual clusters
  for (const node of model.nodes) {
    if (nodeToCluster.has(node.id)) continue;
    const cid = `__free_${node.id}`;
    const m = measureNode(node);
    const localNodes = new Map<string, PositionedNode>();
    localNodes.set(node.id, {
      ...node,
      x: m.width / 2,
      y: m.height / 2,
      width: m.width,
      height: m.height,
      rank: 0,
      lines: m.lines,
    });
    nodeToCluster.set(node.id, cid);
    clusters.push({
      clusterId: cid,
      isSubgraph: false,
      title: '',
      memberIds: new Set([node.id]),
      width: m.width,
      height: m.height,
      localNodes,
      hasIndependentRoot: (globalInDegree.get(node.id) ?? 0) === 0,
    });
  }

  // Assign macro-ranks to clusters:
  // Parallel pipelines that each have their own independent root stay side-by-side at macroRank 0
  const clusterMap = new Map(clusters.map((c) => [c.clusterId, c]));
  const clusterRank = new Map<string, number>();
  for (const c of clusters) clusterRank.set(c.clusterId, 0);

  for (let pass = 0; pass < clusters.length; pass++) {
    for (const edge of model.edges) {
      const fromC = nodeToCluster.get(edge.from);
      const toC = nodeToCluster.get(edge.to);
      if (!fromC || !toC || fromC === toC) continue;
      const targetCluster = clusterMap.get(toC);
      if (!targetCluster) continue;

      if (!targetCluster.hasIndependentRoot) {
        const candidate = Math.min(clusters.length, (clusterRank.get(fromC) ?? 0) + 1);
        if (candidate > (clusterRank.get(toC) ?? 0)) {
          clusterRank.set(toC, candidate);
        }
      }
    }
  }

  const distinctMacroRanks = Array.from(new Set(clusterRank.values())).sort((a, b) => a - b);
  const macroLayers: ClusterItem[][] = distinctMacroRanks.map((r) =>
    clusters.filter((c) => clusterRank.get(c.clusterId) === r),
  );

  const clusterGapSide = 54;
  const clusterGapFlow = 52;

  const layerFlowThickness: number[] = [];
  const layerCrossSpan: number[] = [];

  for (const layer of macroLayers) {
    if (isHorizontal) {
      const maxW = Math.max(...layer.map((c) => c.width));
      const sumH =
        layer.reduce((acc, c) => acc + c.height, 0) +
        Math.max(0, layer.length - 1) * clusterGapSide;
      layerFlowThickness.push(maxW);
      layerCrossSpan.push(sumH);
    } else {
      const maxH = Math.max(...layer.map((c) => c.height));
      const sumW =
        layer.reduce((acc, c) => acc + c.width, 0) +
        Math.max(0, layer.length - 1) * clusterGapSide;
      layerFlowThickness.push(maxH);
      layerCrossSpan.push(sumW);
    }
  }

  const totalFlow =
    layerFlowThickness.reduce((a, b) => a + b, 0) +
    Math.max(0, macroLayers.length - 1) * clusterGapFlow;
  const maxCross = Math.max(360, ...layerCrossSpan);

  const contentW = isHorizontal ? totalFlow : maxCross;
  const contentH = isHorizontal ? maxCross : totalFlow;

  const width = contentW + padSide * 2;
  const height = contentH + padTop + padBottom;

  const baseX = (width - contentW) / 2;
  const baseY = padTop;

  const finalNodes = new Map<string, PositionedNode>();
  const finalSubgraphs: PositionedSubgraph[] = [];

  let flowCursor = 0;
  for (let lIdx = 0; lIdx < macroLayers.length; lIdx++) {
    const layer = macroLayers[lIdx]!;
    const flowSize = layerFlowThickness[lIdx] ?? 0;
    const crossSpan = layerCrossSpan[lIdx] ?? 0;
    let crossCursor = (maxCross - crossSpan) / 2;

    for (const cluster of layer) {
      const cx = isHorizontal ? baseX + flowCursor : baseX + crossCursor;
      const cy = isHorizontal ? baseY + crossCursor : baseY + flowCursor;

      if (cluster.isSubgraph) {
        finalSubgraphs.push({
          id: cluster.clusterId,
          title: cluster.title,
          x: cx,
          y: cy,
          width: cluster.width,
          height: cluster.height,
        });
      }

      for (const [id, ln] of cluster.localNodes.entries()) {
        finalNodes.set(id, {
          ...ln,
          x: cx + ln.x,
          y: cy + ln.y,
        });
      }

      crossCursor += (isHorizontal ? cluster.height : cluster.width) + clusterGapSide;
    }

    flowCursor += flowSize + clusterGapFlow;
  }

  return { width, height, nodes: finalNodes, subgraphs: finalSubgraphs };
}

function renderNodeShape(node: PositionedNode) {
  const { x, y, width: w, height: h, shape } = node;
  const halfW = w / 2;
  const halfH = h / 2;

  if (shape === 'state-start') {
    return (
      <circle
        cx={x}
        cy={y}
        r={11}
        className="aurvin-canvas-node-state-start"
      />
    );
  }

  if (shape === 'state-end') {
    return (
      <g>
        <circle
          cx={x}
          cy={y}
          r={13}
          fill="none"
          stroke="var(--aurvin-canvas-node-stroke, #71717a)"
          strokeWidth="2"
        />
        <circle
          cx={x}
          cy={y}
          r={7}
          className="aurvin-canvas-node-state-start"
        />
      </g>
    );
  }

  if (shape === 'diamond') {
    const pts = `${x},${y - halfH} ${x + halfW},${y} ${x},${y + halfH} ${x - halfW},${y}`;
    return <polygon points={pts} className="aurvin-canvas-node-shape aurvin-canvas-node-diamond" />;
  }

  if (shape === 'circle') {
    return (
      <circle
        cx={x}
        cy={y}
        r={halfW}
        className="aurvin-canvas-node-shape aurvin-canvas-node-circle"
      />
    );
  }

  if (shape === 'cylinder') {
    const ry = 8;
    const topY = y - halfH + ry;
    const botY = y + halfH - ry;
    const d = [
      `M ${x - halfW} ${topY}`,
      `L ${x - halfW} ${botY}`,
      `A ${halfW} ${ry} 0 0 0 ${x + halfW} ${botY}`,
      `L ${x + halfW} ${topY}`,
      `A ${halfW} ${ry} 0 0 0 ${x - halfW} ${topY}`,
      'Z',
    ].join(' ');
    return (
      <g>
        <path d={d} className="aurvin-canvas-node-shape" />
        <ellipse
          cx={x}
          cy={topY}
          rx={halfW}
          ry={ry}
          className="aurvin-canvas-node-shape aurvin-canvas-node-cylinder-cap"
        />
      </g>
    );
  }

  if (shape === 'subroutine') {
    return (
      <g>
        <rect
          x={x - halfW}
          y={y - halfH}
          width={w}
          height={h}
          rx={6}
          className="aurvin-canvas-node-shape"
        />
        <line
          x1={x - halfW + 10}
          y1={y - halfH}
          x2={x - halfW + 10}
          y2={y + halfH}
          stroke="var(--aurvin-canvas-node-stroke, #71717a)"
          strokeWidth="1.5"
        />
        <line
          x1={x + halfW - 10}
          y1={y - halfH}
          x2={x + halfW - 10}
          y2={y + halfH}
          stroke="var(--aurvin-canvas-node-stroke, #71717a)"
          strokeWidth="1.5"
        />
      </g>
    );
  }

  const rx = shape === 'stadium' ? halfH : shape === 'rounded' ? 8 : 5;
  return (
    <rect
      x={x - halfW}
      y={y - halfH}
      width={w}
      height={h}
      rx={rx}
      className="aurvin-canvas-node-shape"
    />
  );
}

function renderNodeLabel(node: PositionedNode) {
  if (node.lines.length === 0) return null;
  const textCenterY = node.shape === 'cylinder' ? node.y + 4 : node.y;
  if (node.lines.length === 1) {
    return (
      <text
        x={node.x}
        y={textCenterY + 4.5}
        textAnchor="middle"
        className="aurvin-canvas-node-label"
      >
        {node.lines[0]}
      </text>
    );
  }
  const lineStep = 17;
  const startY = textCenterY + 4.5 - ((node.lines.length - 1) * lineStep) / 2;
  return (
    <text x={node.x} textAnchor="middle" className="aurvin-canvas-node-label">
      {node.lines.map((line, idx) => (
        <tspan key={idx} x={node.x} y={startY + idx * lineStep}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function renderFlowchartSvg(model: MermaidFlowModel) {
  const { width, height, nodes, subgraphs } = layoutFlowchart(model);
  const isHorizontal = model.direction === 'LR' || model.direction === 'RL';
  const allPositionedNodes = Array.from(nodes.values());

  return (
    <svg
      className="aurvin-canvas-svg aurvin-canvas-mermaid-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={model.title ?? 'Mermaid flowchart diagram'}
    >
      <defs>
        <marker
          id="aurvin-mermaid-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 9.2 5 L 0 8.5 L 1.8 5 z" fill="var(--aurvin-canvas-edge, #a1a1aa)" />
        </marker>
      </defs>

      {model.title ? (
        <text x={width / 2} y={28} textAnchor="middle" className="aurvin-canvas-svg-title">
          {model.title}
        </text>
      ) : null}

      {/* Subgraph containers with clean Markdown-editor header strips */}
      <g className="aurvin-canvas-subgraphs">
        {subgraphs.map((sg) => (
          <g key={`sg-${sg.id}`} className="aurvin-canvas-subgraph-group">
            <rect
              x={sg.x}
              y={sg.y}
              width={sg.width}
              height={sg.height}
              rx={10}
              className="aurvin-canvas-subgraph-box"
            />
            <line
              x1={sg.x}
              y1={sg.y + 34}
              x2={sg.x + sg.width}
              y2={sg.y + 34}
              className="aurvin-canvas-subgraph-divider"
            />
            <text
              x={sg.x + sg.width / 2}
              y={sg.y + 22}
              textAnchor="middle"
              className="aurvin-canvas-subgraph-title"
            >
              {sg.title}
            </text>
          </g>
        ))}
      </g>

      {/* Edges */}
      <g className="aurvin-canvas-edges">
        {model.edges.map((edge, idx) => {
          const from = nodes.get(edge.from);
          const to = nodes.get(edge.to);
          if (!from || !to) return null;

          let sx = from.x;
          let sy = from.y;
          let tx = to.x;
          let ty = to.y;
          let c1x = sx;
          let c1y = sy;
          let c2x = tx;
          let c2y = ty;

          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const crossSubgraphHorizontal =
            !isHorizontal &&
            from.subgraphId !== to.subgraphId &&
            Math.abs(dx) > (from.width + to.width) * 0.55;

          const sameRowSideLink =
            !isHorizontal && Math.abs(dy) < 28 && Math.abs(dx) > (from.width + to.width) * 0.55;

          if (isHorizontal) {
            const dir = dx >= 0 ? 1 : -1;
            sx = from.x + (dir * from.width) / 2;
            tx = to.x - (dir * to.width) / 2;
            const mx = (sx + tx) / 2;
            c1x = mx;
            c1y = sy;
            c2x = mx;
            c2y = ty;
          } else if (crossSubgraphHorizontal || sameRowSideLink) {
            // Connect side-to-side across the corridor between parallel subgraphs/columns
            const dirX = dx >= 0 ? 1 : -1;
            sx = from.x + (dirX * from.width) / 2;
            sy = from.y;
            tx = to.x - (dirX * to.width) / 2;
            ty = to.y;
            const mx = (sx + tx) / 2;
            c1x = mx;
            c1y = sy;
            c2x = mx;
            c2y = ty;
          } else {
            const dirY = dy >= 0 ? 1 : -1;
            const rawSy = from.y + (dirY * from.height) / 2;
            const rawTy = to.y - (dirY * to.height) / 2;

            // Check if any intermediate nodes sit on the vertical line between from and to
            const minY = Math.min(rawSy, rawTy);
            const maxY = Math.max(rawSy, rawTy);
            const blockingNodes =
              Math.abs(sx - tx) < 28
                ? allPositionedNodes.filter(
                    (n) =>
                      n.id !== from.id &&
                      n.id !== to.id &&
                      n.y > minY + 6 &&
                      n.y < maxY - 6 &&
                      Math.abs(n.x - sx) < n.width / 2 + 16,
                  )
                : [];

            if (blockingNodes.length > 0) {
              // Exit from the right side of `from`, arc cleanly around the widest intermediate node, and enter the right side of `to`
              const maxHalfW = Math.max(
                from.width / 2,
                to.width / 2,
                ...blockingNodes.map((n) => n.width / 2),
              );
              sx = from.x + from.width / 2;
              sy = from.y;
              tx = to.x + to.width / 2;
              ty = to.y;
              const detourX = from.x + maxHalfW + 34;
              c1x = detourX;
              c1y = sy + (ty - sy) * 0.2;
              c2x = detourX;
              c2y = sy + (ty - sy) * 0.8;
            } else {
              sy = rawSy;
              ty = rawTy;
              const my = (sy + ty) / 2;
              c1x = sx;
              c1y = my;
              c2x = tx;
              c2y = my;
            }
          }

          const d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`;
          const midCurveX = 0.125 * sx + 0.375 * c1x + 0.375 * c2x + 0.125 * tx;
          const midCurveY = 0.125 * sy + 0.375 * c1y + 0.375 * c2y + 0.125 * ty;
          const labelWidth = edge.label ? Math.max(44, edge.label.length * 6.8 + 18) : 0;

          return (
            <g key={`edge-${idx}`} className="aurvin-canvas-edge-group">
              <path
                d={d}
                fill="none"
                className={`aurvin-canvas-edge-path aurvin-canvas-edge-${edge.style}`}
                strokeDasharray={edge.style === 'dashed' ? '6 4' : undefined}
                strokeWidth={edge.style === 'thick' ? 2.6 : 1.75}
                markerEnd={edge.style === 'open' ? undefined : 'url(#aurvin-mermaid-arrow)'}
              />
              {edge.label ? (
                <g transform={`translate(${midCurveX.toFixed(1)}, ${midCurveY.toFixed(1)})`}>
                  <rect
                    x={-labelWidth / 2}
                    y={-11}
                    width={labelWidth}
                    height={21}
                    rx={5}
                    className="aurvin-canvas-edge-label-bg"
                  />
                  <text
                    x={0}
                    y={3.5}
                    textAnchor="middle"
                    className="aurvin-canvas-edge-label-text"
                  >
                    {edge.label}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </g>

      {/* Nodes */}
      <g className="aurvin-canvas-nodes">
        {allPositionedNodes.map((node) => (
          <g key={`node-${node.id}`} className="aurvin-canvas-node-group" data-node-id={node.id}>
            {renderNodeShape(node)}
            {renderNodeLabel(node)}
          </g>
        ))}
      </g>
    </svg>
  );
}

function renderSequenceSvg(model: MermaidSequenceModel) {
  const count = Math.max(1, model.participants.length);
  const colSpacing = 190;
  const padSide = 95;
  const padTop = model.title ? 72 : 36;
  const boxW = 142;
  const boxH = 42;
  const rowStep = 56;

  const width = Math.max(640, padSide * 2 + Math.max(0, count - 1) * colSpacing + boxW);
  const bodyHeight = Math.max(120, (model.items.length + 1) * rowStep);
  const height = padTop + boxH * 2 + bodyHeight + 48;

  const participantX = new Map<string, number>();
  model.participants.forEach((p, idx) => {
    const x =
      count === 1
        ? width / 2
        : padSide + boxW / 2 + idx * ((width - padSide * 2 - boxW) / (count - 1));
    participantX.set(p.id, x);
  });

  const lifelineTop = padTop + boxH;
  const lifelineBottom = padTop + boxH + bodyHeight;

  return (
    <svg
      className="aurvin-canvas-svg aurvin-canvas-mermaid-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={model.title ?? 'Mermaid sequence diagram'}
    >
      <defs>
        <marker
          id="aurvin-seq-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 9.2 5 L 0 8.5 L 1.8 5 z" fill="var(--aurvin-canvas-edge, #a1a1aa)" />
        </marker>
      </defs>

      {model.title ? (
        <text x={width / 2} y={32} textAnchor="middle" className="aurvin-canvas-svg-title">
          {model.title}
        </text>
      ) : null}

      {/* Lifelines & participant header/footer boxes */}
      {model.participants.map((p) => {
        const cx = participantX.get(p.id) ?? width / 2;
        return (
          <g key={`part-${p.id}`} className="aurvin-canvas-seq-participant">
            <line
              x1={cx}
              y1={lifelineTop}
              x2={cx}
              y2={lifelineBottom}
              className="aurvin-canvas-seq-lifeline"
              strokeDasharray="5 5"
            />
            <rect
              x={cx - boxW / 2}
              y={padTop}
              width={boxW}
              height={boxH}
              rx={7}
              className="aurvin-canvas-node-shape"
            />
            <text x={cx} y={padTop + 26} textAnchor="middle" className="aurvin-canvas-node-label">
              {p.label}
            </text>

            <rect
              x={cx - boxW / 2}
              y={lifelineBottom}
              width={boxW}
              height={boxH}
              rx={7}
              className="aurvin-canvas-node-shape"
            />
            <text
              x={cx}
              y={lifelineBottom + 26}
              textAnchor="middle"
              className="aurvin-canvas-node-label"
            >
              {p.label}
            </text>
          </g>
        );
      })}

      {/* Sequence messages and notes */}
      {model.items.map((item, idx) => {
        const y = lifelineTop + (idx + 1) * rowStep - 12;

        if (item.itemType === 'note') {
          const xs = item.overIds.map((id) => participantX.get(id) ?? width / 2);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const noteW = Math.max(150, maxX - minX + 110);
          const cx = (minX + maxX) / 2;
          return (
            <g key={`seq-note-${idx}`} className="aurvin-canvas-seq-note">
              <rect
                x={cx - noteW / 2}
                y={y - 18}
                width={noteW}
                height={34}
                rx={6}
                className="aurvin-canvas-seq-note-box"
              />
              <text x={cx} y={y + 4} textAnchor="middle" className="aurvin-canvas-edge-label-text">
                {item.text}
              </text>
            </g>
          );
        }

        const fromX = participantX.get(item.from) ?? width / 2;
        const toX = participantX.get(item.to) ?? width / 2;

        if (item.from === item.to) {
          const loopPath = `M ${fromX} ${y - 6} L ${fromX + 42} ${y - 6} L ${fromX + 42} ${y + 14} L ${fromX + 4} ${y + 14}`;
          return (
            <g key={`seq-msg-${idx}`}>
              <path
                d={loopPath}
                fill="none"
                className="aurvin-canvas-edge-path"
                strokeDasharray={item.dashed ? '6 4' : undefined}
                strokeWidth="1.75"
                markerEnd="url(#aurvin-seq-arrow)"
              />
              <text x={fromX + 48} y={y + 6} className="aurvin-canvas-edge-label-text">
                {item.text}
              </text>
            </g>
          );
        }

        const midX = (fromX + toX) / 2;
        return (
          <g key={`seq-msg-${idx}`}>
            <line
              x1={fromX}
              y1={y}
              x2={toX}
              y2={y}
              className="aurvin-canvas-edge-path"
              strokeDasharray={item.dashed ? '6 4' : undefined}
              strokeWidth="1.75"
              markerEnd="url(#aurvin-seq-arrow)"
            />
            {item.text ? (
              <text
                x={midX}
                y={y - 8}
                textAnchor="middle"
                className="aurvin-canvas-edge-label-text"
              >
                {item.text}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function MermaidRenderer({
  source,
  title,
}: {
  source: string;
  title?: string;
}) {
  const parsed = parseMermaidSource(source, title);

  if (parsed.kind === 'chart') {
    return <ChartRenderer source={source} title={title} model={parsed.chart} />;
  }

  if (parsed.kind === 'sequence') {
    if (parsed.participants.length === 0) {
      return (
        <div className="aurvin-canvas-fallback">
          <p className="aurvin-canvas-fallback-note">Generating sequence diagram…</p>
          <pre className="aurvin-canvas-fallback-code">
            <code>{source}</code>
          </pre>
        </div>
      );
    }
    return renderSequenceSvg(parsed);
  }

  if (parsed.nodes.length === 0) {
    return (
      <div className="aurvin-canvas-fallback">
        <p className="aurvin-canvas-fallback-note">Generating diagram…</p>
        <pre className="aurvin-canvas-fallback-code">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return renderFlowchartSvg(parsed);
}
