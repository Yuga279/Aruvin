/**
 * ============================================================================
 * FILE: chart-renderer.tsx
 * LOCATION: frontend/src/features/canvas/renderers/chart-renderer.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Pure React SVG renderer for 2D X-Y coordinate graphs, scatter plots,
 *    line/area graphs, bar charts, and pie charts.
 *
 * ROLE IN PROJECT:
 *    Renders ChartModel data into crisp, accessible SVG graphics inside
 *    Aurvin's Canvas without external charting libraries or innerHTML injection.
 *
 * KEY COMPONENTS:
 *    - renderXYCoordinateGraph: Plots (x, y) points on continuous X and Y axes.
 *    - renderCartesianChart: Bar, line, and area charts with axes and gridlines.
 *    - renderPieChart: Donut/pie slices, center summary, and color legend.
 *    - ChartRenderer: Entry component selecting the chart visualization.
 * ============================================================================
 */

import { parseChartSource } from '../canvas-artifacts.ts';
import type { ChartModel, ChartPoint } from '../canvas-types.ts';

const CHART_PALETTE = [
  '#38bdf8', // Sky Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#14b8a6', // Teal
  '#eab308', // Yellow
  '#fb923c', // Orange
  '#60a5fa', // Blue
];

function formatNumber(n: number): string {
  if (Math.abs(n) < 1e-9) return '0';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (Number.isInteger(n)) return String(n);
  return Number(n.toFixed(2)).toString();
}

