/**
 * ============================================================================
 * FILE: canvas-artifacts.ts
 * LOCATION: frontend/src/features/canvas/canvas-artifacts.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Detect, extract, and parse Mermaid diagrams, charts, and SVGs for Canvas.
 *
 * ROLE IN PROJECT:
 *    Transforms raw assistant Markdown fences and <aurvin-canvas> blocks into
 *    structured CanvasArtifact descriptors and layout-ready diagram/chart models.
 *
 * KEY COMPONENTS:
 *    - preprocessCanvasTags: Normalizes <aurvin-canvas> wrappers into code fences.
 *    - parseCanvasCodeBlock: Classifies fenced blocks into CanvasArtifact records.
 *    - parseChartSource / parseMermaidSource: Parses raw source into visual models.
 *    - collectSessionCanvasArtifacts: Gathers all session artifacts in order.
 * ============================================================================
 */

import {
  isVisibleMessageCanvasArtifacts,
  type CanvasArtifactProjection,
  type VisibleMessage,
} from '../../api/protocol.ts';
import { isCanvasArtifactProjection } from '../../api/voice-protocol.ts';
import { isCalendarView, type CalendarTurnState } from '../../api/calendar-protocol.ts';
import { calendarViewArtifact } from './calendar-workspace.ts';
import { parseMarkdown } from '../chat/markdown/parse-markdown.ts';
import type {
  CalendarEventDateTime,
  CalendarEventModel,
  CanvasArtifact,
  CanvasArtifactKind,
  ChartDataset,
  ChartKind,
  ChartModel,
  ChartPoint,
  MermaidEdge,
  MermaidEdgeStyle,
  MermaidFlowDirection,
  MermaidNode,
  MermaidNodeShape,
  MermaidParsedModel,
  MermaidSequenceModel,
  MermaidSubgraph,
} from './canvas-types.ts';

const MERMAID_HEADER_RE =
  /^(?:---\s*\n[\s\S]*?\n---\s*\n\s*)?(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|pie|xychart-beta|quadrantChart|gantt|mindmap)\b/i;

export function preprocessCanvasTags(markdown: string): string {
  if (!markdown.includes('<aurvin-canvas')) {
    return markdown;
  }
  const closedReplaced = markdown.replace(
    /<aurvin-canvas([^>]*)>([\s\S]*?)<\/aurvin-canvas>/gi,
    (_match, attrs: string, body: string) => {
      const cleanAttrs = attrs.trim().replace(/\r?\n/g, ' ');
      return `\n\`\`\`canvas ${cleanAttrs}\n${body.trim()}\n\`\`\`\n`;
    },
  );
  return closedReplaced.replace(
    /<aurvin-canvas([^>]*)>([\s\S]*)$/i,
    (_match, attrs: string, body: string) => {
      const cleanAttrs = attrs.trim().replace(/\r?\n/g, ' ');
      return `\n\`\`\`canvas ${cleanAttrs}\n${body.trim()}`;
    },
  );
}

function extractAttr(info: string, name: string): string | undefined {
  const dq = new RegExp(`${name}\\s*=\\s*"([^"]+)"`, 'i').exec(info);
  if (dq?.[1]) return dq[1].trim();
  const sq = new RegExp(`${name}\\s*=\\s*'([^']+)'`, 'i').exec(info);
  if (sq?.[1]) return sq[1].trim();
  const bare = new RegExp(`${name}\\s*=\\s*([^\\s"']+)`, 'i').exec(info);
  if (bare?.[1]) return bare[1].trim();
  return undefined;
}

