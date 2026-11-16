/**
 * ============================================================================
 * FILE: svg-renderer.tsx
 * LOCATION: frontend/src/features/canvas/renderers/svg-renderer.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Sanitized React SVG element renderer for raw SVG Canvas artifacts.
 *
 * ROLE IN PROJECT:
 *    Parses safe vector tags and attributes into React elements without
 *    dangerouslySetInnerHTML, stripping scripts, event handlers, and unsafe URLs.
 *
 * KEY COMPONENTS:
 *    - SAFE_SVG_TAGS / SAFE_SVG_ATTRS: Allowlists for vector shapes and styles.
 *    - isSafePaintValue: Rejects external or unsafe paint and marker URL references.
 *    - SvgRenderer: Converts sanitized SVG source into React nodes.
 * ============================================================================
 */

import { createElement, type ReactNode } from 'react';

const SAFE_SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'marker',
  'title',
  'desc',
]);

const ATTR_MAP: Record<string, string> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'fill-opacity': 'fillOpacity',
  'stroke-opacity': 'strokeOpacity',
  'text-anchor': 'textAnchor',
  'dominant-baseline': 'dominantBaseline',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'font-family': 'fontFamily',
  'marker-end': 'markerEnd',
  'marker-start': 'markerStart',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  refx: 'refX',
  refy: 'refY',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
};

const ALLOWED_ATTRS = new Set([
  'id',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeDasharray',
  'strokeLinecap',
  'strokeLinejoin',
  'fillOpacity',
  'strokeOpacity',
  'opacity',
  'transform',
  'textAnchor',
  'dominantBaseline',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'dx',
  'dy',
  'offset',
  'stopColor',
  'stopOpacity',
  'gradientUnits',
  'gradientTransform',
  'markerEnd',
  'markerStart',
  'refX',
  'refY',
  'markerWidth',
  'markerHeight',
  'orient',
]);

function isSafePaintValue(val: string): boolean {
  if (!/url\s*\(/i.test(val)) {
    return true;
  }
  const urlRegex = /url\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = urlRegex.exec(val)) !== null) {
    count++;
    const target = (match[1] ?? '')
      .trim()
      .replace(/^(&quot;|&apos;|\\['"]|['"])+|(&quot;|&apos;|\\['"]|['"])+$/g, '')
      .trim();
    if (!/^#[A-Za-z0-9_:.-]+$/.test(target)) {
      return false;
    }
  }
  const openCount = (val.match(/url\s*\(/gi) || []).length;
  return count > 0 && count === openCount;
}

function parseSafeAttributes(attrString: string): Record<string, string> {
  const props: Record<string, string> = {};
  const attrRegex = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const rawName = match[1] ?? '';
    const rawVal = (match[2] ?? match[3] ?? '').trim();
    const lower = rawName.toLowerCase();
    if (lower.startsWith('on') || lower === 'href' || lower === 'xlink:href' || lower === 'style') {
      continue;
    }
    if (/javascript:|data:|vbscript:/i.test(rawVal)) {
      continue;
    }
    if (/url\s*\(/i.test(rawVal) && !isSafePaintValue(rawVal)) {
      continue;
    }
    const mapped = ATTR_MAP[lower] ?? rawName;
    if (ALLOWED_ATTRS.has(mapped)) {
      props[mapped] = rawVal;
    }
  }
  return props;
}

type SvgNode = {
  tag: string;
  attrs: Record<string, string>;
  children: Array<SvgNode | string>;
};

function parseSvgTree(source: string): SvgNode | null {
  const cleaned = source
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .trim();
  const svgStart = cleaned.indexOf('<svg');
  if (svgStart === -1) return null;
  const xml = cleaned.slice(svgStart);

  const tokenRegex = /<\/?([A-Za-z][A-Za-z0-9]*)\b([^>]*?)(\/?)>|([^<]+)/g;
  const stack: SvgNode[] = [];
  let root: SvgNode | null = null;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(xml)) !== null) {
    const textContent = match[4];
    if (textContent !== undefined) {
      const trimmed = textContent.trim();
      if (trimmed && stack.length > 0) {
        stack[stack.length - 1]!.children.push(trimmed);
      }
      continue;
    }

    const fullToken = match[0] ?? '';
    const isClosing = fullToken.startsWith('</');
    const rawTag = match[1] ?? '';
    const attrStr = match[2] ?? '';
    const selfClosing = match[3] === '/';

    if (isClosing) {
      if (stack.length > 0 && stack[stack.length - 1]!.tag.toLowerCase() === rawTag.toLowerCase()) {
        stack.pop();
      }
      continue;
    }

    const canonicalTag = Array.from(SAFE_SVG_TAGS).find(
      (t) => t.toLowerCase() === rawTag.toLowerCase(),
    );
    if (!canonicalTag) {
      continue;
    }

    const node: SvgNode = {
      tag: canonicalTag,
      attrs: parseSafeAttributes(attrStr),
      children: [],
    };

    if (!root && canonicalTag === 'svg') {
      root = node;
    } else if (stack.length > 0) {
      stack[stack.length - 1]!.children.push(node);
    }

    if (!selfClosing) {
      stack.push(node);
    }
  }

  return root;
}

function renderSvgNode(node: SvgNode | string, key: string): ReactNode {
  if (typeof node === 'string') return node;
  const props: Record<string, unknown> = { ...node.attrs, key };
  if (node.tag === 'svg') {
    props.className = 'aurvin-canvas-svg';
    if (!props.viewBox) {
      const w = Number(props.width) || 640;
      const h = Number(props.height) || 400;
      props.viewBox = `0 0 ${w} ${h}`;
    }
    if (!props.preserveAspectRatio) {
      props.preserveAspectRatio = 'xMidYMid meet';
    }
  }
  const children = node.children.map((child, idx) => renderSvgNode(child, `${key}-${idx}`));
  return createElement(node.tag, props, ...children);
}

export function SvgRenderer({ source, title }: { source: string; title?: string }) {
  const tree = parseSvgTree(source);
  if (!tree) {
    return (
      <div className="aurvin-canvas-fallback">
        <p className="aurvin-canvas-fallback-note">{title ?? 'Generating SVG visual…'}</p>
        <pre className="aurvin-canvas-fallback-code">
          <code>{source}</code>
        </pre>
      </div>
    );
  }
  return <>{renderSvgNode(tree, 'svg-root')}</>;
}
