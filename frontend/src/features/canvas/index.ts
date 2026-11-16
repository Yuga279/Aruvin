/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: frontend/src/features/canvas/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Public barrel for Aurvin's Canvas extraction, inline cards, and side panel.
 *
 * ROLE IN PROJECT:
 *    Exposes CanvasArtifactCard, CanvasPanel, and extraction utilities to
 *    SafeMarkdown, MessageItem, and ChatView.
 *
 * KEY COMPONENTS:
 *    - CanvasArtifactCard / CanvasPanel: Inline trigger and split-pane viewer.
 *    - parseCanvasCodeBlock / collectSessionCanvasArtifacts: Extraction helpers.
 * ============================================================================
 */

export {
  buttonLabelForCanvasArtifact,
  CANVAS_TRANSITION_MS,
  claimNewAutoOpenArtifactId,
  collectSessionCanvasArtifacts,
  computeWheelZoomView,
  extractMessageCanvasArtifacts,
  extractVoiceMessageCanvasArtifacts,
  forcedChartKindFromSubType,
  handleLiveCanvasShortcut,
  mergeSessionCanvasArtifacts,
  parseCalendarSource,
  parseCanvasCodeBlock,
  resolveSafeCalendarLink,
  parseChartSource,
  parseMermaidSource,
  prefersReducedCanvasMotion,
  preprocessCanvasTags,
  projectionToCanvasArtifact,
  resolveCanvasCloseFocusTarget,
  restoreCanvasCloseFocus,
} from './canvas-artifacts.ts';
export type {
  CanvasCloseFocusTargets,
  CanvasPanelTransitionState,
  CanvasShortcutKeyEvent,
} from './canvas-artifacts.ts';
export { ArtifactKindIcon, CanvasArtifactCard } from './CanvasArtifactCard.tsx';
export {
  calendarViewArtifact,
  calendarViewKey,
  claimCalendarAutoOpenId,
  foldCalendarFrame,
  freezeCalendarControls,
  matchesCalendarArtifact,
  mergeCalendarWorkspaces,
} from './calendar-workspace.ts';
export type { CalendarWorkspace } from './calendar-workspace.ts';
export { CanvasPanel, toArtifactPath } from './CanvasPanel.tsx';
export type {
  CalendarEventDateTime,
  CalendarEventModel,
  CanvasArtifact,
  CanvasArtifactKind,
  ChartDataset,
  ChartKind,
  ChartModel,
  MermaidFlowModel,
  MermaidParsedModel,
  MermaidSequenceModel,
} from './canvas-types.ts';
export { CalendarEventRenderer } from './renderers/calendar-event-renderer.tsx';
export { ChartRenderer } from './renderers/chart-renderer.tsx';
export { MermaidRenderer } from './renderers/mermaid-renderer.tsx';
export { SvgRenderer } from './renderers/svg-renderer.tsx';
