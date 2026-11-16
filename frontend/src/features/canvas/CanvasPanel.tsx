/**
 * ============================================================================
 * FILE: CanvasPanel.tsx
 * LOCATION: frontend/src/features/canvas/CanvasPanel.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Tabbed split-screen Canvas side panel with zoom, pan, code/preview, and export.
 *
 * ROLE IN PROJECT:
 *    Mounts beside the chat transcript inside ChatView when an artifact is
 *    opened, letting users inspect, zoom, pan, view source, copy, and download.
 *    Structured Calendar artifacts instead use an ordinary scrollable body
 *    without pan/zoom, source, copy, or download controls.
 *
 * KEY COMPONENTS:
 *    - CanvasPanel: Multi-tab header, toolbar controls, and interactive stage.
 *    - calendarBody: Read-only Calendar workspace body (no diagram stage).
 *    - CodeLinesView: Line-numbered raw source code inspector.
 * ============================================================================
 */

import { useEffect, useRef, useState, type Ref } from 'react';
import type { CalendarConfirmPayload } from '../../api/voice-protocol.ts';
import {
  computeWheelZoomView,
  forcedChartKindFromSubType,
  parseChartSource,
  type CanvasPanelTransitionState,
} from './canvas-artifacts.ts';
import { matchesCalendarArtifact } from './calendar-workspace.ts';
import { ArtifactKindIcon } from './CanvasArtifactCard.tsx';
import type { CanvasArtifact } from './canvas-types.ts';
import { CalendarEventRenderer } from './renderers/calendar-event-renderer.tsx';
import { CalendarViewBoundary, CalendarViewRenderer } from './renderers/calendar-view-renderer.tsx';
import { ChartRenderer } from './renderers/chart-renderer.tsx';
import { MermaidRenderer } from './renderers/mermaid-renderer.tsx';
import { SvgRenderer } from './renderers/svg-renderer.tsx';

const MIN_ZOOM = 25;
const MAX_ZOOM = 300;
const ZOOM_STEP = 25;

export function toArtifactPath(artifact: CanvasArtifact): string {
  const slug = artifact.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'artifact';
  const ext =
    artifact.kind === 'mermaid'
      ? 'mmd'
      : artifact.kind === 'svg'
        ? 'svg'
        : artifact.kind === 'calendar'
          ? 'event.json'
          : 'chart.json';
  return `canvas/${slug}.${ext}`;
}

