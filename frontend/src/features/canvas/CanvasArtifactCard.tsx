/**
 * ============================================================================
 * FILE: CanvasArtifactCard.tsx
 * LOCATION: frontend/src/features/canvas/CanvasArtifactCard.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Inline chat card button that replaces raw diagram/chart blocks in replies.
 *
 * ROLE IN PROJECT:
 *    Rendered by SafeMarkdown whenever a Mermaid diagram, chart, or SVG visual
 *    is detected, allowing the user to open the artifact in Aurvin's Canvas.
 *
 * KEY COMPONENTS:
 *    - ArtifactKindIcon: Visual glyph for diagram, chart, or graph kinds.
 *    - CanvasArtifactCard: Accessible button card triggering CanvasPanel.
 * ============================================================================
 */

import type { CanvasArtifact } from './canvas-types.ts';

export function ArtifactKindIcon({
  kind,
  subType,
  size = 18,
}: {
  kind: CanvasArtifact['kind'];
  subType?: string;
  size?: number;
}) {
  const lowerSub = subType?.toLowerCase() ?? '';
  const isGraph =
    lowerSub.includes('graph') ||
    lowerSub.includes('line') ||
    lowerSub.includes('plot') ||
    lowerSub.includes('scatter') ||
    lowerSub.includes('x-y');
  if (kind === 'calendar') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }

  if (kind === 'chart') {
    if (isGraph) {
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 3v18h18" />
          <path d="m7 15 4-4 4 3 5-6" />
        </svg>
      );
    }
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="6" rx="1.5" />
      <rect x="14" y="3" width="7" height="6" rx="1.5" />
      <rect x="8.5" y="15" width="7" height="6" rx="1.5" />
      <path d="M6.5 9v3a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M12 13.5V15" />
    </svg>
  );
}

export function CanvasArtifactCard({
  artifact,
  isActive = false,
  onOpen,
}: {
  artifact: CanvasArtifact;
  isActive?: boolean;
  onOpen?: (artifactId: string) => void;
}) {
  const statusText = artifact.isStreaming
    ? `${artifact.subType} · Generating in Canvas…`
    : `${artifact.subType} · Aurvin Canvas`;

  return (
    <div
      className="aurvin-canvas-card-wrapper"
      data-canvas-artifact-id={artifact.artifactId}
      data-canvas-kind={artifact.kind}
    >
      <button
        type="button"
        className="aurvin-canvas-card"
        data-active={isActive ? 'true' : 'false'}
        aria-label={`${artifact.buttonLabel}: ${artifact.title}`}
        onClick={() => onOpen?.(artifact.artifactId)}
      >
        <span className="aurvin-canvas-card-icon">
          <ArtifactKindIcon kind={artifact.kind} subType={artifact.subType} size={18} />
        </span>

        <span className="aurvin-canvas-card-meta">
          <span className="aurvin-canvas-card-title">{artifact.title}</span>
          <span className="aurvin-canvas-card-subtitle">{statusText}</span>
        </span>

        <span className="aurvin-canvas-card-cta">
          <span>{artifact.buttonLabel}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16" />
          </svg>
        </span>
      </button>
    </div>
  );
}