function computeNiceScale(
  rawMin: number,
  rawMax: number,
  targetTicks = 6,
  explicitMin?: number,
  explicitMax?: number,
): { min: number; max: number; ticks: number[] } {
  let lo = explicitMin ?? rawMin;
  let hi = explicitMax ?? rawMax;

  if (lo === hi) {
    const delta = Math.abs(lo) * 0.25 || 1;
    lo -= delta;
    hi += delta;
  } else if (explicitMin === undefined && explicitMax === undefined) {
    const span = hi - lo;
    // Include 0 naturally when data is close to origin or all positive/negative within reasonable ratio
    if (lo > 0 && lo / span < 0.35) lo = 0;
    if (hi < 0 && Math.abs(hi) / span < 0.35) hi = 0;
  }

  const range = Math.max(1e-6, hi - lo);
  const roughStep = range / Math.max(2, targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / mag;
  const niceStep =
    residual <= 1
      ? 1 * mag
      : residual <= 2
        ? 2 * mag
        : residual <= 2.5
          ? 2.5 * mag
          : residual <= 5
            ? 5 * mag
            : 10 * mag;

  const min = explicitMin !== undefined ? explicitMin : Math.floor(lo / niceStep) * niceStep;
  const max = explicitMax !== undefined ? explicitMax : Math.ceil(hi / niceStep) * niceStep;

  const ticks: number[] = [];
  const count = Math.min(12, Math.max(2, Math.round((max - min) / niceStep)));
  for (let i = 0; i <= count; i++) {
    const val = Number((min + i * niceStep).toFixed(6));
    if (val <= max + 1e-9) {
      ticks.push(val);
    }
  }
  return { min, max: ticks[ticks.length - 1] ?? max, ticks };
}

function buildSmoothCurvePath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
  if (pts.length === 2) {
    return `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)} L ${pts[1]!.x.toFixed(2)} ${pts[1]!.y.toFixed(2)}`;
  }
  const parts: string[] = [`M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    parts.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    );
  }
  return parts.join(' ');
}

function polarToCartesian(cx: number, cy: number, r: number, angleInDegrees: number) {
  const rad = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeDonutSector(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const clampedSpan = Math.min(359.99, Math.max(0.01, endAngle - startAngle));
  const actualEnd = startAngle + clampedSpan;
  const largeArc = clampedSpan > 180 ? 1 : 0;

  const outerStart = polarToCartesian(cx, cy, outerR, actualEnd);
  const outerEnd = polarToCartesian(cx, cy, outerR, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, actualEnd);

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function renderPieChart(model: ChartModel) {
  const series = model.datasets[0]?.data ?? [];
  const items = model.labels.map((label, i) => ({
    label,
    value: Math.max(0, series[i] ?? 0),
    color: CHART_PALETTE[i % CHART_PALETTE.length]!,
  }));
  const total = items.reduce((acc, item) => acc + item.value, 0) || 1;

  const width = 680;
  const height = Math.max(380, 120 + items.length * 36);
  const cx = 210;
  const cy = height / 2 + 10;
  const outerR = 128;
  const innerR = 68;

  let currentAngle = 0;

  return (
    <svg
      className="aurvin-canvas-svg aurvin-canvas-chart-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={model.title ?? 'Pie chart'}
    >
      {model.title ? (
        <text
          x={width / 2}
          y={34}
          textAnchor="middle"
          className="aurvin-canvas-svg-title"
        >
          {model.title}
        </text>
      ) : null}

      <g className="aurvin-canvas-pie-slices">
        {items.map((item, idx) => {
          const sliceAngle = (item.value / total) * 360;
          const start = currentAngle;
          const end = currentAngle + sliceAngle;
          currentAngle = end;
          const pathData = describeDonutSector(cx, cy, outerR, innerR, start, end);
          return (
            <path
              key={`slice-${idx}`}
              d={pathData}
              fill={item.color}
              stroke="var(--aurvin-canvas-bg, #111214)"
              strokeWidth="2.5"
            />
          );
        })}
      </g>

      <text x={cx} y={cy - 4} textAnchor="middle" className="aurvin-canvas-pie-total-value">
        {formatNumber(items.reduce((acc, item) => acc + item.value, 0))}
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" className="aurvin-canvas-pie-total-label">
        Total
      </text>

      <g className="aurvin-canvas-legend" transform={`translate(390, ${Math.max(76, cy - (items.length * 32) / 2)})`}>
        {items.map((item, idx) => {
          const pct = ((item.value / total) * 100).toFixed(1).replace(/\.0$/, '');
          return (
            <g key={`leg-${idx}`} transform={`translate(0, ${idx * 32})`}>
              <rect x={0} y={-11} width={14} height={14} rx={4} fill={item.color} />
              <text x={24} y={0} className="aurvin-canvas-legend-label">
                {item.label}
              </text>
              <text x={245} y={0} textAnchor="end" className="aurvin-canvas-legend-value">
                {formatNumber(item.value)} ({pct}%)
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function renderXYCoordinateGraph(model: ChartModel) {
  const width = 760;
  const height = 480;
  const padTop = model.title ? 68 : 42;
  const padRight = 46;
  const padBottom = model.datasets.length > 1 ? 96 : 74;
  const padLeft = 78;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const normalizedDatasets = model.datasets.map((ds) => {
    const pts: ChartPoint[] =
      ds.points && ds.points.length > 0
        ? ds.points
        : ds.data.map((y, idx) => {
            const parsedX = Number(model.labels[idx]);
            return {
              x: !Number.isNaN(parsedX) ? parsedX : idx + 1,
              y,
              label: Number.isNaN(parsedX) ? model.labels[idx] : undefined,
            };
          });
    return { ...ds, resolvedPoints: pts };
  });

  const allPoints = normalizedDatasets.flatMap((ds) => ds.resolvedPoints);
  const rawXMin = allPoints.length > 0 ? Math.min(...allPoints.map((p) => p.x)) : 0;
  const rawXMax = allPoints.length > 0 ? Math.max(...allPoints.map((p) => p.x)) : 10;
  const rawYMin = allPoints.length > 0 ? Math.min(...allPoints.map((p) => p.y)) : 0;
  const rawYMax = allPoints.length > 0 ? Math.max(...allPoints.map((p) => p.y)) : 10;

  const xScale = computeNiceScale(rawXMin, rawXMax, 6, model.xMin, model.xMax);
  const yScale = computeNiceScale(rawYMin, rawYMax, 6, model.yMin, model.yMax);

  const xRange = xScale.max - xScale.min || 1;
  const yRange = yScale.max - yScale.min || 1;

  const toPixelX = (x: number) => padLeft + ((x - xScale.min) / xRange) * plotW;
  const toPixelY = (y: number) => padTop + plotH - ((y - yScale.min) / yRange) * plotH;

  const hasZeroX = xScale.min <= 0 && xScale.max >= 0;
  const hasZeroY = yScale.min <= 0 && yScale.max >= 0;
  const originX = hasZeroX ? toPixelX(0) : padLeft;
  const originY = hasZeroY ? toPixelY(0) : padTop + plotH;

  const xAxisTitle = model.xAxisLabel ?? 'X Axis';
  const yAxisTitle = model.yAxisLabel ?? 'Y Axis';

  // Track placed label boxes so point labels don't collide
  const placedLabels: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  return (
    <svg
      className="aurvin-canvas-svg aurvin-canvas-chart-svg aurvin-canvas-xy-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={model.title ?? 'X-Y coordinate graph'}
    >
      <defs>
        <marker
          id="aurvin-axis-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="var(--aurvin-canvas-edge, #a1a1aa)" />
        </marker>
      </defs>

      {model.title ? (
        <text x={width / 2} y={34} textAnchor="middle" className="aurvin-canvas-svg-title">
          {model.title}
        </text>
      ) : null}

      {/* Plot area background & frame */}
      <rect
        x={padLeft}
        y={padTop}
        width={plotW}
        height={plotH}
        rx={4}
        className="aurvin-canvas-plot-frame"
      />

      {/* Vertical X-gridlines and tick labels */}
      <g className="aurvin-canvas-grid aurvin-canvas-x-grid">
        {xScale.ticks.map((tickVal, idx) => {
          const px = toPixelX(tickVal);
          return (
            <g key={`xtick-${idx}`}>
              <line
                x1={px}
                y1={padTop}
                x2={px}
                y2={padTop + plotH}
                className="aurvin-canvas-grid-line"
              />
              <line
                x1={px}
                y1={padTop + plotH}
                x2={px}
                y2={padTop + plotH + 5}
                className="aurvin-canvas-axis-spine"
              />
              <text
                x={px}
                y={padTop + plotH + 20}
                textAnchor="middle"
                className="aurvin-canvas-axis-tick"
              >
                {formatNumber(tickVal)}
              </text>
            </g>
          );
        })}
      </g>

      {/* Horizontal Y-gridlines and tick labels */}
      <g className="aurvin-canvas-grid aurvin-canvas-y-grid">
        {yScale.ticks.map((tickVal, idx) => {
          const py = toPixelY(tickVal);
          return (
            <g key={`ytick-${idx}`}>
              <line
                x1={padLeft}
                y1={py}
                x2={padLeft + plotW}
                y2={py}
                className="aurvin-canvas-grid-line"
              />
              <line
                x1={padLeft - 5}
                y1={py}
                x2={padLeft}
                y2={py}
                className="aurvin-canvas-axis-spine"
              />
              <text
                x={padLeft - 10}
                y={py + 4}
                textAnchor="end"
                className="aurvin-canvas-axis-tick"
              >
                {formatNumber(tickVal)}
              </text>
            </g>
          );
        })}
      </g>

      {/* Quadrant labels if present */}
      {model.quadrantLabels && model.quadrantLabels.some(Boolean) ? (
        <g className="aurvin-canvas-quadrants">
          <line
            x1={padLeft + plotW / 2}
            y1={padTop}
            x2={padLeft + plotW / 2}
            y2={padTop + plotH}
            className="aurvin-canvas-axis-origin"
            strokeDasharray="6 4"
          />
          <line
            x1={padLeft}
            y1={padTop + plotH / 2}
            x2={padLeft + plotW}
            y2={padTop + plotH / 2}
            className="aurvin-canvas-axis-origin"
            strokeDasharray="6 4"
          />
          {model.quadrantLabels[0] ? (
            <text
              x={padLeft + plotW - 14}
              y={padTop + 22}
              textAnchor="end"
              className="aurvin-canvas-quadrant-label"
            >
              {model.quadrantLabels[0]}
            </text>
          ) : null}
          {model.quadrantLabels[1] ? (
            <text
              x={padLeft + 14}
              y={padTop + 22}
              textAnchor="start"
              className="aurvin-canvas-quadrant-label"
            >
              {model.quadrantLabels[1]}
            </text>
          ) : null}
          {model.quadrantLabels[2] ? (
            <text
              x={padLeft + 14}
              y={padTop + plotH - 12}
              textAnchor="start"
              className="aurvin-canvas-quadrant-label"
            >
              {model.quadrantLabels[2]}
            </text>
          ) : null}
          {model.quadrantLabels[3] ? (
            <text
              x={padLeft + plotW - 14}
              y={padTop + plotH - 12}
              textAnchor="end"
              className="aurvin-canvas-quadrant-label"
            >
              {model.quadrantLabels[3]}
            </text>
          ) : null}
        </g>
      ) : null}

      {/* Origin X=0 and Y=0 Axes */}
      <g className="aurvin-canvas-axes">
        <line
          x1={padLeft}
          y1={originY}
          x2={padLeft + plotW + 8}
          y2={originY}
          className="aurvin-canvas-axis-origin"
          markerEnd="url(#aurvin-axis-arrow)"
        />
        <line
          x1={originX}
          y1={padTop + plotH}
          x2={originX}
          y2={padTop - 8}
          className="aurvin-canvas-axis-origin"
          markerEnd="url(#aurvin-axis-arrow)"
        />
      </g>

      {/* X and Y Axis Titles */}
      <text
        x={padLeft + plotW / 2}
        y={padTop + plotH + 46}
        textAnchor="middle"
        className="aurvin-canvas-axis-title"
      >
        {xAxisTitle}
      </text>
      <text
        x={22}
        y={padTop + plotH / 2}
        textAnchor="middle"
        transform={`rotate(-90 22 ${padTop + plotH / 2})`}
        className="aurvin-canvas-axis-title"
      >
        {yAxisTitle}
      </text>

      {/* Connected Lines / Curves and Plotted Coordinate Points */}
      <g className="aurvin-canvas-xy-series">
        {normalizedDatasets.map((ds, dsIdx) => {
          const color = ds.color ?? CHART_PALETTE[dsIdx % CHART_PALETTE.length]!;
          const mappedPoints = ds.resolvedPoints.map((pt) => ({
            ...pt,
            px: toPixelX(pt.x),
            py: toPixelY(pt.y),
          }));

          const shouldConnect =
            ds.showLine ?? (model.type === 'line' || model.type === 'area');

          const linePoints = shouldConnect ? mappedPoints : [];
          const pathData =
            linePoints.length > 1
              ? ds.smooth
                ? buildSmoothCurvePath(linePoints.map((p) => ({ x: p.px, y: p.py })))
                : linePoints
                    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.px.toFixed(2)} ${p.py.toFixed(2)}`)
                    .join(' ')
              : '';

          return (
            <g key={`xy-ds-${dsIdx}`} className="aurvin-canvas-xy-dataset">
              {pathData ? (
                <path
                  d={pathData}
                  fill="none"
                  stroke={color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}

              {mappedPoints.map((pt, pIdx) => {
                const coordText = `(${formatNumber(pt.x)}, ${formatNumber(pt.y)})`;
                const displayText = pt.label
                  ? pt.label.includes('(')
                    ? pt.label
                    : allPoints.length <= 10
                      ? `${pt.label} ${coordText}`
                      : pt.label
                  : allPoints.length <= 16
                    ? coordText
                    : '';

                // Choose non-overlapping label offset around point
                let labelEl = null;
                if (displayText) {
                  const truncated =
                    displayText.length > 34 ? `${displayText.slice(0, 32)}…` : displayText;
                  const boxW = Math.max(40, truncated.length * 6.4 + 12);
                  const boxH = 19;

                  const candidates = [
                    { dx: 0, dy: -16, anchor: 'middle' as const },
                    { dx: 10 + boxW / 2, dy: 4, anchor: 'middle' as const },
                    { dx: 0, dy: 22, anchor: 'middle' as const },
                    { dx: -(10 + boxW / 2), dy: 4, anchor: 'middle' as const },
                  ];

                  let chosen = candidates[0]!;
                  for (const cand of candidates) {
                    const cx = pt.px + cand.dx;
                    const cy = pt.py + cand.dy;
                    const x1 = cx - boxW / 2;
                    const x2 = cx + boxW / 2;
                    const y1 = cy - 13;
                    const y2 = cy + 6;
                    const insidePlot =
                      x1 >= padLeft - 10 &&
                      x2 <= padLeft + plotW + 20 &&
                      y1 >= padTop - 12 &&
                      y2 <= padTop + plotH + 10;
                    const overlaps = placedLabels.some(
                      (b) => !(x2 < b.x1 || x1 > b.x2 || y2 < b.y1 || y1 > b.y2),
                    );
                    if (insidePlot && !overlaps) {
                      chosen = cand;
                      placedLabels.push({ x1, y1, x2, y2 });
                      break;
                    }
                  }

                  const lx = pt.px + chosen.dx;
                  const ly = pt.py + chosen.dy;
                  labelEl = (
                    <g className="aurvin-canvas-point-label-group">
                      <rect
                        x={lx - boxW / 2}
                        y={ly - 13}
                        width={boxW}
                        height={boxH}
                        rx={4}
                        className="aurvin-canvas-point-label-bg"
                      />
                      <text
                        x={lx}
                        y={ly}
                        textAnchor="middle"
                        className="aurvin-canvas-data-label"
                      >
                        {truncated}
                      </text>
                    </g>
                  );
                }

                return (
                  <g
                    key={`xy-pt-${dsIdx}-${pIdx}`}
                    className="aurvin-canvas-xy-point"
                    data-point-x={pt.x}
                    data-point-y={pt.y}
                  >
                    <circle
                      cx={pt.px}
                      cy={pt.py}
                      r={8}
                      fill={color}
                      fillOpacity={0.18}
                    />
                    <circle
                      cx={pt.px}
                      cy={pt.py}
                      r={4.5}
                      fill={color}
                      stroke="var(--aurvin-canvas-bg, #111214)"
                      strokeWidth="1.8"
                    />
                    {labelEl}
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>

      {/* Legend when multiple datasets exist */}
      {normalizedDatasets.length > 1 ? (
        <g
          className="aurvin-canvas-legend"
          transform={`translate(${width / 2 - (normalizedDatasets.length * 130) / 2}, ${height - 20})`}
        >
          {normalizedDatasets.map((ds, dsIdx) => {
            const color = ds.color ?? CHART_PALETTE[dsIdx % CHART_PALETTE.length]!;
            return (
              <g key={`xyleg-${dsIdx}`} transform={`translate(${dsIdx * 140}, 0)`}>
                <circle cx={6} cy={-4} r={5} fill={color} />
                <text x={16} y={0} className="aurvin-canvas-legend-label">
                  {ds.label}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}
    </svg>
  );
}

function renderCartesianChart(model: ChartModel) {
  const width = 740;
  const height = 450;
  const padTop = model.title ? 66 : 40;
  const padRight = 36;
  const padBottom = model.datasets.length > 1 ? 92 : 72;
  const padLeft = 74;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allValues = model.datasets.flatMap((ds) => ds.data);
  const rawMin = Math.min(0, ...allValues);
  const rawMax = Math.max(1, ...allValues);
  const yScale = computeNiceScale(rawMin, rawMax, 5, model.yMin, model.yMax);
  const yMin = yScale.min;
  const yMax = yScale.max;
  const yRange = yMax - yMin || 1;

  const yTicks = yScale.ticks.map((val) => ({
    val,
    y: padTop + plotH - ((val - yMin) / yRange) * plotH,
  }));

  const baselineY = padTop + plotH - ((0 - yMin) / yRange) * plotH;
  const categoryCount = Math.max(1, model.labels.length);
  const stepX = plotW / categoryCount;

  const isLineOrArea = model.type === 'line' || model.type === 'area';

  return (
    <svg
      className="aurvin-canvas-svg aurvin-canvas-chart-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={model.title ?? `${model.type} chart`}
    >
      {model.title ? (
        <text x={width / 2} y={34} textAnchor="middle" className="aurvin-canvas-svg-title">
          {model.title}
        </text>
      ) : null}

      {/* Gridlines & Y-axis labels */}
      <g className="aurvin-canvas-grid">
        {yTicks.map((t, idx) => (
          <g key={`ytick-${idx}`}>
            <line
              x1={padLeft}
              y1={t.y}
              x2={padLeft + plotW}
              y2={t.y}
              className="aurvin-canvas-grid-line"
            />
            <text
              x={padLeft - 12}
              y={t.y + 4}
              textAnchor="end"
              className="aurvin-canvas-axis-tick"
            >
              {formatNumber(t.val)}
            </text>
          </g>
        ))}
      </g>

      {/* Axis Spines */}
      <line
        x1={padLeft}
        y1={padTop}
        x2={padLeft}
        y2={padTop + plotH}
        className="aurvin-canvas-axis-origin"
      />
      <line
        x1={padLeft}
        y1={baselineY}
        x2={padLeft + plotW}
        y2={baselineY}
        className="aurvin-canvas-axis-origin"
      />

      {/* X-axis labels */}
      <g className="aurvin-canvas-x-axis">
        {model.labels.map((label, idx) => {
          const cx = padLeft + stepX * idx + stepX / 2;
          return (
            <text
              key={`xlabel-${idx}`}
              x={cx}
              y={padTop + plotH + 24}
              textAnchor="middle"
              className="aurvin-canvas-axis-tick"
            >
              {label.length > 16 ? `${label.slice(0, 15)}…` : label}
            </text>
          );
        })}
      </g>

      {model.xAxisLabel ? (
        <text
          x={padLeft + plotW / 2}
          y={padTop + plotH + 50}
          textAnchor="middle"
          className="aurvin-canvas-axis-title"
        >
          {model.xAxisLabel}
        </text>
      ) : null}

      {model.yAxisLabel ? (
        <text
          x={20}
          y={padTop + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 20 ${padTop + plotH / 2})`}
          className="aurvin-canvas-axis-title"
        >
          {model.yAxisLabel}
        </text>
      ) : null}

      {/* Bars or Lines */}
      {!isLineOrArea ? (
        <g className="aurvin-canvas-bars">
          {model.labels.map((_, catIdx) => {
            const groupWidth = Math.min(stepX * 0.68, 58 * model.datasets.length);
            const barWidth = Math.max(
              10,
              (groupWidth - (model.datasets.length - 1) * 6) / model.datasets.length,
            );
            const groupStartX = padLeft + stepX * catIdx + (stepX - groupWidth) / 2;

            return model.datasets.map((ds, dsIdx) => {
              const val = ds.data[catIdx] ?? 0;
              const color = ds.color ?? CHART_PALETTE[dsIdx % CHART_PALETTE.length]!;
              const valY = padTop + plotH - ((val - yMin) / yRange) * plotH;
              const topY = Math.min(valY, baselineY);
              const barH = Math.max(2, Math.abs(baselineY - valY));
              const bx = groupStartX + dsIdx * (barWidth + 6);

              return (
                <g key={`bar-${catIdx}-${dsIdx}`}>
                  <rect
                    x={bx}
                    y={topY}
                    width={barWidth}
                    height={barH}
                    rx={4}
                    fill={color}
                  />
                  <text
                    x={bx + barWidth / 2}
                    y={val >= 0 ? topY - 7 : topY + barH + 14}
                    textAnchor="middle"
                    className="aurvin-canvas-data-label"
                  >
                    {formatNumber(val)}
                  </text>
                </g>
              );
            });
          })}
        </g>
      ) : (
        <g className="aurvin-canvas-lines">
          {model.datasets.map((ds, dsIdx) => {
            const color = ds.color ?? CHART_PALETTE[dsIdx % CHART_PALETTE.length]!;
            const points = model.labels.map((_, idx) => {
              const val = ds.data[idx] ?? 0;
              const x = padLeft + stepX * idx + stepX / 2;
              const y = padTop + plotH - ((val - yMin) / yRange) * plotH;
              return { x, y, val };
            });

            if (points.length === 0) return null;
            const linePath = ds.smooth
              ? buildSmoothCurvePath(points)
              : points
                  .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
                  .join(' ');
            const firstPt = points[0]!;
            const lastPt = points[points.length - 1]!;
            const areaPath = `${linePath} L ${lastPt.x.toFixed(2)} ${baselineY.toFixed(2)} L ${firstPt.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;

            return (
              <g key={`series-${dsIdx}`}>
                {model.type === 'area' ? (
                  <path d={areaPath} fill={color} fillOpacity={0.14} />
                ) : null}
                <path
                  d={linePath}
                  fill="none"
                  stroke={color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {points.map((pt, pIdx) => (
                  <g key={`pt-${dsIdx}-${pIdx}`}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={7.5}
                      fill={color}
                      fillOpacity={0.16}
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={4.5}
                      fill={color}
                      stroke="var(--aurvin-canvas-bg, #111214)"
                      strokeWidth="1.8"
                    />
                    <text
                      x={pt.x}
                      y={pt.y - 12}
                      textAnchor="middle"
                      className="aurvin-canvas-data-label"
                    >
                      {formatNumber(pt.val)}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      )}

      {/* Legend when multiple datasets exist */}
      {model.datasets.length > 1 ? (
        <g
          className="aurvin-canvas-legend"
          transform={`translate(${width / 2 - (model.datasets.length * 120) / 2}, ${height - 20})`}
        >
          {model.datasets.map((ds, dsIdx) => {
            const color = ds.color ?? CHART_PALETTE[dsIdx % CHART_PALETTE.length]!;
            return (
              <g key={`cleg-${dsIdx}`} transform={`translate(${dsIdx * 130}, 0)`}>
                <rect x={0} y={-10} width={12} height={12} rx={3} fill={color} />
                <text x={18} y={0} className="aurvin-canvas-legend-label">
                  {ds.label}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}
    </svg>
  );
}

export function ChartRenderer({
  source,
  title,
  model: explicitModel,
}: {
  source: string;
  title?: string;
  model?: ChartModel | null;
}) {
  const model = explicitModel ?? parseChartSource(source, title);
  if (!model || model.datasets.length === 0) {
    return (
      <div className="aurvin-canvas-fallback">
        <p className="aurvin-canvas-fallback-note">Chart data is being prepared or is in custom format:</p>
        <pre className="aurvin-canvas-fallback-code">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  if (model.type === 'pie') {
    return renderPieChart(model);
  }
  const hasCoordinatePoints = model.datasets.some((ds) => ds.points && ds.points.length > 0);
  if (model.type === 'scatter' || hasCoordinatePoints) {
    return renderXYCoordinateGraph(model);
  }
  return renderCartesianChart(model);
}