function stripFrontmatterAndComments(code: string): { title?: string; body: string } {
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

function detectMermaidMeta(code: string): {
  subType: string;
  buttonLabel: string;
  inferredTitle?: string;
} {
  const { title: fmTitle, body } = stripFrontmatterAndComments(code);
  const titleDirective = /^\s*(?:title|accTitle)\s*:?\s+(.+)$/im.exec(body)?.[1]?.trim().replace(/^["']|["']$/g, '');
  const inferredTitle = fmTitle ?? titleDirective;
  const firstLine = body.split('\n')[0]?.trim() ?? '';

  if (/^pie\b/i.test(firstLine)) {
    const pieInlineTitle = /^pie\s+(?:showData\s+)?title\s+(.+)$/i.exec(firstLine)?.[1]?.trim().replace(/^["']|["']$/g, '');
    return {
      subType: 'Pie Chart',
      buttonLabel: 'View chart',
      inferredTitle: pieInlineTitle || inferredTitle || 'Pie Chart',
    };
  }
  if (/^(?:xychart-beta|quadrantChart)\b/i.test(firstLine)) {
    return {
      subType: 'Coordinate Graph',
      buttonLabel: 'View graph',
      inferredTitle: inferredTitle || 'Coordinate Graph',
    };
  }
  if (/^gantt\b/i.test(firstLine)) {
    return {
      subType: 'Timeline Chart',
      buttonLabel: 'View chart',
      inferredTitle: inferredTitle || 'Timeline Chart',
    };
  }
  if (/^sequenceDiagram\b/i.test(firstLine)) {
    return {
      subType: 'Sequence Diagram',
      buttonLabel: 'View diagram',
      inferredTitle: inferredTitle || 'Sequence Diagram',
    };
  }
  if (/^stateDiagram(?:-v2)?\b/i.test(firstLine)) {
    return {
      subType: 'State Diagram',
      buttonLabel: 'View diagram',
      inferredTitle: inferredTitle || 'State Diagram',
    };
  }
  if (/^classDiagram\b/i.test(firstLine)) {
    return {
      subType: 'Class Diagram',
      buttonLabel: 'View diagram',
      inferredTitle: inferredTitle || 'Class Diagram',
    };
  }
  if (/^erDiagram\b/i.test(firstLine)) {
    return {
      subType: 'ER Diagram',
      buttonLabel: 'View diagram',
      inferredTitle: inferredTitle || 'Entity Relationship Diagram',
    };
  }
  if (/^mindmap\b/i.test(firstLine)) {
    return {
      subType: 'Mindmap',
      buttonLabel: 'View diagram',
      inferredTitle: inferredTitle || 'Mindmap Diagram',
    };
  }
  const subgraphTitle = /^\s*subgraph\s+(?:[A-Za-z0-9_-]+\s*\[\s*["']?([^\]"']+)["']?\s*\]|["']?([^"'\n]+)["']?)/im.exec(body);
  const sgLabel = (subgraphTitle?.[1] ?? subgraphTitle?.[2])?.trim();
  return {
    subType: 'Flowchart',
    buttonLabel: 'View diagram',
    inferredTitle: inferredTitle || sgLabel || 'Flowchart Diagram',
  };
}

function normalizeChartKind(rawType?: string): ChartKind {
  const lower = (rawType ?? '').toLowerCase().trim();
  if (
    lower.includes('scatter') ||
    lower.includes('point') ||
    lower.includes('xy') ||
    lower.includes('plot') ||
    lower.includes('quadrant') ||
    lower.includes('coord')
  ) {
    return 'scatter';
  }
  if (lower.includes('line') || lower.includes('graph') || lower.includes('curve') || lower.includes('function')) {
    return 'line';
  }
  if (lower.includes('area')) return 'area';
  if (lower.includes('pie') || lower.includes('donut') || lower.includes('doughnut')) return 'pie';
  return 'bar';
}

function extractCoordinatePoint(
  entry: unknown,
): (ChartPoint & { series?: string }) | null {
  if (Array.isArray(entry) && entry.length >= 2) {
    const x = Number(entry[0]);
    const y = Number(entry[1]);
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      const label = typeof entry[2] === 'string' ? entry[2].trim() : undefined;
      return { x, y, label };
    }
    return null;
  }
  if (entry && typeof entry === 'object') {
    const rec = entry as Record<string, unknown>;
    if (rec.x !== undefined && rec.y !== undefined) {
      const x = Number(rec.x);
      const y = Number(rec.y);
      if (!Number.isNaN(x) && !Number.isNaN(y)) {
        const rawLabel = rec.label ?? rec.name ?? rec.title ?? rec.text ?? rec.id;
        const rawSeries = rec.series ?? rec.group ?? rec.cluster ?? rec.category;
        return {
          x,
          y,
          label: rawLabel !== undefined ? String(rawLabel).trim() : undefined,
          series: typeof rawSeries === 'string' ? rawSeries.trim() : undefined,
        };
      }
    }
  }
  return null;
}

function groupCoordinatePointsIntoDatasets(
  rawList: unknown[],
  defaultLabel: string,
  showLine?: boolean,
  smooth?: boolean,
): ChartDataset[] {
  const grouped = new Map<string, ChartPoint[]>();
  for (const item of rawList) {
    const pt = extractCoordinatePoint(item);
    if (!pt) continue;
    const key = pt.series || defaultLabel;
    const list = grouped.get(key) ?? [];
    list.push({ x: pt.x, y: pt.y, label: pt.label });
    grouped.set(key, list);
  }
  return Array.from(grouped.entries()).map(([label, points]) => ({
    label,
    data: points.map((p) => p.y),
    points,
    showLine,
    smooth,
  }));
}

export function parseChartSource(
  raw: string,
  fallbackTitle?: string,
  forcedKind?: ChartKind,
): ChartModel | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Try JSON object or array
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown> | Array<unknown>;
      if (Array.isArray(parsed)) {
        const pointDatasets = groupCoordinatePointsIntoDatasets(
          parsed,
          fallbackTitle ?? 'Points',
          forcedKind === 'line',
        );
        if (pointDatasets.length > 0) {
          const allPts = pointDatasets.flatMap((d) => d.points ?? []);
          return {
            type: forcedKind === 'line' ? 'line' : 'scatter',
            title: fallbackTitle,
            labels: allPts.map((p) => p.label ?? `(${p.x}, ${p.y})`),
            datasets: pointDatasets,
          };
        }

        const labels: string[] = [];
        const values: number[] = [];
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            const rec = item as Record<string, unknown>;
            const label = String(rec.label ?? rec.name ?? rec.category ?? rec.x ?? labels.length + 1);
            const val = Number(rec.value ?? rec.y ?? rec.count ?? rec.amount ?? 0);
            if (!Number.isNaN(val)) {
              labels.push(label);
              values.push(val);
            }
          }
        }
        if (labels.length > 0) {
          return {
            type: forcedKind ?? 'bar',
            title: fallbackTitle,
            labels,
            datasets: [{ label: fallbackTitle ?? 'Series 1', data: values }],
          };
        }
      } else if (parsed && typeof parsed === 'object') {
        const rawTypeStr = typeof parsed.type === 'string' ? parsed.type : undefined;
        const kind = forcedKind ?? normalizeChartKind(rawTypeStr);
        const title = (typeof parsed.title === 'string' ? parsed.title : undefined) ?? fallbackTitle;
        const xAxisLabel =
          typeof (parsed.xAxisLabel ?? parsed.xLabel ?? parsed.xAxis) === 'string'
            ? String(parsed.xAxisLabel ?? parsed.xLabel ?? parsed.xAxis)
            : undefined;
        const yAxisLabel =
          typeof (parsed.yAxisLabel ?? parsed.yLabel ?? parsed.yAxis) === 'string'
            ? String(parsed.yAxisLabel ?? parsed.yLabel ?? parsed.yAxis)
            : undefined;
        const xMin = typeof parsed.xMin === 'number' && !Number.isNaN(parsed.xMin) ? parsed.xMin : undefined;
        const xMax = typeof parsed.xMax === 'number' && !Number.isNaN(parsed.xMax) ? parsed.xMax : undefined;
        const yMin = typeof parsed.yMin === 'number' && !Number.isNaN(parsed.yMin) ? parsed.yMin : undefined;
        const yMax = typeof parsed.yMax === 'number' && !Number.isNaN(parsed.yMax) ? parsed.yMax : undefined;
        const topShowLine = typeof parsed.showLine === 'boolean' ? parsed.showLine : undefined;
        const topSmooth = typeof parsed.smooth === 'boolean' ? parsed.smooth : undefined;
        const topXArray = Array.isArray(parsed.x)
          ? (parsed.x as unknown[]).map((v) => Number(v))
          : Array.isArray(parsed.xValues)
            ? (parsed.xValues as unknown[]).map((v) => Number(v))
            : undefined;

        if (Array.isArray(parsed.datasets) && parsed.datasets.length > 0) {
          const labels = Array.isArray(parsed.labels)
            ? parsed.labels.map((l) => String(l))
            : [];
          const numericLabels =
            labels.length > 0 && labels.every((l) => l.trim() !== '' && !Number.isNaN(Number(l)))
              ? labels.map((l) => Number(l))
              : undefined;

          const datasets: ChartDataset[] = [];
          let hasAnyCoordinatePoints = false;

          for (const ds of parsed.datasets as Array<Record<string, unknown>>) {
            if (!ds || typeof ds !== 'object') continue;
            const dsLabel = typeof ds.label === 'string' ? ds.label : `Series ${datasets.length + 1}`;
            const dsColor = typeof ds.color === 'string' ? ds.color : undefined;
            const dsShowLine =
              typeof ds.showLine === 'boolean'
                ? ds.showLine
                : topShowLine ?? (kind === 'line' || kind === 'area' ? true : undefined);
            const dsSmooth = typeof ds.smooth === 'boolean' ? ds.smooth : topSmooth;

            const rawPointsSource = Array.isArray(ds.points)
              ? (ds.points as unknown[])
              : Array.isArray(ds.data) && ds.data.some((item) => extractCoordinatePoint(item) !== null)
                ? (ds.data as unknown[])
                : null;

            if (rawPointsSource) {
              const pts: ChartPoint[] = [];
              for (const entry of rawPointsSource) {
                const pt = extractCoordinatePoint(entry);
                if (pt) pts.push({ x: pt.x, y: pt.y, label: pt.label });
              }
              if (pts.length > 0) {
                hasAnyCoordinatePoints = true;
                datasets.push({
                  label: dsLabel,
                  data: pts.map((p) => p.y),
                  points: pts,
                  color: dsColor,
                  showLine: dsShowLine,
                  smooth: dsSmooth,
                });
                continue;
              }
            }

            if (Array.isArray(ds.data)) {
              const nums = ds.data.map((n) => Number(n)).filter((n) => !Number.isNaN(n));
              const dsX = Array.isArray(ds.x)
                ? (ds.x as unknown[]).map((v) => Number(v))
                : topXArray ?? (kind === 'scatter' ? numericLabels : undefined);

              let points: ChartPoint[] | undefined;
              if (dsX && dsX.length === nums.length && dsX.every((x) => !Number.isNaN(x))) {
                hasAnyCoordinatePoints = true;
                points = nums.map((y, idx) => ({
                  x: dsX[idx]!,
                  y,
                  label: labels[idx] && Number.isNaN(Number(labels[idx])) ? labels[idx] : undefined,
                }));
              } else if (kind === 'scatter' && nums.length > 0) {
                hasAnyCoordinatePoints = true;
                points = nums.map((y, idx) => ({
                  x: idx + 1,
                  y,
                  label: labels[idx],
                }));
              }

              datasets.push({
                label: dsLabel,
                data: nums,
                points,
                color: dsColor,
                showLine: dsShowLine,
                smooth: dsSmooth,
              });
            }
          }

          if (datasets.length > 0) {
            const effectiveType: ChartKind =
              hasAnyCoordinatePoints && !rawTypeStr && !forcedKind ? 'scatter' : kind;
            const maxLen = Math.max(labels.length, ...datasets.map((d) => d.data.length));
            const finalLabels =
              labels.length > 0
                ? labels
                : Array.from({ length: maxLen }, (_, idx) => {
                    const pt = datasets[0]?.points?.[idx];
                    return pt ? pt.label ?? `(${pt.x}, ${pt.y})` : `Item ${idx + 1}`;
                  });
            return {
              type: effectiveType,
              title,
              xAxisLabel,
              yAxisLabel,
              xMin,
              xMax,
              yMin,
              yMax,
              labels: finalLabels,
              datasets,
            };
          }
        }

        // Top-level `points` array
        if (Array.isArray(parsed.points)) {
          const pointDatasets = groupCoordinatePointsIntoDatasets(
            parsed.points as unknown[],
            title ?? 'Points',
            topShowLine ?? (kind === 'line' || kind === 'area'),
            topSmooth,
          );
          if (pointDatasets.length > 0) {
            const allPts = pointDatasets.flatMap((d) => d.points ?? []);
            const effectiveType: ChartKind =
              kind === 'line' || kind === 'area' || topShowLine ? 'line' : 'scatter';
            return {
              type: effectiveType,
              title,
              xAxisLabel,
              yAxisLabel,
              xMin,
              xMax,
              yMin,
              yMax,
              labels: allPts.map((p) => p.label ?? `(${p.x}, ${p.y})`),
              datasets: pointDatasets,
            };
          }
        }

        if (Array.isArray(parsed.data)) {
          const dataArr = parsed.data as unknown[];
          if (dataArr.every((n) => typeof n === 'number' || typeof n === 'string')) {
            const nums = dataArr.map((n) => Number(n)).filter((n) => !Number.isNaN(n));
            const labels = Array.isArray(parsed.labels)
              ? parsed.labels.map((l) => String(l))
              : nums.map((_, i) => `Item ${i + 1}`);
            if (nums.length > 0) {
              const points =
                topXArray && topXArray.length === nums.length && topXArray.every((x) => !Number.isNaN(x))
                  ? nums.map((y, idx) => ({ x: topXArray[idx]!, y, label: labels[idx] }))
                  : kind === 'scatter'
                    ? nums.map((y, idx) => ({
                        x: !Number.isNaN(Number(labels[idx])) ? Number(labels[idx]) : idx + 1,
                        y,
                        label: Number.isNaN(Number(labels[idx])) ? labels[idx] : undefined,
                      }))
                    : undefined;
              return {
                type: points && !rawTypeStr && !forcedKind ? 'scatter' : kind,
                title,
                xAxisLabel,
                yAxisLabel,
                xMin,
                xMax,
                yMin,
                yMax,
                labels,
                datasets: [
                  {
                    label: title ?? 'Values',
                    data: nums,
                    points,
                    showLine: topShowLine ?? (kind === 'line' || kind === 'area'),
                    smooth: topSmooth,
                  },
                ],
              };
            }
          } else {
            // Check if `data` array entries are `{ x, y }` coordinate points
            const pointDatasets = groupCoordinatePointsIntoDatasets(
              dataArr,
              title ?? 'Points',
              topShowLine ?? (kind === 'line' || kind === 'area'),
              topSmooth,
            );
            if (pointDatasets.length > 0 && (kind === 'scatter' || kind === 'line' || !rawTypeStr)) {
              const allPts = pointDatasets.flatMap((d) => d.points ?? []);
              const effectiveType: ChartKind =
                rawTypeStr ? kind : forcedKind ?? (topShowLine ? 'line' : 'scatter');
              return {
                type: effectiveType,
                title,
                xAxisLabel,
                yAxisLabel,
                xMin,
                xMax,
                yMin,
                yMax,
                labels: allPts.map((p) => p.label ?? `(${p.x}, ${p.y})`),
                datasets: pointDatasets,
              };
            }

            const labels: string[] = [];
            const nums: number[] = [];
            for (const entry of dataArr) {
              if (entry && typeof entry === 'object') {
                const rec = entry as Record<string, unknown>;
                const lbl = String(rec.label ?? rec.name ?? rec.category ?? rec.x ?? labels.length + 1);
                const val = Number(rec.value ?? rec.y ?? rec.count ?? 0);
                if (!Number.isNaN(val)) {
                  labels.push(lbl);
                  nums.push(val);
                }
              }
            }
            if (labels.length > 0) {
              return {
                type: kind,
                title,
                xAxisLabel,
                yAxisLabel,
                xMin,
                xMax,
                yMin,
                yMax,
                labels,
                datasets: [{ label: title ?? 'Values', data: nums }],
              };
            }
          }
        }
      }
    } catch {
      // Fall through to line-oriented chart formats
    }
  }

  // 2. Try Mermaid pie / xychart-beta / quadrantChart syntax
  const { title: fmTitle, body } = stripFrontmatterAndComments(trimmed);
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? '';

  if (/^pie\b/i.test(first)) {
    let title = fmTitle ?? fallbackTitle;
    const inlineTitle = /^pie\s+(?:showData\s+)?title\s+(.+)$/i.exec(first)?.[1];
    if (inlineTitle) title = inlineTitle.trim().replace(/^["']|["']$/g, '');
    const labels: string[] = [];
    const values: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const tMatch = /^title\s+(.+)$/i.exec(line);
      if (tMatch?.[1]) {
        title = tMatch[1].trim().replace(/^["']|["']$/g, '');
        continue;
      }
      const entryMatch = /^["']?([^"':]+)["']?\s*:\s*(-?\d+(?:\.\d+)?)$/.exec(line);
      if (entryMatch?.[1] && entryMatch[2]) {
        labels.push(entryMatch[1].trim());
        values.push(Number(entryMatch[2]));
      }
    }
    if (labels.length > 0) {
      return {
        type: 'pie',
        title,
        labels,
        datasets: [{ label: title ?? 'Share', data: values }],
      };
    }
  }

  if (/^quadrantChart\b/i.test(first)) {
    let title = fmTitle ?? fallbackTitle;
    let xAxisLabel: string | undefined;
    let yAxisLabel: string | undefined;
    const quadrantLabels: [string?, string?, string?, string?] = [];
    const points: ChartPoint[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const tMatch = /^title\s+(.+)$/i.exec(line);
      if (tMatch?.[1]) {
        title = tMatch[1].trim().replace(/^["']|["']$/g, '');
        continue;
      }
      const xMatch = /^x-axis\s+(.+)$/i.exec(line);
      if (xMatch?.[1]) {
        xAxisLabel = xMatch[1].replace(/\s*-->\s*/g, ' → ').replace(/["']/g, '').trim();
        continue;
      }
      const yMatch = /^y-axis\s+(.+)$/i.exec(line);
      if (yMatch?.[1]) {
        yAxisLabel = yMatch[1].replace(/\s*-->\s*/g, ' → ').replace(/["']/g, '').trim();
        continue;
      }
      const qMatch = /^quadrant-([1-4])\s+(.+)$/i.exec(line);
      if (qMatch?.[1] && qMatch[2]) {
        const qIdx = Number(qMatch[1]) - 1;
        quadrantLabels[qIdx] = qMatch[2].trim().replace(/^["']|["']$/g, '');
        continue;
      }
      const ptMatch = /^["']?([^"':]+)["']?\s*:\s*[[(]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*[\])]$/.exec(line);
      if (ptMatch?.[1] && ptMatch[2] && ptMatch[3]) {
        points.push({
          label: ptMatch[1].trim(),
          x: Number(ptMatch[2]),
          y: Number(ptMatch[3]),
        });
      }
    }

    if (points.length > 0) {
      return {
        type: 'scatter',
        title,
        xAxisLabel,
        yAxisLabel,
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
        quadrantLabels,
        labels: points.map((p) => p.label ?? `(${p.x}, ${p.y})`),
        datasets: [{ label: title ?? 'Points', data: points.map((p) => p.y), points }],
      };
    }
  }

  if (/^xychart-beta\b/i.test(first)) {
    let title = fmTitle ?? fallbackTitle;
    let xAxisLabel: string | undefined;
    let yAxisLabel: string | undefined;
    let labels: string[] = [];
    const datasets: ChartDataset[] = [];
    let chartType: ChartKind = forcedKind ?? 'bar';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const tMatch = /^title\s+(.+)$/i.exec(line);
      if (tMatch?.[1]) {
        title = tMatch[1].trim().replace(/^["']|["']$/g, '');
        continue;
      }
      const xMatch = /^x-axis\s+(?:["']([^"']*)["']\s*)?(?:\[([^\]]+)\]|(-?\d+(?:\.\d+)?)\s*-->\s*(-?\d+(?:\.\d+)?))?/i.exec(line);
      if (xMatch) {
        if (xMatch[1]) xAxisLabel = xMatch[1].trim();
        if (xMatch[2]) {
          labels = xMatch[2]
            .split(',')
            .map((item) => item.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
        }
        continue;
      }
      const yMatch = /^y-axis\s+(?:["']([^"']*)["'])?/i.exec(line);
      if (yMatch?.[1]) {
        yAxisLabel = yMatch[1].trim();
        continue;
      }
      const seriesMatch = /^(bar|line|scatter|point)\s+(?:["']([^"']+)["']\s+)?\[([^\]]+)\]/i.exec(line);
      if (seriesMatch?.[1] && seriesMatch[3]) {
        const sKind = seriesMatch[1].toLowerCase();
        if ((sKind === 'line' || sKind === 'scatter' || sKind === 'point') && datasets.length === 0) {
          chartType = sKind === 'line' ? 'line' : 'scatter';
        }
        const data = seriesMatch[3]
          .split(',')
          .map((v) => Number(v.trim()))
          .filter((n) => !Number.isNaN(n));
        const numericX =
          labels.length === data.length && labels.every((l) => !Number.isNaN(Number(l)))
            ? labels.map((l) => Number(l))
            : undefined;
        datasets.push({
          label: seriesMatch[2]?.trim() || (sKind === 'line' ? 'Trend' : 'Values'),
          data,
          points: numericX
            ? data.map((y, idx) => ({ x: numericX[idx]!, y }))
            : chartType === 'scatter'
              ? data.map((y, idx) => ({ x: idx + 1, y, label: labels[idx] }))
              : undefined,
          showLine: sKind === 'line',
        });
      }
    }

    if (datasets.length > 0) {
      const maxLen = Math.max(labels.length, ...datasets.map((d) => d.data.length));
      if (labels.length === 0) {
        labels = Array.from({ length: maxLen }, (_, idx) => `${idx + 1}`);
      }
      return { type: chartType, title, xAxisLabel, yAxisLabel, labels, datasets };
    }
  }

  // 3. Try coordinate pairs `(x, y)` or simple "Label: 123" lines
  let lineTitle = fmTitle ?? fallbackTitle;
  let inferredKind: ChartKind = forcedKind ?? 'bar';
  let xAxisLabel: string | undefined;
  let yAxisLabel: string | undefined;
  let showLine: boolean | undefined;
  let smooth: boolean | undefined;
  const kvLabels: string[] = [];
  const kvValues: number[] = [];
  const coordPoints: ChartPoint[] = [];

  for (const line of lines) {
    const typeLine = /^type\s*:\s*(bar|line|area|pie|donut|scatter|point|xy|plot|graph)$/i.exec(line);
    if (typeLine?.[1]) {
      inferredKind = normalizeChartKind(typeLine[1]);
      if (/^(?:line|graph)$/i.test(typeLine[1])) showLine = true;
      continue;
    }
    const titleLine = /^title\s*:\s*(.+)$/i.exec(line);
    if (titleLine?.[1]) {
      lineTitle = titleLine[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }
    const xAxisLine = /^(?:x-axis|xAxisLabel|xLabel)\s*:\s*(.+)$/i.exec(line);
    if (xAxisLine?.[1]) {
      xAxisLabel = xAxisLine[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }
    const yAxisLine = /^(?:y-axis|yAxisLabel|yLabel)\s*:\s*(.+)$/i.exec(line);
    if (yAxisLine?.[1]) {
      yAxisLabel = yAxisLine[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }
    const connectLine = /^(?:connect|showLine|line)\s*:\s*(true|false)$/i.exec(line);
    if (connectLine?.[1]) {
      showLine = connectLine[1].toLowerCase() === 'true';
      continue;
    }
    const smoothLine = /^smooth\s*:\s*(true|false)$/i.exec(line);
    if (smoothLine?.[1]) {
      smooth = smoothLine[1].toLowerCase() === 'true';
      continue;
    }

    // Match `Label: (x, y)` or `Label: [x, y]`
    const labeledCoord =
      /^["']?([^"':()[\]]+)["']?\s*:\s*[[(]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*[\])]$/.exec(
        line,
      );
    if (labeledCoord?.[1] && labeledCoord[2] && labeledCoord[3]) {
      coordPoints.push({
        label: labeledCoord[1].trim(),
        x: Number(labeledCoord[2]),
        y: Number(labeledCoord[3]),
      });
      continue;
    }

    // Match `(x, y)` or `(x, y) Label` or `[x, y] Label`
    const bareCoord =
      /^[[(]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*[\])](?:\s*[:,-]?\s*(.+))?$/.exec(
        line,
      );
    if (bareCoord?.[1] && bareCoord[2]) {
      coordPoints.push({
        x: Number(bareCoord[1]),
        y: Number(bareCoord[2]),
        label: bareCoord[3]?.trim().replace(/^["']|["']$/g, ''),
      });
      continue;
    }

    const kv = /^["']?([^"':,|]+)["']?\s*[:|,]\s*(-?\d+(?:\.\d+)?)\s*%?$/.exec(line);
    if (kv?.[1] && kv[2]) {
      kvLabels.push(kv[1].trim());
      kvValues.push(Number(kv[2]));
    }
  }

  if (coordPoints.length > 0) {
    const finalType: ChartKind =
      forcedKind === 'line' || inferredKind === 'line' || showLine ? 'line' : 'scatter';
    return {
      type: finalType,
      title: lineTitle,
      xAxisLabel,
      yAxisLabel,
      labels: coordPoints.map((p) => p.label ?? `(${p.x}, ${p.y})`),
      datasets: [
        {
          label: lineTitle ?? 'Points',
          data: coordPoints.map((p) => p.y),
          points: coordPoints,
          showLine: showLine ?? finalType === 'line',
          smooth,
        },
      ],
    };
  }

  if (kvLabels.length > 0) {
    const allNumericX = kvLabels.every((l) => !Number.isNaN(Number(l)));
    const points =
      allNumericX && (inferredKind === 'line' || inferredKind === 'scatter')
        ? kvValues.map((y, idx) => ({ x: Number(kvLabels[idx]), y }))
        : undefined;
    return {
      type: inferredKind,
      title: lineTitle,
      xAxisLabel,
      yAxisLabel,
      labels: kvLabels,
      datasets: [
        {
          label: lineTitle ?? 'Values',
          data: kvValues,
          points,
          showLine: showLine ?? (inferredKind === 'line' || inferredKind === 'area'),
          smooth,
        },
      ],
    };
  }

  return null;
}

const SAFE_CALENDAR_HOSTS = new Set(['calendar.google.com', 'www.google.com', 'google.com']);

export function resolveSafeCalendarLink(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();
  if (/^(?:javascript|data|file|vbscript):/i.test(trimmed)) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    if (!SAFE_CALENDAR_HOSTS.has(parsed.hostname)) return null;
    if (!parsed.pathname.startsWith('/calendar')) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function parseCalendarSource(
  raw: string,
  fallbackTitle?: string,
): CalendarEventModel | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const rawSummary =
          parsed.summary ?? parsed.title ?? parsed.name ?? parsed.event ?? fallbackTitle;
        const summary =
          typeof rawSummary === 'string' && rawSummary.trim().length > 0
            ? rawSummary.trim()
            : fallbackTitle ?? 'Calendar Event';
        const start =
          typeof parsed.start === 'string' || (parsed.start && typeof parsed.start === 'object')
            ? (parsed.start as string | CalendarEventDateTime)
            : undefined;
        const end =
          typeof parsed.end === 'string' || (parsed.end && typeof parsed.end === 'object')
            ? (parsed.end as string | CalendarEventDateTime)
            : undefined;
        const timeZone =
          typeof parsed.timeZone === 'string'
            ? parsed.timeZone
            : typeof parsed.timezone === 'string'
              ? parsed.timezone
              : typeof parsed.start === 'object' && parsed.start && 'timeZone' in parsed.start
                ? String((parsed.start as Record<string, unknown>).timeZone)
                : undefined;
        const calendarLabel =
          typeof parsed.calendarLabel === 'string'
            ? parsed.calendarLabel
            : typeof parsed.calendar === 'string'
              ? parsed.calendar
              : typeof parsed.calendarName === 'string'
                ? parsed.calendarName
                : null;
        const htmlLink =
          typeof parsed.htmlLink === 'string'
            ? parsed.htmlLink
            : typeof parsed.link === 'string'
              ? parsed.link
              : typeof parsed.url === 'string'
                ? parsed.url
                : null;
        const status = typeof parsed.status === 'string' ? parsed.status : 'confirmed';
        const location = typeof parsed.location === 'string' ? parsed.location : null;
        const description = typeof parsed.description === 'string' ? parsed.description : null;
        const eventId =
          typeof parsed.eventId === 'string'
            ? parsed.eventId
            : typeof parsed.id === 'string'
              ? parsed.id
              : null;

        return {
          ...parsed,
          summary: summary || 'Calendar Event',
          start,
          end,
          timeZone,
          calendarLabel,
          htmlLink,
          status,
          location,
          description,
          eventId,
        };
      }
    } catch {
      // Fall through to line-based parsing
    }
  }

  const lines = trimmed.split('\n');
  const record: Record<string, string> = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && value) {
        record[key] = value;
      }
    }
  }

  if (Object.keys(record).length > 0) {
    const summary =
      record.summary || record.title || record.name || record.event || fallbackTitle || 'Calendar Event';
    return {
      summary,
      start: record.start || record.date || record.starttime || record.datetime,
      end: record.end || record.endtime,
      timeZone: record.timezone || record.tz,
      calendarLabel: record.calendarlabel || record.calendar || record.target || null,
      htmlLink: record.htmllink || record.link || record.url || null,
      status: record.status || 'confirmed',
      location: record.location || record.where || null,
      description: record.description || record.details || record.notes || null,
      eventId: record.eventid || record.id || null,
    };
  }

  return {
    summary: fallbackTitle || 'Calendar Event',
    status: 'confirmed',
  };
}

const CREATED_EVENT =
  /Created "([^"]+)" from (\S+) to (\S+) \(([^)]+)\)/;
const CONFIRM_EVENT =
  /(?:Please confirm:\s*)?create "([^"]+)" on \S+ from (\S+) to (\S+) \(([^)]+)\)/i;
const SCHEDULE_EVENT =
  /I can schedule "([^"]+)" on \S+ from (\S+) to (\S+) \(([^)]+)\)/i;

function fieldsFromCalendarNarration(text: string): Partial<CalendarEventModel> | null {
  const match = CREATED_EVENT.exec(text) ?? CONFIRM_EVENT.exec(text) ?? SCHEDULE_EVENT.exec(text);
  if (!match) return null;
  return { summary: match[1], start: match[2], end: match[3], timeZone: match[4] };
}

function extractCalendarEventFields(
  messages: readonly VisibleMessage[],
  userContent?: string,
  assistantContent?: string,
): Partial<CalendarEventModel> {
  const fromTurn =
    (assistantContent ? fieldsFromCalendarNarration(assistantContent) : null) ??
    (userContent ? fieldsFromCalendarNarration(userContent) : null);
  if (fromTurn) return fromTurn;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const parsed = fieldsFromCalendarNarration(messages[index]!.content);
    if (parsed) return parsed;
  }
  const summary = extractEventSummaryFromMessages(userContent, assistantContent);
  return summary ? { summary } : {};
}

function extractEventSummaryFromMessages(
  userContent?: string,
  assistantContent?: string,
): string | null {
  if (assistantContent) {
    const quoteMatch = /(?:scheduled|created|added|booked|event)\s+["'“]([^"'“”]+)["'”]/i.exec(assistantContent);
    if (quoteMatch?.[1]) return quoteMatch[1].trim();
    const boldMatch = /(?:scheduled|created|added|booked|event)\s+\*\*([^*]+)\*\*/i.exec(assistantContent);
    if (boldMatch?.[1]) return boldMatch[1].trim();
    const forMatch = /(?:scheduled|created|added|booked)\s+([A-Za-z0-9\s&'-]+?)(?:\s+(?:for|on|at|\.)|$)/i.exec(assistantContent);
    if (forMatch?.[1] && forMatch[1].trim().length > 2 && forMatch[1].trim().length < 50) {
      return forMatch[1].trim();
    }
  }
  if (userContent) {
    const titledQuote = /titled\s+["'“]([^"'“”]+)["'”]/i.exec(userContent);
    if (titledQuote?.[1]) return titledQuote[1].trim();
    const quoteMatch = /["'“]([^"'“”]+)["'”]/i.exec(userContent);
    if (quoteMatch?.[1]) return quoteMatch[1].trim();
    const titledBare = /titled\s+([^,.\n]+?)(?:\s+(?:on|at|tomorrow|next|for|\.)|$)/i.exec(userContent);
    if (titledBare?.[1] && titledBare[1].trim().length > 2) return titledBare[1].trim();
  }
  return null;
}

export function parseCanvasCodeBlock(
  lang: string,
  code: string,
  messageId: string,
  index: number,
  isStreaming = false,
): CanvasArtifact | null {
  const info = lang.trim();
  const firstToken = (info.split(/\s+/)[0] ?? '').toLowerCase();
  const explicitTitle = extractAttr(info, 'title');
  const explicitType = extractAttr(info, 'type')?.toLowerCase();

  let kind: CanvasArtifactKind | null = null;
  let forcedChartKind: ChartKind | undefined;

  if (firstToken === 'mermaid' || firstToken === 'mmd') {
    kind = 'mermaid';
  } else if (
    firstToken === 'chart' ||
    firstToken === 'graph' ||
    firstToken === 'plot' ||
    firstToken === 'scatter' ||
    firstToken === 'xy' ||
    firstToken === 'xy-plot' ||
    firstToken === 'line-graph' ||
    firstToken === 'bar-chart' ||
    firstToken === 'line-chart' ||
    firstToken === 'pie-chart' ||
    firstToken === 'area-chart'
  ) {
    kind = 'chart';
    if (firstToken === 'plot' || firstToken === 'scatter' || firstToken === 'xy' || firstToken === 'xy-plot') {
      forcedChartKind = 'scatter';
    } else if (firstToken !== 'chart' && firstToken !== 'graph') {
      forcedChartKind = normalizeChartKind(firstToken);
    } else if (firstToken === 'graph' && explicitType) {
      forcedChartKind = normalizeChartKind(explicitType);
    } else if (firstToken === 'graph') {
      // Allow JSON `type: "scatter"` inside ```graph blocks, otherwise default to line graph
      const parsedKind = /"type"\s*:\s*"([^"]+)"/i.exec(code)?.[1];
      forcedChartKind = parsedKind ? normalizeChartKind(parsedKind) : 'line';
    }
  } else if (firstToken === 'svg') {
    kind = 'svg';
  } else if (firstToken === 'calendar' || firstToken === 'event') {
    kind = 'calendar';
  } else if (firstToken === 'canvas') {
    if (explicitType === 'mermaid' || explicitType === 'diagram' || explicitType === 'flowchart') {
      kind = 'mermaid';
    } else if (explicitType === 'calendar' || explicitType === 'event') {
      kind = 'calendar';
    } else if (
      explicitType === 'chart' ||
      explicitType === 'graph' ||
      explicitType === 'plot' ||
      explicitType === 'scatter' ||
      explicitType === 'xy' ||
      explicitType === 'bar' ||
      explicitType === 'line' ||
      explicitType === 'pie' ||
      explicitType === 'area'
    ) {
      kind = 'chart';
      forcedChartKind = normalizeChartKind(explicitType);
    } else if (explicitType === 'svg') {
      kind = 'svg';
    } else if (MERMAID_HEADER_RE.test(code.trim())) {
      kind = 'mermaid';
    } else if (code.trim().startsWith('<svg')) {
      kind = 'svg';
    } else {
      kind = 'chart';
    }
  } else if (firstToken === 'json') {
    const trimmed = code.trim();
    if (
      trimmed.startsWith('{') &&
      /"type"\s*:\s*"(?:bar|line|area|pie|donut|scatter|point|xy|plot|graph)"/i.test(trimmed) &&
      (/"datasets"\s*:/i.test(trimmed) || /"data"\s*:/i.test(trimmed) || /"points"\s*:/i.test(trimmed))
    ) {
      kind = 'chart';
    } else if (
      trimmed.startsWith('{') &&
      (/"summary"\s*:/i.test(trimmed) || /"calendarLabel"\s*:/i.test(trimmed) || /"calendarId"\s*:/i.test(trimmed)) &&
      (/"start"\s*:/i.test(trimmed) || /"htmlLink"\s*:/i.test(trimmed) || /"eventId"\s*:/i.test(trimmed))
    ) {
      kind = 'calendar';
    }
  } else if (firstToken === '' && MERMAID_HEADER_RE.test(code.trim())) {
    kind = 'mermaid';
  }

  if (!kind) {
    return null;
  }

  const trailingPlainTitle =
    !explicitTitle &&
    !info.includes('=') &&
    info.length > firstToken.length
      ? info.slice(firstToken.length).trim().replace(/^["']|["']$/g, '')
      : undefined;

  const artifactId = `${messageId}::canvas::${index}`;

  if (kind === 'mermaid') {
    const meta = detectMermaidMeta(code);
    return {
      artifactId,
      messageId,
      index,
      kind: 'mermaid',
      subType: meta.subType,
      title: explicitTitle || trailingPlainTitle || meta.inferredTitle || 'Mermaid Diagram',
      buttonLabel: meta.buttonLabel,
      rawSource: code,
      isStreaming,
    };
  }

  if (kind === 'chart') {
    const chartModel = parseChartSource(code, explicitTitle ?? trailingPlainTitle, forcedChartKind);
    const chartKind = chartModel?.type ?? forcedChartKind ?? 'bar';
    const hasXYPoints = Boolean(chartModel?.datasets.some((d) => d.points && d.points.length > 0));
    const subType =
      chartKind === 'scatter'
        ? chartModel?.datasets.some((d) => d.showLine)
          ? 'Coordinate Graph'
          : 'X-Y Point Plot'
        : chartKind === 'line'
          ? hasXYPoints
            ? 'Coordinate Graph'
            : 'Line Graph'
          : chartKind === 'area'
            ? 'Area Graph'
            : chartKind === 'pie'
              ? 'Pie Chart'
              : 'Bar Chart';
    const buttonLabel =
      chartKind === 'line' || chartKind === 'area' || chartKind === 'scatter'
        ? 'View graph'
        : 'View chart';
    const title =
      explicitTitle ||
      trailingPlainTitle ||
      chartModel?.title ||
      subType;

    return {
      artifactId,
      messageId,
      index,
      kind: 'chart',
      subType,
      title,
      buttonLabel,
      rawSource: code,
      isStreaming,
    };
  }

  if (kind === 'calendar') {
    const calendarModel = parseCalendarSource(code, explicitTitle ?? trailingPlainTitle);
    const title =
      explicitTitle ||
      trailingPlainTitle ||
      calendarModel?.summary ||
      'Calendar Event';
    const subType = calendarModel?.calendarLabel || 'Google Calendar Event';

    return {
      artifactId,
      messageId,
      index,
      kind: 'calendar',
      subType,
      title,
      buttonLabel: 'View calendar event',
      rawSource: code,
      isStreaming,
    };
  }

  // SVG kind
  const svgTitleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(code);
  const svgAriaMatch = /aria-label\s*=\s*["']([^"']+)["']/i.exec(code);
  return {
    artifactId,
    messageId,
    index,
    kind: 'svg',
    subType: 'SVG Visual',
    title:
      explicitTitle ||
      trailingPlainTitle ||
      svgTitleMatch?.[1]?.trim() ||
      svgAriaMatch?.[1]?.trim() ||
      'Visual Diagram',
    buttonLabel: 'View diagram',
    rawSource: code,
    isStreaming,
  };
}

export function extractMessageCanvasArtifacts(
  content: string,
  messageId: string,
  isStreaming = false,
): CanvasArtifact[] {
  return prepareCanvasMarkdown(content, messageId, isStreaming).artifacts;
}

type PreparedCanvasMarkdown = {
  tokens: ReturnType<typeof parseMarkdown>;
  tokenArtifacts: Array<CanvasArtifact | null>;
  artifacts: CanvasArtifact[];
};

// ponytail: shared render/extraction cache holds at most 32 parses / 256 Ki chars
// across raw and normalized text. Open constructs still reparse their entire tail;
// use a stateful tokenizer only if that remaining cost is measured to matter.
// Oversized messages bypass caching; use view-owned parsed models if that becomes common.
const preparedMarkdown = new Map<string, {
  content: string;
  markdown: string;
  stableChars: number;
  stableTokenCount: number;
  parsed: PreparedCanvasMarkdown;
}>();
const MAX_PREPARED_CHARS = 256 * 1024;
let preparedChars = 0;

export function prepareCanvasMarkdown(
  content: string,
  messageId: string,
  isStreaming = false,
): PreparedCanvasMarkdown {
  const key = JSON.stringify([messageId, isStreaming]);
  const cached = preparedMarkdown.get(key);
  if (cached) {
    preparedMarkdown.delete(key);
    preparedChars -= cached.content.length + cached.markdown.length;
    if (cached.content === content) {
      preparedMarkdown.set(key, cached);
      preparedChars += content.length + cached.markdown.length;
      return cached.parsed;
    }
  }
  const markdown = preprocessCanvasTags(content).replace(/\r\n/g, '\n');
  // Canvas normalization may rewrite an earlier open tag when its close arrives.
  // Validate the retained prefix instead of assuming raw append-only input.
  const reuse = cached && markdown.startsWith(cached.markdown.slice(0, cached.stableChars));
  const prefixChars = reuse ? cached.stableChars : 0;
  const prefixTokens = reuse ? cached.stableTokenCount : 0;
  let stableChars = prefixChars;
  let stableTokenCount = prefixTokens;
  const tail = parseMarkdown(markdown.slice(prefixChars), (chars, count) => {
    stableChars += chars;
    stableTokenCount += count;
  });
  const tokens = [...(reuse ? cached.parsed.tokens.slice(0, prefixTokens) : []), ...tail];
  const tokenArtifacts: Array<CanvasArtifact | null> = [];
  const artifacts: CanvasArtifact[] = [];
  let canvasIndex = 0;

  for (const [tokenIndex, token] of tokens.entries()) {
    let artifact: CanvasArtifact | null = null;
    if (token.type === 'code_block') {
      artifact = tokenIndex < prefixTokens ? cached!.parsed.tokenArtifacts[tokenIndex]! : parseCanvasCodeBlock(
        token.lang,
        token.code,
        messageId,
        canvasIndex,
        isStreaming,
      );
      if (artifact) {
        artifacts.push(artifact);
        canvasIndex += 1;
      }
    }
    tokenArtifacts.push(artifact);
  }
  const parsed = { tokens, tokenArtifacts, artifacts };
  const chars = content.length + markdown.length;
  if (chars <= MAX_PREPARED_CHARS) {
    preparedMarkdown.set(key, { content, markdown, stableChars, stableTokenCount, parsed });
    preparedChars += chars;
    while (preparedMarkdown.size > 32 || preparedChars > MAX_PREPARED_CHARS) {
      const oldestKey = preparedMarkdown.keys().next().value!;
      const oldest = preparedMarkdown.get(oldestKey)!;
      preparedChars -= oldest.content.length + oldest.markdown.length;
      preparedMarkdown.delete(oldestKey);
    }
  }
  return parsed;
}

export const CANVAS_TRANSITION_MS = 320;
export type CanvasPanelTransitionState = 'open' | 'exiting';

const EXPLICIT_CHART_TYPE_RE =
  /"type"\s*:\s*"(bar|line|area|pie|donut|scatter|point|xy|plot|graph)"|(?:^|\n)\s*type\s*:\s*(bar|line|area|pie|donut|scatter|point|xy|plot|graph)\b/i;

const SAFE_DRAWABLE_SVG_CHILD_RE =
  /<(?:g|path|rect|circle|ellipse|line|polyline|polygon|text|tspan|use)\b/i;

export function forcedChartKindFromSubType(
  subType: string,
  rawSource: string,
): ChartKind | undefined {
  if (EXPLICIT_CHART_TYPE_RE.test(rawSource)) {
    return undefined;
  }
  const lower = subType.trim().toLowerCase();
  if (lower === 'line graph' || lower === 'coordinate graph') return 'line';
  if (lower === 'area graph') return 'area';
  if (lower === 'pie chart') return 'pie';
  if (lower === 'x-y point plot' || lower.includes('scatter') || lower.includes('plot')) {
    return 'scatter';
  }
  if (lower === 'bar chart') return 'bar';
  return undefined;
}

export function buttonLabelForCanvasArtifact(
  kind: CanvasArtifactKind,
  subType: string,
): string {
  if (kind === 'calendar') return 'View calendar event';
  const lower = subType.trim().toLowerCase();
  if (kind === 'svg') return 'View diagram';
  if (kind === 'mermaid') {
    if (lower === 'pie chart' || lower === 'timeline chart') return 'View chart';
    if (lower === 'coordinate graph') return 'View graph';
    return 'View diagram';
  }
  if (
    lower.includes('graph') ||
    lower.includes('line') ||
    lower.includes('area') ||
    lower.includes('plot') ||
    lower.includes('scatter') ||
    lower.includes('x-y')
  ) {
    return 'View graph';
  }
  return 'View chart';
}

function isRenderableProjectionSource(projection: CanvasArtifactProjection): boolean {
  const trimmed = projection.rawSource.trim();
  if (!trimmed) return false;
  if (projection.kind === 'mermaid') {
    if (!MERMAID_HEADER_RE.test(trimmed)) return false;
    const parsed = parseMermaidSource(trimmed, projection.title);
    if (parsed.kind === 'chart') return parsed.chart.datasets.length > 0;
    if (parsed.kind === 'sequence') {
      return parsed.participants.length > 0 || parsed.items.length > 0;
    }
    return parsed.nodes.length > 0 || parsed.edges.length > 0;
  }
  if (projection.kind === 'chart') {
    const forced = forcedChartKindFromSubType(projection.subType, trimmed);
    const model = parseChartSource(trimmed, projection.title, forced);
    return Boolean(model && model.datasets.length > 0);
  }
  if (projection.kind === 'calendar') {
    const model = parseCalendarSource(trimmed, projection.title);
    return Boolean(model && (model.summary || model.htmlLink || model.eventId));
  }
  const cleaned = trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .trim();
  if (!/^<svg\b[^>]*>[\s\S]*<\/svg>$/i.test(cleaned)) {
    return false;
  }
  return SAFE_DRAWABLE_SVG_CHILD_RE.test(cleaned);
}

export function projectionToCanvasArtifact(
  projection: CanvasArtifactProjection,
  ownerMessageId?: string,
): CanvasArtifact | null {
  try {
    if (!isCanvasArtifactProjection(projection)) return null;
    if (!isRenderableProjectionSource(projection)) return null;
    return {
      artifactId: `${projection.responseId}::canvas::${projection.ordinal}`,
      messageId: ownerMessageId ?? projection.responseId,
      index: projection.ordinal,
      kind: projection.kind,
      subType: projection.subType,
      title: projection.title,
      buttonLabel: buttonLabelForCanvasArtifact(projection.kind, projection.subType),
      rawSource: projection.rawSource,
      isStreaming: false,
    };
  } catch {
    return null;
  }
}

export function extractVoiceMessageCanvasArtifacts(message: VisibleMessage): CanvasArtifact[] {
  if (
    message.role !== 'assistant' ||
    !Object.hasOwn(message, 'canvasArtifacts') ||
    message.canvasArtifacts === undefined
  ) {
    return [];
  }
  if (!isVisibleMessageCanvasArtifacts(message)) {
    return [];
  }
  const result: CanvasArtifact[] = [];
  for (const projection of message.canvasArtifacts) {
    const artifact = projectionToCanvasArtifact(projection, message.messageId);
    if (artifact) {
      result.push(artifact);
    }
  }
  return result;
}

const archivedArtifacts = new WeakMap<
  VisibleMessage,
  {
    content: string;
    messageId: string;
    canvasArtifacts: VisibleMessage['canvasArtifacts'];
    calendarView: VisibleMessage['calendarView'];
    items: CanvasArtifact[];
  }
>();

export function collectSessionCanvasArtifacts(
  messages: readonly VisibleMessage[],
  streamText: string,
  isStreaming: boolean,
  calendarOperations?: Record<string, CalendarTurnState>,
  messageArtifacts?: readonly CanvasArtifact[],
): CanvasArtifact[] {
  const result: CanvasArtifact[] = [];
  const seen = new Set<string>();
  const pushUnique = (items: readonly CanvasArtifact[]) => {
    for (const item of items) {
      if (!seen.has(item.artifactId)) {
        seen.add(item.artifactId);
        result.push(item);
      }
    }
  };

  if (messageArtifacts) pushUnique(messageArtifacts);
  for (const msg of messageArtifacts ? [] : messages) {
    if (msg.role === 'assistant' && (msg.content || msg.canvasArtifacts !== undefined || msg.calendarView !== undefined)) {
      let cached = archivedArtifacts.get(msg);
      if (
        !cached ||
        cached.content !== msg.content ||
        cached.messageId !== msg.messageId ||
        cached.canvasArtifacts !== msg.canvasArtifacts ||
        cached.calendarView !== msg.calendarView
      ) {
        const textItems = msg.content
          ? extractMessageCanvasArtifacts(msg.content, msg.messageId, false)
          : [];
        const voiceItems = extractVoiceMessageCanvasArtifacts(msg);
        const calendarItem = msg.calendarView && isCalendarView(msg.calendarView)
          ? calendarViewArtifact(msg.calendarView, msg.messageId, msg.turnId) : null;
        // Typed data supersedes calendar fences in that same message, not unrelated diagrams.
        const items = [...textItems, ...voiceItems].filter(a => !calendarItem || a.kind !== 'calendar')
          .map(a => a.kind === 'calendar' ? { ...a, turnId: msg.turnId } : a);
        if (calendarItem) items.push(calendarItem);
        cached = {
          content: msg.content,
          messageId: msg.messageId,
          canvasArtifacts: msg.canvasArtifacts,
          calendarView: msg.calendarView,
          items,
        };
        archivedArtifacts.set(msg, cached);
      }
      pushUnique(cached.items);
    }
  }
  if (isStreaming && streamText) {
    pushUnique(extractMessageCanvasArtifacts(streamText, 'streaming_in_flight', true));
  }
  if (calendarOperations) {
    for (const [turnId, operation] of Object.entries(calendarOperations)) {
      if (
        operation &&
        operation.state === 'succeeded' &&
        operation.receipt !== null &&
        operation.receipt.durable === true
      ) {
        const turnArtifactId = `${turnId}::canvas::calendar`;
        const hasExisting = result.some(
          (a) =>
            a.artifactId === turnArtifactId ||
            (a.kind === 'calendar' &&
              messages.some((m) => m.turnId === turnId && m.messageId === a.messageId)),
        );
        if (!hasExisting) {
          const assistantMsg = messages.find((m) => m.turnId === turnId && m.role === 'assistant');
          const userMsg = messages.find((m) => m.turnId === turnId && m.role === 'user');
          const extracted = extractCalendarEventFields(messages, userMsg?.content, assistantMsg?.content);
          const summary =
            extracted.summary ||
            ('calendarLabel' in operation.receipt && operation.receipt.calendarLabel
              ? `${operation.receipt.calendarLabel} Event`
              : 'Google Calendar Event');

          const calendarModel: CalendarEventModel = {
            summary,
            start: extracted.start,
            end: extracted.end,
            timeZone: extracted.timeZone,
            eventId: operation.receipt.eventId,
            htmlLink: operation.receipt.htmlLink,
            calendarLabel: 'calendarLabel' in operation.receipt ? operation.receipt.calendarLabel : null,
            status: 'confirmed',
          };

          const artifact: CanvasArtifact = {
            artifactId: turnArtifactId,
            messageId: assistantMsg?.messageId ?? turnId,
            turnId,
            index: 0,
            kind: 'calendar',
            subType: calendarModel.calendarLabel || 'Google Calendar Event',
            title: summary,
            buttonLabel: 'View calendar event',
            rawSource: JSON.stringify(calendarModel, null, 2),
            isStreaming: false,
          };
          pushUnique([artifact]);
        }
      }
    }
  }
  return result;
}

export function mergeSessionCanvasArtifacts(
  archived: readonly CanvasArtifact[],
  liveProjections: readonly CanvasArtifactProjection[],
  calendarOperations?: Record<string, CalendarTurnState>,
): CanvasArtifact[] {
  const merged = [...archived];
  const seen = new Set(archived.map((item) => item.artifactId));
  for (const projection of liveProjections) {
    const artifact = projectionToCanvasArtifact(projection, projection.responseId);
    if (artifact && !seen.has(artifact.artifactId)) {
      seen.add(artifact.artifactId);
      merged.push(artifact);
    }
  }
  if (calendarOperations) {
    for (const [turnId, operation] of Object.entries(calendarOperations)) {
      if (
        operation &&
        operation.state === 'succeeded' &&
        operation.receipt !== null &&
        operation.receipt.durable === true
      ) {
        const turnArtifactId = `${turnId}::canvas::calendar`;
        const hasExisting = merged.some(
          (a) => a.artifactId === turnArtifactId || a.artifactId.startsWith(`${turnId}::`) || a.turnId === turnId,
        );
        if (!hasExisting) {
          const calendarLabel =
            'calendarLabel' in operation.receipt ? operation.receipt.calendarLabel : null;
          const summary = calendarLabel ? `${calendarLabel} Event` : 'Google Calendar Event';
          const calendarModel: CalendarEventModel = {
            summary,
            eventId: operation.receipt.eventId,
            htmlLink: operation.receipt.htmlLink,
            calendarLabel,
            status: 'confirmed',
          };
          const artifact: CanvasArtifact = {
            artifactId: turnArtifactId,
            messageId: turnId,
            turnId,
            index: 0,
            kind: 'calendar',
            subType: calendarLabel || 'Google Calendar Event',
            title: summary,
            buttonLabel: 'View calendar event',
            rawSource: JSON.stringify(calendarModel, null, 2),
            isStreaming: false,
          };
          seen.add(turnArtifactId);
          merged.push(artifact);
        }
      }
    }
  }
  return merged;
}

export function claimNewAutoOpenArtifactId(
  liveProjections: readonly CanvasArtifactProjection[],
  seenArtifactIds: Set<string>,
): string | null {
  let newestUnseenId: string | null = null;
  for (const projection of liveProjections) {
    const artifact = projectionToCanvasArtifact(projection, projection.responseId);
    if (artifact && !seenArtifactIds.has(artifact.artifactId)) {
      seenArtifactIds.add(artifact.artifactId);
      newestUnseenId = artifact.artifactId;
    }
  }
  return newestUnseenId;
}

export function prefersReducedCanvasMotion(
  win: { matchMedia?: (query: string) => { matches: boolean } } | undefined =
    typeof window !== 'undefined' ? window : undefined,
): boolean {
  return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

export type CanvasCloseFocusTargets = {
  liveActive: boolean;
  liveCanvasToggle?: HTMLElement | null;
  liveSurface?: HTMLElement | null;
  headerCanvasToggle?: HTMLElement | null;
  composer?: HTMLElement | null;
};

export function resolveCanvasCloseFocusTarget(
  targets: CanvasCloseFocusTargets,
): HTMLElement | null {
  if (targets.liveActive) {
    return targets.liveCanvasToggle ?? targets.liveSurface ?? null;
  }
  return targets.headerCanvasToggle ?? targets.composer ?? null;
}

export function restoreCanvasCloseFocus(
  targets: CanvasCloseFocusTargets,
): HTMLElement | null {
  const target = resolveCanvasCloseFocusTarget(targets);
  target?.focus({ preventScroll: true });
  return target;
}

export type CanvasShortcutKeyEvent = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
};

export function handleLiveCanvasShortcut(
  event: CanvasShortcutKeyEvent,
  canvas?: { artifactCount: number; onToggle: () => void },
): boolean {
  const target = event.target as Element | null;
  if (
    !canvas ||
    canvas.artifactCount <= 0 ||
    event.repeat ||
    event.defaultPrevented ||
    event.isComposing ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.key.toLowerCase() !== 'c' ||
    target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  ) {
    return false;
  }
  event.preventDefault();
  canvas.onToggle();
  return true;
}

function parseNodeToken(
  rawToken: string,
): { id: string; label?: string; shape?: MermaidNodeShape } {
  const trimmed = rawToken.trim();
  if (trimmed === '[*]') {
    return { id: '__start_or_end__', label: '', shape: 'state-start' };
  }

  // Match id + shape bracket
  const match = /^([A-Za-z0-9_.-]+)\s*(.*)$/s.exec(trimmed);
  if (!match?.[1]) {
    return { id: trimmed.replace(/\s+/g, '_') || 'node', label: trimmed };
  }
  const id = match[1];
  const rest = (match[2] ?? '').trim();
  if (!rest) {
    return { id };
  }

  const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '').replace(/<br\s*\/?>/gi, ' ');

  if (rest.startsWith('((') && rest.endsWith('))')) {
    return { id, label: unquote(rest.slice(2, -2)), shape: 'circle' };
  }
  if (rest.startsWith('([') && rest.endsWith('])')) {
    return { id, label: unquote(rest.slice(2, -2)), shape: 'stadium' };
  }
  if (rest.startsWith('[(') && rest.endsWith(')]')) {
    return { id, label: unquote(rest.slice(2, -2)), shape: 'cylinder' };
  }
  if (rest.startsWith('[[') && rest.endsWith(']]')) {
    return { id, label: unquote(rest.slice(2, -2)), shape: 'subroutine' };
  }
  if (rest.startsWith('{') && rest.endsWith('}')) {
    const inner = rest.startsWith('{{') && rest.endsWith('}}') ? rest.slice(2, -2) : rest.slice(1, -1);
    return { id, label: unquote(inner), shape: 'diamond' };
  }
  if (rest.startsWith('(') && rest.endsWith(')')) {
    return { id, label: unquote(rest.slice(1, -1)), shape: 'rounded' };
  }
  if ((rest.startsWith('[') || rest.startsWith('>') ) && rest.endsWith(']')) {
    return { id, label: unquote(rest.slice(1, -1)), shape: 'rect' };
  }
  return { id, label: unquote(rest) };
}

function parseSequenceDiagram(body: string, fallbackTitle?: string): MermaidSequenceModel {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  let title = fallbackTitle;
  const participants = new Map<string, string>();
  const items: MermaidSequenceModel['items'] = [];

  const ensureParticipant = (id: string, label?: string) => {
    const cleanId = id.trim();
    if (!cleanId) return;
    if (!participants.has(cleanId) || label) {
      participants.set(cleanId, (label ?? cleanId).replace(/^["']|["']$/g, ''));
    }
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (
      /^(?:autonumber|activate|deactivate|loop|alt|else|opt|par|rect|end)\b/i.test(line)
    ) {
      continue;
    }
    const titleMatch = /^title\s*:?\s+(.+)$/i.exec(line);
    if (titleMatch?.[1]) {
      title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }
    const partMatch = /^(?:participant|actor)\s+([^\s]+)(?:\s+as\s+(.+))?$/i.exec(line);
    if (partMatch?.[1]) {
      ensureParticipant(partMatch[1], partMatch[2]);
      continue;
    }
    const noteMatch = /^Note\s+(?:left of|right of|over)\s+([^:]+):\s*(.+)$/i.exec(line);
    if (noteMatch?.[1] && noteMatch[2]) {
      const overIds = noteMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
      for (const id of overIds) ensureParticipant(id);
      items.push({ itemType: 'note', overIds, text: noteMatch[2].trim() });
      continue;
    }
    const msgMatch =
      /^([A-Za-z0-9_.-]+)\s*(--?>>|--?>|--?[x)])[+-]?\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(
        line,
      );
    if (msgMatch?.[1] && msgMatch[2] && msgMatch[3]) {
      const from = msgMatch[1].trim();
      const arrow = msgMatch[2];
      const to = msgMatch[3].trim();
      const text = (msgMatch[4] ?? '').trim();
      ensureParticipant(from);
      ensureParticipant(to);
      items.push({
        itemType: 'message',
        from,
        to,
        text,
        dashed: arrow.startsWith('--'),
      });
    }
  }

  return {
    kind: 'sequence',
    title,
    participants: Array.from(participants.entries()).map(([id, label]) => ({ id, label })),
    items,
  };
}

export function parseMermaidSource(raw: string, fallbackTitle?: string): MermaidParsedModel {
  const { title: fmTitle, body } = stripFrontmatterAndComments(raw);
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const firstLine = lines[0] ?? '';

  if (/^(?:pie|xychart-beta|quadrantChart)\b/i.test(firstLine)) {
    const chart = parseChartSource(raw, fmTitle ?? fallbackTitle);
    if (chart) {
      return { kind: 'chart', chart };
    }
  }

  if (/^sequenceDiagram\b/i.test(firstLine)) {
    return parseSequenceDiagram(body, fmTitle ?? fallbackTitle);
  }

  // Flowchart / Graph / StateDiagram / ClassDiagram / ERDiagram
  let direction: MermaidFlowDirection = 'TD';
  const dirMatch = /^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i.exec(firstLine);
  if (dirMatch?.[1]) {
    direction = dirMatch[1].toUpperCase() as MermaidFlowDirection;
  }

  let title = fmTitle ?? fallbackTitle;
  const nodeMap = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  const subgraphs: MermaidSubgraph[] = [];
  let activeSubgraph: MermaidSubgraph | null = null;
  let startCount = 0;
  let endCount = 0;

  const upsertNode = (token: string, isTarget = false): string => {
    const parsed = parseNodeToken(token);
    if (parsed.id === '__start_or_end__') {
      const specialId = isTarget ? `__end_${++endCount}` : `__start_${++startCount}`;
      nodeMap.set(specialId, {
        id: specialId,
        label: '',
        shape: isTarget ? 'state-end' : 'state-start',
        subgraphId: activeSubgraph?.id,
      });
      if (activeSubgraph && !activeSubgraph.nodeIds.includes(specialId)) {
        activeSubgraph.nodeIds.push(specialId);
      }
      return specialId;
    }

    const existing = nodeMap.get(parsed.id);
    const owningSubgraphId = existing?.subgraphId ?? activeSubgraph?.id;
    const merged: MermaidNode = {
      id: parsed.id,
      label: parsed.label ?? existing?.label ?? parsed.id,
      shape: parsed.shape ?? existing?.shape ?? 'rounded',
      subgraphId: owningSubgraphId,
    };
    nodeMap.set(parsed.id, merged);
    if (
      activeSubgraph &&
      owningSubgraphId === activeSubgraph.id &&
      !activeSubgraph.nodeIds.includes(parsed.id)
    ) {
      activeSubgraph.nodeIds.push(parsed.id);
    }
    return parsed.id;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const line = rawLine.replace(/;\s*$/, '').trim();
    if (!line) continue;

    if (
      i === 0 &&
      /^(?:flowchart|graph|stateDiagram(?:-v2)?|classDiagram|erDiagram|mindmap|gantt)\b/i.test(line)
    ) {
      continue;
    }

    if (/^(?:classDef|class|style|linkStyle|click|direction)\b/i.test(line)) {
      const dirOverride = /^direction\s+(TD|TB|BT|LR|RL)\b/i.exec(line);
      if (dirOverride?.[1]) {
        direction = dirOverride[1].toUpperCase() as MermaidFlowDirection;
      }
      continue;
    }

    const titleDirective = /^(?:title|accTitle)\s*:?\s+(.+)$/i.exec(line);
    if (titleDirective?.[1]) {
      title = titleDirective[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }

    const sgMatch = /^subgraph\s+(.+)$/i.exec(line);
    if (sgMatch?.[1]) {
      const spec = sgMatch[1].trim();
      const bracketMatch = /^([A-Za-z0-9_.-]+)\s*\[\s*["']?([^\]"']+)["']?\s*\]$/.exec(spec);
      const sgId = bracketMatch?.[1] ?? `sg_${subgraphs.length + 1}`;
      const sgTitle = (bracketMatch?.[2] ?? spec).replace(/^["']|["']$/g, '').trim();
      const sg: MermaidSubgraph = { id: sgId, title: sgTitle, nodeIds: [] };
      subgraphs.push(sg);
      activeSubgraph = sg;
      continue;
    }

    if (/^end\b/i.test(line)) {
      activeSubgraph = null;
      continue;
    }

    // State diagram description: `StateId : State Label`
    const stateDescMatch = /^([A-Za-z0-9_.-]+)\s*:\s*([^>-].*)$/.exec(line);
    if (stateDescMatch?.[1] && stateDescMatch[2] && !line.includes('-->') && !line.includes('---')) {
      const id = stateDescMatch[1].trim();
      const desc = stateDescMatch[2].trim().replace(/^["']|["']$/g, '');
      const existing = nodeMap.get(id);
      const owningSubgraphId = existing?.subgraphId ?? activeSubgraph?.id;
      nodeMap.set(id, {
        id,
        label: existing && existing.label !== id ? `${existing.label} — ${desc}` : desc,
        shape: existing?.shape ?? 'rounded',
        subgraphId: owningSubgraphId,
      });
      if (
        activeSubgraph &&
        owningSubgraphId === activeSubgraph.id &&
        !activeSubgraph.nodeIds.includes(id)
      ) {
        activeSubgraph.nodeIds.push(id);
      }
      continue;
    }

    // Parse edges on this line (supports chained edges `A --> B --> C` and labels)
    const edgePattern =
      /\s+(?:--\s*([^>-][^-\n]*?)\s*-->|-\.\s*([^.\n]+?)\s*\.->|==\s*([^=\n]+?)\s*==>|(-->|-\.->|-.-|==>|<-->|---|<\|--|--\|>|\*--|o--|\.\.\|>|<\|\.\.|\|\|--o\{|\}o--\|\||\|\|--\|\{|\}\|--\|\|)\s*(?:\|([^|]*)\|)?)\s+/g;

    const segments: string[] = [];
    const connectors: Array<{ style: MermaidEdgeStyle; label?: string }> = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = edgePattern.exec(line)) !== null) {
      segments.push(line.slice(lastIdx, match.index));
      const inlineSolidLabel = match[1]?.trim();
      const inlineDashedLabel = match[2]?.trim();
      const inlineThickLabel = match[3]?.trim();
      const operator = match[4] ?? '-->';
      const pipeLabel = match[5]?.trim();

      let style: MermaidEdgeStyle = 'solid';
      if (inlineDashedLabel || operator === '-.->' || operator === '-.-' || operator.includes('..')) {
        style = 'dashed';
      } else if (inlineThickLabel || operator === '==>') {
        style = 'thick';
      } else if (operator === '---') {
        style = 'open';
      }

      connectors.push({
        style,
        label: inlineSolidLabel ?? inlineDashedLabel ?? inlineThickLabel ?? pipeLabel,
      });
      lastIdx = edgePattern.lastIndex;
    }

    if (connectors.length > 0) {
      let tail = line.slice(lastIdx).trim();
      // Support stateDiagram/ER/class trailing `: Transition label` on the final target
      let trailingEdgeLabel: string | undefined;
      const colonIdx = tail.indexOf(':');
      if (colonIdx > 0 && !tail.slice(0, colonIdx).includes('[') && !tail.slice(0, colonIdx).includes('(')) {
        trailingEdgeLabel = tail.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        tail = tail.slice(0, colonIdx).trim();
      }
      segments.push(tail);

      for (let c = 0; c < connectors.length; c++) {
        const leftRaw = segments[c] ?? '';
        const rightRaw = segments[c + 1] ?? '';
        const conn = connectors[c]!;
        const leftParts = leftRaw.split('&').map((s) => s.trim()).filter(Boolean);
        const rightParts = rightRaw.split('&').map((s) => s.trim()).filter(Boolean);
        const fromIds = leftParts.map((part) => upsertNode(part, false));
        const toIds = rightParts.map((part) => upsertNode(part, true));
        const label =
          c === connectors.length - 1 && trailingEdgeLabel
            ? conn.label ?? trailingEdgeLabel
            : conn.label;

        for (const from of fromIds) {
          for (const to of toIds) {
            edges.push({ from, to, style: conn.style, label });
          }
        }
      }
      continue;
    }

    // Standalone node declaration
    if (/^[A-Za-z0-9_.-]+\s*[[({]/.test(line)) {
      upsertNode(line, false);
    }
  }

  return {
    kind: 'flowchart',
    title,
    direction,
    nodes: Array.from(nodeMap.values()),
    edges,
    subgraphs,
  };
}

export function computeWheelZoomView(
  prev: { zoom: number; panX: number; panY: number },
  deltaY: number,
  offsetX = 0,
  offsetY = 0,
  minZoom = 25,
  maxZoom = 300,
): { zoom: number; panX: number; panY: number } {
  if (deltaY === 0) return prev;
  const step = Math.abs(deltaY) < 40 ? 10 : 15;
  const delta = deltaY < 0 ? step : -step;
  const nextZoom = Math.min(maxZoom, Math.max(minZoom, prev.zoom + delta));
  if (nextZoom === prev.zoom) return prev;
  const ratio = nextZoom / prev.zoom;
  return {
    zoom: nextZoom,
    panX: Math.round(Number((offsetX - (offsetX - prev.panX) * ratio).toFixed(6))),
    panY: Math.round(Number((offsetY - (offsetY - prev.panY) * ratio).toFixed(6))),
  };
}