function CodeLinesView({ code }: { code: string }) {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  return (
    <div className="aurvin-canvas-code-view" role="region" aria-label="Artifact source code">
      <ol className="aurvin-canvas-code-lines">
        {lines.map((line, idx) => (
          <li key={idx} className="aurvin-canvas-code-line">
            <span className="aurvin-canvas-line-num" aria-hidden="true">
              {idx + 1}
            </span>
            <span className="aurvin-canvas-line-text">{line || ' '}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CanvasPanel({
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  onCloseTab,
  onClosePanel,
  transitionState = 'open',
  panelRef,
  onCalendarAnswer,
  calendarControlsDisabled = false,
}: {
  artifacts: CanvasArtifact[];
  activeArtifactId: string | null;
  onSelectArtifact: (artifactId: string) => void;
  onCloseTab: (artifactId: string) => void;
  onClosePanel: () => void;
  transitionState?: CanvasPanelTransitionState;
  panelRef?: Ref<HTMLElement>;
  onCalendarAnswer?: (proposalId: string, revision: number, answer: CalendarConfirmPayload['answer']) => void;
  calendarControlsDisabled?: boolean;
}) {
  const activeArtifact =
    artifacts.find((a) => matchesCalendarArtifact(a, activeArtifactId)) ??
    artifacts[artifacts.length - 1] ??
    null;
  const calendarMode = activeArtifact?.kind === 'calendar';

  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [view, setView] = useState<{ zoom: number; panX: number; panY: number }>({
    zoom: 100,
    panX: 0,
    panY: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [copied, setCopied] = useState(false);

  const dragOriginRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || viewMode !== 'preview' || calendarMode) return;
    const handleNativeWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, [viewMode, activeArtifact?.artifactId, calendarMode]);

  if (!activeArtifact) {
    return null;
  }

  const { zoom } = view;

  const handleZoomOut = () => {
    setView((prev) => ({
      ...prev,
      zoom: Math.max(MIN_ZOOM, prev.zoom - ZOOM_STEP),
    }));
  };

  const handleZoomIn = () => {
    setView((prev) => ({
      ...prev,
      zoom: Math.min(MAX_ZOOM, prev.zoom + ZOOM_STEP),
    }));
  };

  const handleResetView = () => {
    setView({ zoom: 100, panX: 0, panY: 0 });
  };

  const handleSelectTab = (artifactId: string) => {
    handleResetView();
    setCopied(false);
    onSelectArtifact(artifactId);
  };

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeArtifact.rawSource);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Clipboard API unavailable in non-secure or headless context
    }
  };

  const handleDownload = () => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const slug =
      activeArtifact.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'aurvin-canvas';

    const svgEl =
      viewMode === 'preview' ? stageRef.current?.querySelector('svg') ?? null : null;

    let content = activeArtifact.rawSource;
    let mime = 'text/plain;charset=utf-8';
    let ext = activeArtifact.kind === 'mermaid' ? 'mmd' : activeArtifact.kind === 'svg' ? 'svg' : 'json';

    if (svgEl && typeof XMLSerializer !== 'undefined') {
      const serialized = new XMLSerializer().serializeToString(svgEl);
      content = serialized.includes('xmlns=')
        ? serialized
        : serialized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      mime = 'image/svg+xml;charset=utf-8';
      ext = 'svg';
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const artifactPath = toArtifactPath(activeArtifact);
  const isExiting = transitionState === 'exiting';

  const calendarBody=<div className="aurvin-canvas-calendar-body" role="region" aria-label="Calendar workspace">
    {activeArtifact.calendarView || activeArtifact.calendarWorkspace ?
      <CalendarViewBoundary key={activeArtifact.artifactId} value={activeArtifact.calendarWorkspace?.view ?? activeArtifact.calendarView ?? null}>
        <CalendarViewRenderer view={activeArtifact.calendarWorkspace?.view ?? activeArtifact.calendarView ?? null}
          workspace={activeArtifact.calendarWorkspace} disabled={calendarControlsDisabled}
          onAnswer={activeArtifact.calendarWorkspace?.view?.kind === 'proposal' && onCalendarAnswer ? answer=>{
            const view=activeArtifact.calendarWorkspace!.view!;
            if (view.kind === 'proposal') onCalendarAnswer(view.proposalId,view.revision,answer);
          } : undefined}/>
      </CalendarViewBoundary> : <CalendarEventRenderer source={activeArtifact.rawSource} title={activeArtifact.title}/>}
  </div>;

  return (
    <aside
      ref={panelRef}
      id="aurvin-canvas-panel"
      className={`aurvin-canvas-panel${maximized ? ' aurvin-canvas-panel-maximized' : ''}`}
      aria-label="Aurvin Canvas"
      data-active-artifact-id={activeArtifact.artifactId}
      data-canvas-state={transitionState}
      aria-hidden={isExiting ? 'true' : undefined}
      inert={isExiting}
    >
      {/* Top Tab Bar matching the Canvas screenshot */}
      <div className="aurvin-canvas-tabs-bar">
        <div className="aurvin-canvas-tabs-scroll" role="tablist" aria-label="Canvas artifacts">
          {artifacts.map((item) => {
            const isSelected = item.artifactId === activeArtifact.artifactId;
            return (
              <div
                key={item.artifactId}
                className="aurvin-canvas-tab-item"
                data-selected={isSelected ? 'true' : 'false'}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className="aurvin-canvas-tab-btn"
                  onClick={() => handleSelectTab(item.artifactId)}
                  title={item.title}
                >
                  <ArtifactKindIcon kind={item.kind} subType={item.subType} size={14} />
                  <span className="aurvin-canvas-tab-title">{item.title}</span>
                </button>
                <button
                  type="button"
                  className="aurvin-canvas-tab-close"
                  aria-label={`Close ${item.title} tab`}
                  onClick={() => onCloseTab(item.artifactId)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <div className="aurvin-canvas-window-actions">
          <button
            type="button"
            className="aurvin-canvas-icon-btn"
            aria-label={maximized ? 'Restore split view' : 'Expand canvas'}
            title={maximized ? 'Restore split view' : 'Expand canvas'}
            onClick={() => setMaximized((m) => !m)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M12 4v16" />
            </svg>
          </button>
          <button
            type="button"
            className="aurvin-canvas-icon-btn"
            aria-label="Close canvas"
            title="Close canvas"
            onClick={onClosePanel}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Subheader / Path & Interactive Controls Toolbar */}
      <div className="aurvin-canvas-toolbar">
        <div className="aurvin-canvas-breadcrumb">
          <span className="aurvin-canvas-path">{artifactPath}</span>
          <span className="aurvin-canvas-badge">{activeArtifact.subType}</span>
        </div>

        <div className="aurvin-canvas-controls">
          {!calendarMode ? (
            <>
          <div className="aurvin-canvas-mode-group" role="group" aria-label="Canvas view mode">
            <button
              type="button"
              className="aurvin-canvas-mode-btn"
              data-active={viewMode === 'preview' ? 'true' : 'false'}
              onClick={() => setViewMode('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              className="aurvin-canvas-mode-btn"
              data-active={viewMode === 'code' ? 'true' : 'false'}
              onClick={() => setViewMode('code')}
            >
              Code
            </button>
          </div>

          {viewMode === 'preview' ? (
            <div className="aurvin-canvas-zoom-group" role="group" aria-label="Zoom controls">
              <button
                type="button"
                className="aurvin-canvas-icon-btn"
                aria-label="Zoom out"
                title="Zoom out"
                onClick={handleZoomOut}
                disabled={zoom <= MIN_ZOOM}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
              <button
                type="button"
                className="aurvin-canvas-zoom-reset"
                aria-label="Reset zoom"
                title="Reset zoom and center"
                onClick={handleResetView}
              >
                {zoom}%
              </button>
              <button
                type="button"
                className="aurvin-canvas-icon-btn"
                aria-label="Zoom in"
                title="Zoom in"
                onClick={handleZoomIn}
                disabled={zoom >= MAX_ZOOM}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </button>
            </div>
          ) : null}

          <button
            type="button"
            className="aurvin-canvas-icon-btn"
            aria-label="Copy artifact source"
            title={copied ? 'Copied!' : 'Copy source'}
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>

          <button
            type="button"
            className="aurvin-canvas-icon-btn"
            aria-label="Download artifact"
            title="Download artifact"
            onClick={handleDownload}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Main Canvas Body */}
      <div className="aurvin-canvas-body">
        {calendarMode ? calendarBody : viewMode === 'code' ? (
          <CodeLinesView code={activeArtifact.rawSource} />
        ) : (
          <div
            ref={stageRef}
            className={`aurvin-canvas-viewport${isDragging ? ' aurvin-canvas-viewport-dragging' : ''}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              setIsDragging(true);
              dragOriginRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                panX: view.panX,
                panY: view.panY,
              };
            }}
            onPointerMove={(e) => {
              if (!isDragging || !dragOriginRef.current) return;
              const dx = e.clientX - dragOriginRef.current.startX;
              const dy = e.clientY - dragOriginRef.current.startY;
              const origin = dragOriginRef.current;
              setView((prev) => ({
                ...prev,
                panX: origin.panX + dx,
                panY: origin.panY + dy,
              }));
            }}
            onPointerUp={() => {
              setIsDragging(false);
              dragOriginRef.current = null;
            }}
            onPointerCancel={() => {
              setIsDragging(false);
              dragOriginRef.current = null;
            }}
            onWheel={(e) => {
              if (e.deltaY === 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const offsetX = rect.width > 0 ? e.clientX - (rect.left + rect.width / 2) : 0;
              const offsetY = rect.height > 0 ? e.clientY - (rect.top + rect.height / 2) : 0;
              setView((prev) => computeWheelZoomView(prev, e.deltaY, offsetX, offsetY));
            }}
          >
            <div
              className="aurvin-canvas-stage"
              style={{
                transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom / 100})`,
              }}
            >
              {activeArtifact.kind === 'mermaid' ? (
                <MermaidRenderer
                  source={activeArtifact.rawSource}
                  title={activeArtifact.title}
                />
              ) : activeArtifact.kind === 'chart' ? (
                <ChartRenderer
                  source={activeArtifact.rawSource}
                  title={activeArtifact.title}
                  model={parseChartSource(
                    activeArtifact.rawSource,
                    activeArtifact.title,
                    forcedChartKindFromSubType(activeArtifact.subType, activeArtifact.rawSource),
                  )}
                />
              ) : activeArtifact.kind === 'calendar' ? (
                <CalendarEventRenderer
                  source={activeArtifact.rawSource}
                  title={activeArtifact.title}
                />
              ) : (
                <SvgRenderer
                  source={activeArtifact.rawSource}
                  title={activeArtifact.title}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
